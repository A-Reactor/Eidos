'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { archiveScopeSessionValue } from '@/lib/game/archive-scope';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { narrativeInput, type NarrativeRequest } from '@/lib/game/narrative';
import type { StorySegment } from '@/lib/ai/types';
import { useGameStore } from '@/store/game-store';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { acceptModCommand, buildModDocument } from '@/lib/game/plugins/mod-ui';
import { createStreamRequestScope, isStreamBusy } from '@/lib/game/stream-lifecycle';
import { commitGameplayOperation, commitGameplayRule } from '@/lib/game/plugins/gameplay-commit';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { pluginPreferences } from '@/lib/game/plugins/preferences';
import { EIDOS_SETTINGS_CHANGE_EVENT, loadSettings } from '@/lib/game/settings';
import { authorState, parseStage, workspaceOf, type ModStage } from '@/lib/game/plugins/workspace';
import { withWorkspace, type WorkspaceAccess } from '@/lib/game/plugins/workspace-operations';
import { inspectResource, modCapabilities, runWorkspaceOperation } from '@/lib/game/plugins/workspace-host';
import { ModAuxiliaryStages } from './ModAuxiliaryStages';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import { openNativeStage, type NativeStageLink } from '@/lib/game/plugins/native-stage';
import { isCardAdapter, publicCardState } from '@/lib/game/cards/adapter';
import { useModTheme } from './use-mod-theme';
import { buildModScene, worldInteractionInput } from '@/lib/game/plugins/world-interaction';
import { validateGameModeConfig } from '@/lib/game/plugins/manifest';
import { allowedFields, record } from '@/lib/game/plugins/validation';
import { sceneMapFileCatalog, readSceneMapFile } from '@/lib/game/plugins/scene-map-files';
import { HOST_SHORTCUT_EVENT } from '@/lib/game/keyboard-shortcuts';

export interface ModReading {
  segments: StorySegment[]; index: number; displayedText: string; complete: boolean;
  loading: boolean; error?: string | null; typing?: boolean; paused?: boolean; inputBlocked?: boolean;
}
export interface GameplayModSurfaceProps {
  onPresentationChange?: (presentation: 'scene-map' | null) => void;
  onNotice?: (message: string) => void;
  offline?: boolean;
  pluginId?: string;
  reading: ModReading;
  onSubmit: (action: string, narrativeRequest?: NarrativeRequest) => void | Promise<void>;
  onAdvance: () => void;
  onActiveChange?: (replace: boolean) => void;
  suspended?: boolean;
  onRelease?: () => void;
  onFailure?: () => void;
  managed?: boolean;
}

