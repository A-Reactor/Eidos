'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGameStore } from '@/store/game-store';
import { authorSceneIdentity, captureAuthorRepro, enterAuthorRepro, parseAuthorRepro, type AuthorRepro } from '@/lib/game/author-repro';
import { getPendingActionNodeSave, retryAcceptedActionNode, subscribeActionNodeSave } from '@/lib/game/action-node-commit';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { GameplayModStages } from './GameplayModStages';
import { FileImportCard } from '@/components/ui/FileImportCard';
import { AuthorReproControl } from './settings/AuthorReproControl';

export interface AuthorLabProps {
  initial: AuthorRepro;
  sources?: string[];
  loadSource?: (name: string) => Promise<unknown>;
  subscribeSource?: (fn: (name?: string) => void) => () => void;
}
const json = (value: unknown) => JSON.stringify(value, null, 2);
export function AuthorLab({ initial, sources = [], loadSource, subscribeSource }: AuthorLabProps) {
  const ui = useInterfaceText();
  const state = useGameStore(), epoch = useRef(0), source = useRef('');
  const savePhase = useSyncExternalStore(callback => subscribeActionNodeSave(useGameStore, callback), () => getPendingActionNodeSave(useGameStore)?.phase ?? null, () => null);
  const [scene, setScene] = useState(initial), [checkpoints, setCheckpoints] = useState<AuthorRepro[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [name, setName] = useState(ui("检查点")), [pluginId, setPluginId] = useState(initial.world.gameplayPlugins?.[0]?.id ?? '');
  const [draft, setDraft] = useState(json(initial.snapshot.gameplayModState?.[pluginId] ?? {}));
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [requests, setRequests] = useState<string[]>([]);
  useEffect(() => { enterAuthorRepro(useGameStore, initial); }, [initial]);
  const restore = (next: AuthorRepro) => {
    epoch.current++; const loaded = enterAuthorRepro(useGameStore, next); setScene(loaded); setError('');
    const id = loaded.world.gameplayPlugins?.find(p => p.id === pluginId)?.id ?? loaded.world.gameplayPlugins?.[0]?.id ?? '';
    setPluginId(id); setDraft(json(loaded.snapshot.gameplayModState?.[id] ?? {})); setMessage(ui("已载入：{0}", {"0": loaded.label}));
  };
  const replacePackage = (input: unknown) => {
    const plugins = parsePluginFile(input), live = useGameStore.getState();
    if (plugins.length !== 1) throw new Error('实验时请一次替换一个模组');
    const installed = live.currentWorld!.gameplayPlugins ?? [], next = plugins[0];
    const world = { ...live.currentWorld!, gameplayPluginHistory: undefined, gameplayPlugins: installed.some(p => p.id === next.id) ? installed.map(p => p.id === next.id ? next : p) : [next, ...installed] };
    restore(parseAuthorRepro({ ...scene, world, snapshot: { ...live.createSnapshot(), gameplayPluginSet: undefined }, segments: live.savedSegments }));
    setPluginId(next.id); setDraft(json(useGameStore.getState().gameplayModState[next.id] ?? {}));
    setMessage(ui("已重载 {0}，保留兼容进度；不兼容时请恢复检查点或编辑状态。", {"0": next.name}));
  };
  const reloadSource = async (selected: string) => {
    if (!loadSource || !selected) return;
    source.current = selected; const request = ++epoch.current;
    setSourceName(selected);
    try { const data = await loadSource(selected); if (request === epoch.current) replacePackage(data); }
    catch (cause) { if (request === epoch.current) setError(String(cause instanceof Error ? cause.message : cause)); }
  };
  const reload = useRef(reloadSource); useEffect(() => { reload.current = reloadSource; });
  useEffect(() => subscribeSource?.(name => { if (!name || name === source.current) void reload.current(source.current); }), [subscribeSource]);
  const reading = { segments: state.savedSegments, index: Math.max(0, state.savedSegments.length - 1), displayedText: state.savedSegments.at(-1)?.text ?? '', complete: true, loading: savePhase !== null };
  return <main className="eidos-author-lab h-screen overflow-auto p-5">
    <h1 className="text-xl">{ui("作者实验室 · 离线")}</h1><p className="my-2 text-sm opacity-70">{ui("使用真实模组、结算与回溯。AI 请求仅记录在下面，不生成内容；原卡／媒体原件需另行提供，桌面功能不可用。")}</p>
    <div className="flex flex-wrap items-center gap-3 border-y border-white/20 py-3 text-sm">
      <FileImportCard compact heading={ui("导入复现场景")} description={ui("拖入或选择 JSON")} disabled={savePhase !== null} label={ui("导入复现场景")} inputLabel={ui("复现场景文件")} accept=".json" onFiles={async files => {
        const request = ++epoch.current, identity = authorSceneIdentity(useGameStore.getState());
        const next = parseAuthorRepro(JSON.parse(await files[0].text()));
        if (request === epoch.current) {
          if (identity !== authorSceneIdentity(useGameStore.getState())) throw new Error('现场已变化，请重新选择复现场景');
          source.current = ''; setSourceName(''); restore(next);
        }
      }} />
      <FileImportCard compact heading={ui("替换实验模组")} description={ui("拖入或选择 JSON")} disabled={savePhase !== null} label={ui("替换实验模组")} inputLabel={ui("实验模组文件")} accept=".json" onFiles={async files => {
        const request = ++epoch.current;
        const input = JSON.parse(await files[0].text()); if (request === epoch.current) { source.current = ''; setSourceName(''); replacePackage(input); }
      }} />
      {loadSource && <label>{ui("源码模组")}<select disabled={savePhase !== null} aria-label={ui("源码模组")} className="bg-[#182c3d]" value={sourceName} onChange={e => void reloadSource(e.target.value)}><option value="">{ui("选择目录")}</option>{sources.map(s => <option key={s}>{s}</option>)}</select></label>}
      <button disabled={savePhase !== null} onClick={() => { source.current = ''; setSourceName(''); restore(scene); }}>{ui("重置当前现场")}</button>
      <button disabled={savePhase !== null} onClick={() => { epoch.current++; const parent = state.currentNode?.parentId; if (parent) void state.backtrackToNode(parent).catch(e => setError(String(e))); }}>{ui("回溯实验操作")}</button>
    </div>
    <p role="status" className="py-2 text-sm">{message || ui("当前现场：{0}", {"0": scene.label})}</p>{error && <p role="alert" className="text-red-300">{error}</p>}
    {savePhase === 'saving' && <p role="status">{ui("正在保存已确认的实验结果…")}</p>}
    {savePhase === 'failed' && <div role="alert" className="my-2 border border-amber-500 p-3">{ui("实验结果已接受，本地保存失败。重试只写入，不重新结算。")}<button onClick={() => { setError(''); void retryAcceptedActionNode(useGameStore).catch(() => setError('保存仍未成功，请重试')); }}>{ui("重试保存")}</button></div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="relative min-h-[600px] [&_.eidos-mod-surface]:inset-0" aria-label={ui("实验舞台")}><GameplayModStages authorTools offline reading={reading} onAdvance={() => {}} onSubmit={(action, request) => {
        setRequests(old => [...old.slice(-49), json({ action, request })]); setMessage('已记录叙事请求，没有调用模型。');
      }} /></section>
      <aside className="space-y-3 text-sm">
        <h2>{ui("检查点")}</h2><input aria-label={ui("检查点名称")} className="w-full bg-[#182c3d] p-2" value={name} onChange={e => setName(e.target.value)} />
        <button disabled={savePhase !== null} onClick={async () => { const request = epoch.current; try { const next = await captureAuthorRepro(useGameStore); if (request === epoch.current) setCheckpoints(old => [...old, { ...next, label: name.trim().slice(0, 160) || next.label }]); } catch (e) { setError(String(e)); } }}>{ui("保存检查点")}</button>
        {checkpoints.map((p, i) => <button disabled={savePhase !== null} className="block" key={i} aria-label={ui("恢复{0}", {"0": p.label})} onClick={() => { source.current = ''; setSourceName(''); restore(p); }}>↶ {p.label}</button>)}
        <AuthorReproControl />
        <label className="block">{ui("编辑模组")}<select className="bg-[#182c3d]" value={pluginId} onChange={e => { setPluginId(e.target.value); setDraft(json(state.gameplayModState[e.target.value] ?? {})); }}>{state.currentWorld?.gameplayPlugins?.filter(p => p.ui).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <textarea aria-label={ui("当前模组状态")} className="h-48 w-full bg-[#182c3d] p-2 font-mono text-xs" value={draft} onChange={e => setDraft(e.target.value)} />
        <button onClick={() => setDraft(json(state.gameplayModState[pluginId] ?? {}))}>{ui("读取当前进度")}</button>{' · '}
        <button disabled={savePhase !== null} onClick={() => { try { restore({ ...scene, world: state.currentWorld!, snapshot: { ...state.createSnapshot(), gameplayModState: { ...state.gameplayModState, [pluginId]: JSON.parse(draft) } }, segments: state.savedSegments }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>{ui("应用实验状态")}</button>
        <h2>{ui("待模型处理的请求（")}{requests.length}）</h2><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{requests.join('\n\n') || ui("尚无请求。")}</pre>
      </aside>
    </div>
  </main>;
}