export function GameplayModSurface({ reading, onSubmit, onAdvance, onActiveChange, pluginId, suspended = false, onRelease, onFailure, onNotice, managed = false, offline = false }: GameplayModSurfaceProps) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const theme = useModTheme();
  const definitions = store.currentWorld?.gameplayPlugins;
  const plugins = useMemo(() => {
    try { return parseGameplayPlugins(definitions).filter(plugin => plugin.ui && (pluginId ? plugin.id === pluginId : !isCardAdapter(plugin))); }
    catch { return []; }
  }, [definitions, pluginId]);
  const scope = `${store.currentWorld?.id ?? ''}:${store.currentPlaythroughId ?? ''}:${store.currentNode?.id ?? ''}:${store.currentSceneId}:${store.worldLine?.id ?? ''}:${archiveScopeSessionValue(store)}`;
  const [released, setReleased] = useState<Record<string, string>>({});
  const [hostSettings, setHostSettings] = useState(loadSettings);
  const preferences = hostSettings.modPreferences;
  useEffect(() => {
    const refresh = () => setHostSettings(loadSettings());
    window.addEventListener(EIDOS_SETTINGS_CHANGE_EVENT, refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(EIDOS_SETTINGS_CHANGE_EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const eligible = plugins.filter(p => (managed || isGameplayPluginActive(p, store.worldFlags, store.currentSceneId)) && released[p.id] !== scope);
  // A scene-specific operation can temporarily take over a permanent reading surface.
  const plugin = eligible.find(p => p.activation) ?? eligible[0];
  // A committed action advances the node, but must not destroy the frame awaiting its receipt.
  const sessionKey = `${plugin?.id ?? ''}:${store.currentWorld?.id ?? ''}:${store.currentPlaythroughId ?? ''}:${store.worldLine?.id ?? ''}:${archiveScopeSessionValue(store)}`;
  const packageKey = `${JSON.stringify(plugin)}`;
  const token = useMemo(() => `${sessionKey}:${packageKey.length}:${crypto.randomUUID()}`, [sessionKey, packageKey]);
  const frame = useRef<HTMLIFrameElement>(null);
  const auxiliary = useRef(new Map<string, HTMLIFrameElement>());
  const nativeStages = useRef(new Map<string, NativeStageLink>());
  const [nativeStageIds, setNativeStageIds] = useState<{ token: string; ids: string[] }>({ token: '', ids: [] });
  const [failedSession, setFailedSession] = useState<string | null>(null);
  const failed = failedSession === token;
  const ready = useRef(false);
  const submitting = useRef(false);
  const releasedToken = useRef<string | null>(null);
  const context = {
    theme,
    surface: { kind: 'main', active: !suspended },
    capabilities: offline ? { files: true, resources: true, stages: 'embedded', nativeWindows: false, nativeDirectory: false, analysis: { available: false } } : modCapabilities(),
    scope,
    plugin: plugin ? { id: plugin.id, name: plugin.name, data: plugin.data ?? {} } : null,
    state: plugin ? publicCardState(plugin, store.gameplayModState[plugin.id] ?? plugin.ui?.initialState ?? {}) : {},
    settings: plugin ? pluginPreferences(plugin, preferences) : {},
    keyboardShortcuts: hostSettings.keyboardShortcuts,
    world: { id: store.currentWorld?.id, name: store.currentWorld?.name, playerName: store.playerName, sceneId: store.currentSceneId, sceneName: store.currentScene?.name ?? store.currentSceneId,
      nodeId: store.currentNode?.id, parentNodeId: store.currentNode?.parentId },
    // Do not reveal unfinished lines, undiscovered evidence or world secrets to the UI.
    reading: { ...reading, paused: reading.paused || suspended, segments: (reading.complete ? reading.segments : reading.segments.slice(0, reading.index + 1)).map((segment, index) => ({ ...segment, text: !reading.complete && index === reading.index ? (segment.text.startsWith(reading.displayedText) ? reading.displayedText : '') : segment.text })) },
    scene: reading.complete || reading.error ? buildModScene(store) : null,
    sceneMapFiles: plugin?.ui?.presentation === 'scene-map' ? sceneMapFileCatalog(store) : [],
    actions: [...store.availableActions],
    clues: store.clues.filter(clue => clue.discovered).map(clue => ({ id: clue.id, name: clue.name, description: clue.description, discovered: true })),
    inventory: store.inventory.map(item => ({ id: item.id, name: item.name, description: item.description, quantity: item.quantity })),
    characters: store.currentScene?.npcs ?? [],
  };
  const live = useRef({ context, onSubmit, onAdvance, onActiveChange, scope, token, plugin, suspended, onRelease, onFailure, onNotice });
  useLayoutEffect(() => { live.current = { context, onSubmit, onAdvance, onActiveChange, scope, token, plugin, suspended, onRelease, onFailure, onNotice }; });
  const html = plugin?.ui?.html;
  const document = useMemo(() => html ? buildModDocument(html, token, offline) : '', [html, token, offline]);
  useEffect(() => {
    if (!suspended || !nativeStages.current.size) return;
    // Hidden stories must not retain interactive native windows outside the selected stage.
    for (const link of nativeStages.current.values()) link.close();
    nativeStages.current.clear(); setNativeStageIds({ token, ids: [] });
  }, [suspended, token]);

  useEffect(() => {
    if (!plugin) return;
    const nativeLinks = nativeStages.current;
    const syncNativeStages = () => setNativeStageIds({ token, ids: [...nativeLinks.keys()] });
    ready.current = false; submitting.current = false; releasedToken.current = null;
    const timeout = setTimeout(() => {
      if (!ready.current) { setFailedSession(token); live.current.onActiveChange?.(false); live.current.onFailure?.(); }
    }, 5000);
    let operations = Promise.resolve();
    let analysis: AbortController | null = null;
    const receive = (event: MessageEvent) => {
      const isMain = event.source === frame.current?.contentWindow;
      const stageId = [...auxiliary.current].find(([, element]) => element.contentWindow === event.source)?.[0] ?? [...nativeLinks].find(([, link]) => link.peer === event.source)?.[0];
      if (!isMain && !stageId) return;
      if (releasedToken.current === token) return;
      const current = live.current;
      const liveStore = useGameStore.getState();
      const actualScope = `${liveStore.currentWorld?.id ?? ''}:${liveStore.currentPlaythroughId ?? ''}:${liveStore.currentNode?.id ?? ''}:${liveStore.currentSceneId}:${liveStore.worldLine?.id ?? ''}:${archiveScopeSessionValue(liveStore)}`;
      if (actualScope !== current.scope) return;
      if (!current.plugin) return;
      const message = acceptModCommand(event.data, { token: current.token, scope: current.scope, busy: current.context.reading.loading || current.context.reading.paused === true || current.context.reading.inputBlocked === true || submitting.current || isStreamBusy() });
      if (!message) return;
      const recipient = event.source as Window;
      const postContext = () => recipient.postMessage({ channel: 'eidos-mod-context', token: current.token, context: { ...current.context, surface: stageId ? { kind: 'auxiliary', stageId, active: !current.suspended } : { kind: 'main', active: !current.suspended } } }, '*');
      if (message.command === 'failed') {
        if (isMain) { setFailedSession(token); clearTimeout(timeout); current.onActiveChange?.(false); current.onFailure?.(); }
        else if (stageId) {
          nativeLinks.get(stageId)?.close(); nativeLinks.delete(stageId); syncNativeStages();
          const state = liveStore.gameplayModState[current.plugin.id] ?? {}, workspace = workspaceOf(state);
          useGameStore.setState({ gameplayModState: { ...liveStore.gameplayModState, [current.plugin.id]: withWorkspace(state, { ...workspace, stages: workspace.stages.filter(stage => stage.id !== stageId) }) } });
          console.warn(ui("模组辅助舞台 {0} 未能启动，已关闭", {"0": stageId}));
        }
        return;
      }
      if (message.command === 'connect') { postContext(); return; }
      if (message.command === 'ready') {
        if (!isMain) { postContext(); return; }
        ready.current = true; setFailedSession(null); clearTimeout(timeout);
        current.onActiveChange?.(current.plugin?.ui?.reading === 'replace' || current.plugin?.ui?.presentation === 'scene-map'); postContext(); return;
      }
      if (current.suspended) {
        if (message.command === 'rpc') recipient.postMessage({ channel: 'eidos-mod-result', token, scope: current.scope, id: message.id, ok: false, error: '舞台已暂停，请等待当前玩法结束' }, '*');
        return;
      }
      if (!isGameplayPluginActive(current.plugin, liveStore.worldFlags, liveStore.currentSceneId)) return;
      if (message.command === 'rpc') {
        const pluginId = current.plugin.id;
        const access: WorkspaceAccess = {
          scope: current.scope, mailbox: JSON.stringify([liveStore.currentWorld?.id, liveStore.currentPlaythroughId, pluginId]),
          storagePrefix: key => scopeStorageKey(liveStore, key),
          current: () => {
            const s = useGameStore.getState();
            return !live.current.suspended && live.current.token === current.token && releasedToken.current !== token && `${s.currentWorld?.id ?? ''}:${s.currentPlaythroughId ?? ''}:${s.currentNode?.id ?? ''}:${s.currentSceneId}:${s.worldLine?.id ?? ''}:${archiveScopeSessionValue(s)}` === current.scope;
          },
          state: () => useGameStore.getState().gameplayModState[pluginId] ?? {},
          commit: next => useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [pluginId]: withWorkspace(s.gameplayModState[pluginId] ?? {}, next) } })),
        };
        const reply = (ok: boolean, result: unknown) => { if (live.current.token === token) recipient.postMessage({ channel: 'eidos-mod-result', token, scope: current.scope, id: message.id, ok, ...(ok ? { result } : { error: result }) }, '*'); };
        if (message.method === 'resources.cancel') { analysis?.abort(); reply(true, { cancelled: Boolean(analysis) }); return; }
        const execute = async () => {
          try {
            if (offline && (['resources.inspect', 'files.checkout', 'files.reload'].includes(message.method) || message.method.startsWith('stages.') && message.params.mode === 'native')) throw new Error('离线实验室不调用模型或桌面功能');
            const now = live.current.context.reading;
            if (!access.current()) return;
            if (now.paused || now.loading || isStreamBusy()) throw new Error('请等待当前剧情完成后再操作工作区');
            if (message.method === 'world.files.read') {
              if (current.plugin?.ui?.presentation !== 'scene-map') throw new Error('当前模组未声明地图呈现能力');
              reply(true, await readSceneMapFile(useGameStore.getState(), message.params, access.current)); return;
            }
            if (message.method === 'world.notice') {
              allowedFields(message.params, ['message']);
              const notice = message.params.message;
              if (typeof notice !== 'string' || !notice.trim() || notice.length > 1000) throw new Error('提示内容无效');
              current.onNotice?.(notice); reply(true, { delivered: Boolean(current.onNotice) }); return;
            }
            if (message.method === 'world.interact') {
              if (now.inputBlocked || submitting.current || !now.complete && !now.error) throw new Error('请先读完当前回应再继续行动');
              allowedFields(message.params, ['intent', 'state']);
              const scene = buildModScene(useGameStore.getState());
              if (!scene) throw new Error('当前地点不可用');
              const action = worldInteractionInput(message.params.intent, scene, useGameStore.getState().inventory);
              if (message.params.state !== undefined) {
                const next = validateGameModeConfig(record(message.params.state))!;
                useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [pluginId]: authorState(s.gameplayModState[pluginId] ?? {}, next) } }));
              }
              submitting.current = true;
              try { await current.onSubmit(action); reply(true, { submitted: true }); }
              finally { submitting.current = false; }
              return;
            }
            if (message.method === 'gameplay.commit' || message.method === 'gameplay.perform') {
              const perform = message.method === 'gameplay.perform' ? commitGameplayRule : commitGameplayOperation;
              const result = await perform(useGameStore, pluginId, message.params, createStreamRequestScope(useGameStore.getState()));
              if (live.current.token === token) recipient.postMessage({ channel: 'eidos-mod-result', token, scope: current.scope, id: message.id, ok: true, result }, '*');
              return;
            }
            if (message.method === 'gameplay.narrate') {
              const last = gameplayLedger(access.state())?.last;
              if (!last || last.id !== message.params.id) throw new Error('该玩法结果不属于当前进度');
              const queued = last.narration !== 'complete';
              reply(true, { queued });
              if (queued) {
                const request: NarrativeRequest = { kind: 'result', result: { pluginId, id: last.id } };
                submitting.current = true;
                void Promise.resolve(live.current.onSubmit(narrativeInput(request), request)).finally(() => { submitting.current = false; }).catch(() => undefined);
              }
              return;
            }
            if (message.method === 'resources.inspect') {
              if (analysis) throw new Error('已有材料任务正在处理，请先等待或取消');
              const controller = new AbortController(); analysis = controller;
              try { reply(true, await inspectResource(message.params, access, controller.signal, usage => useGameStore.getState().addTokenUsage(usage, liveStore.currentWorld?.id ?? null))); }
              finally { if (analysis === controller) analysis = null; }
            } else {
              if (message.method === 'stages.open' && message.params.mode === 'native') {
                const stage = parseStage(message.params);
                const link = await openNativeStage(stage, token, receive, () => {
                  nativeLinks.delete(stage.id); syncNativeStages();
                  if (access.current()) void runWorkspaceOperation('stages.close', { id: stage.id }, access).catch(error => console.warn('辅助窗口状态更新失败', error));
                });
                if (!access.current()) { link.close(); return; }
                nativeLinks.get(stage.id)?.close(); nativeLinks.set(stage.id, link); syncNativeStages();
                link.activate();
                link.peer.postMessage({ channel: 'eidos-mod-context', token, context: { ...live.current.context, surface: { kind: 'auxiliary', stageId: stage.id, active: !live.current.suspended } } }, '*');
              }
              let result;
              try { result = await runWorkspaceOperation(message.method, message.params, access); }
              catch (error) {
                if (message.method === 'stages.open' && message.params.mode === 'native') { nativeLinks.get(String(message.params.id))?.close(); nativeLinks.delete(String(message.params.id)); syncNativeStages(); }
                throw error;
              }
              if (message.method === 'stages.close') { nativeLinks.get(String(message.params.id))?.close(); nativeLinks.delete(String(message.params.id)); }
              if (message.method.startsWith('stages.') && message.params.mode === 'embedded') { nativeLinks.get(String(message.params.id))?.close(); nativeLinks.delete(String(message.params.id)); }
              syncNativeStages();
              reply(true, result);
            }
          } catch (error) { reply(false, error instanceof Error ? error.message : '模组操作失败'); }
        };
        // Analysis is independent; dragging windows or reading files must stay responsive.
        if (message.method === 'resources.inspect' || message.method === 'world.interact') void execute();
        else operations = operations.then(execute);
        return;
      }
      if (current.context.reading.paused || current.context.reading.inputBlocked && message.command !== 'state') return;
      if (message.command === 'shortcut') { window.dispatchEvent(new CustomEvent(HOST_SHORTCUT_EVENT, { detail: message.action })); return; }
      if (message.command === 'advance') { current.onAdvance(); return; }
      if (message.command !== 'state' && message.command !== 'submit' && message.command !== 'release') return;
      if (!current.plugin) return;
      if (message.state) useGameStore.setState(state => ({ gameplayModState: { ...state.gameplayModState, [current.plugin!.id]: authorState(state.gameplayModState[current.plugin!.id] ?? {}, message.state!) } }));
      if (message.command === 'release' && current.onRelease) { current.onRelease(); return; }
      if (message.command === 'release') { releasedToken.current = token; setReleased(old => ({ ...old, [current.plugin!.id]: current.scope })); current.onActiveChange?.(false); return; }
      if (message.command === 'submit') {
        submitting.current = true;
        // The synchronous latch covers two clicks before React renders loading=true.
        const result = message.narrativeRequest ? current.onSubmit(message.action, message.narrativeRequest) : current.onSubmit(message.action);
        void Promise.resolve(result).catch(() => undefined).finally(() => { submitting.current = false; });
      }
    };
    window.addEventListener('message', receive);
    return () => { analysis?.abort(); for (const link of nativeLinks.values()) link.close(); nativeLinks.clear(); clearTimeout(timeout); window.removeEventListener('message', receive); live.current.onActiveChange?.(false); };
  }, [ui, token, plugin, offline]);
  useEffect(() => {
    if (ready.current) frame.current?.contentWindow?.postMessage({ channel: 'eidos-mod-context', token, context }, '*');
    for (const [stageId, element] of auxiliary.current) element.contentWindow?.postMessage({ channel: 'eidos-mod-context', token, context: { ...context, surface: { kind: 'auxiliary', stageId, active: !suspended } } }, '*');
    for (const [stageId, link] of nativeStages.current) {
      const stage = workspaceOf(context.state).stages.find(s => s.id === stageId);
      if (stage) link.update(stage.html);
      link.peer.postMessage({ channel: 'eidos-mod-context', token, context: { ...context, surface: { kind: 'auxiliary', stageId, active: !suspended } } }, '*');
    }
  });
  if (!plugin) return null;
  const updateStage = (stage: ModStage) => {
    if (reading.loading || reading.paused || isStreamBusy()) return;
    const s = useGameStore.getState(), state = s.gameplayModState[plugin.id] ?? {};
    const access: WorkspaceAccess = { scope, mailbox: '', current: () => live.current.token === token, state: () => state,
      commit: next => useGameStore.setState({ gameplayModState: { ...s.gameplayModState, [plugin.id]: withWorkspace(state, next) } }) };
    void runWorkspaceOperation('stages.update', stage as unknown as Record<string, unknown>, access).catch(error => console.warn('辅助舞台移动失败', error));
  };
  const closeStage = (id: string) => {
    const s = useGameStore.getState(), state = s.gameplayModState[plugin.id] ?? {};
    void runWorkspaceOperation('stages.close', { id }, { scope, mailbox: '', current: () => live.current.token === token, state: () => state,
      commit: next => useGameStore.setState({ gameplayModState: { ...s.gameplayModState, [plugin.id]: withWorkspace(state, next) } }) }).catch(error => console.warn('辅助舞台关闭失败', error));
  };
  return <section className="eidos-mod-surface" data-card-adapter={isCardAdapter(plugin) || undefined} data-reading={plugin.ui?.reading} data-presentation={plugin.ui?.presentation} data-failed={failed || undefined} aria-label={ui("{0}模组舞台", {"0": plugin.name})} hidden={reading.paused || suspended}>
    {eligible.filter(p => Boolean(p.activation) === Boolean(plugin.activation)).length > 1 && <p role="status" className="eidos-mod-notice">{ui("多个舞台同时启用，按安装顺序使用「")}{plugin.name}」。</p>}
    {failed ? <p role="alert" className="eidos-mod-notice">「{plugin.name}{ui("」界面未能启动，已恢复默认阅读。可继续自由行动，检查包内的 JavaScript。")}</p> :
      <iframe key={token} ref={frame} title={plugin.name} sandbox="allow-scripts" data-session={token} data-scope={scope} srcDoc={document}
        onLoad={() => frame.current?.contentWindow?.postMessage({ channel: 'eidos-mod-host-ready', token }, '*')} />}
    {!failed && <ModAuxiliaryStages offline={offline} stages={workspaceOf(context.state).stages.filter(s => s.mode !== 'native' || nativeStageIds.token !== token || !nativeStageIds.ids.includes(s.id))} token={token} scope={scope} register={(id, element) => { if (element) auxiliary.current.set(id, element); else auxiliary.current.delete(id); }} move={updateStage} close={closeStage} />}
  </section>;
}
