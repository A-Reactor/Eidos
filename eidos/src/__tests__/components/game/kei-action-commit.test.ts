// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { IdentitySelect } from '@/components/game/IdentitySelect';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { speculativeEngine, speculationScope } from '@/lib/ai/speculation';
import { keiQualityQueue } from '@/lib/ai/kei-review';
import { abortActiveStream, hasPendingKeiApplication, takePendingKeiApplication, hasActiveStream, setPendingResult, setActiveStream, createStreamRequestScope } from '@/lib/game/stream-lifecycle';
import * as cardContexts from '@/lib/game/cards/context';
import { callAi, callAiStream } from '@/lib/ai/client';
import { POST as actionRoute } from '@/app/api/game/action/route';
import { POST as streamRoute } from '@/app/api/game/action/stream/route';
import { NextRequest } from 'next/server';
import { getKeiReviewAuditSnapshot } from '@/lib/ai/kei-review-audit';
import { makeResponse, usage } from '../../lib/ai/kei-fixtures';
import { speechProfile } from '../../fixtures/npc-speech';
import type { WorldSnapshot } from '@/lib/game/types';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { storeBlob, loadBlob } from '@/lib/game/cas-storage';
import type { StorySegment } from '@/lib/ai/types';
import { resourceWorld, event } from '../../lib/game/gameplay-resource-fixtures';
import { openPlugin } from '../../lib/game/plugin-open-fixtures';
import { importCardAsset } from '@/lib/game/cards/storage';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { cardLedger } from '@/lib/game/cards/adapter';
import { normalizeGameplayModState } from '@/lib/game/plugins/mod-ui';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { stageKeiAdvice } from '@/lib/game/kei-advice';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));

vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
const response = makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '守卫无法提供新的可确认内容' } });
function queuedAudit() { const s = useGameStore.getState(); return getKeiReviewAuditSnapshot({ worldId: s.currentWorld!.id, playthroughId: s.currentPlaythroughId }).entries.filter(e => e.phase === 'queued'); }
function material() { const body = vi.mocked(callAi).mock.calls[0][0].userMessage; return JSON.parse(body.slice(body.indexOf('{'))); }
const initial = useGameStore.getState();
beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); takePendingKeiApplication(); speculativeEngine.cancel();
  vi.mocked(callAi).mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('crypto', webcrypto);
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, keiApiKey: 'test-key', aliceApiKey: '' });
  localStorage.setItem('eidos_stream_mode', 'false');
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: `kei_${crypto.randomUUID()}`, currentScene: null,
    currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime, sceneNarrative: '',
    history: [], availableActions: [], savedSegments: [], savedIsShowingSegments: false, isLoading: false,
    worldLine: null, currentNode: null, allNodes: {}, sandboxMode: false,
    midoriSettings: { ...initial.midoriSettings, enabled: false }, momoiSettings: { ...initial.momoiSettings, enabled: false } });
  // Match the real screen initialization before warming a prediction.
  useGameStore.getState().ensureSceneBehaviors(useGameStore.getState().currentSceneId);
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response))));
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function submit() {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '询问守卫驾驶者的身份' } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}
describe('accepted action KEI application', () => {
  it.each(['JSON', 'SSE'])('publishes map, movement, time, inventory and plugin resources together for an accepted %s action', async mode => {
    const s = useGameStore.getState(), origin = s.currentSceneId, parent = s.currentNode!.id;
    const regionId = Object.entries(s.currentWorld!.regions).find(([, region]) => Object.values(region.scenes).some(scene => scene.id === origin))![0];
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, gameplayPlugins: resourceWorld().gameplayPlugins },
      gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 } });
    const result = { ...response, reviewRequest: undefined, timeSpent: { day: 0, hour: 0, minute: 7 },
      mapUpdates: { places: [{ id: 'engine_cellar', name: '地下室', regionId, note: '门后发现的小房间' }], routes: [{ from: origin, to: 'engine_cellar', status: 'open', bidirectional: true }] },
      sceneChanges: ['engine_cellar'], pluginEvents: [event('explore')],
      itemsGained: [{ id: 'engine_letter', name: '测试信件', description: '房间内的信', category: 'document', quantity: 1, value: 0 }],
    };
    localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
    vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
    const observed: Array<{ scene: string; minute: number; letter: boolean; stamina: number; map: boolean }> = [];
    const unsubscribe = useGameStore.subscribe(state => {
      const value = { scene: state.currentSceneId, minute: state.gameTime.minute, letter: state.inventory.some(i => i.id === 'engine_letter'),
        stamina: state.gameplayResources['gameplay.supplies.stamina'], map: Boolean(state.currentWorld?.mapState?.places.engine_cellar) };
      if (value.scene !== origin || value.minute === 7 || value.letter || value.stamina !== 3 || value.map) observed.push(value);
    });
    try {
      render(React.createElement(GameScreen)); submit();
      await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
      await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
      expect(observed.length).toBeGreaterThan(0);
      for (const value of observed) expect(value).toEqual({ scene: 'engine_cellar', minute: 7, letter: true, stamina: 1, map: true });
      expect(useGameStore.getState().history[0]).toMatchObject({ sceneId: 'engine_cellar', sceneName: '地下室', timeSpent: { minute: 7 } });
    } finally { unsubscribe(); }
  });
  it.each(['JSON', 'SSE', 'prediction'])('accepts chapter continuity only with the %s action and restores it on rewind', async mode => {
    const s = useGameStore.getState(), parent = s.currentNode!.id;
    await storeBlob(parent, 'snapshot', s.createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    const narrativeBeat = { chapter: { id: 'letter', title: '未寄出的信' }, recap: '读者看到白槿藏信，主角尚未知情。', threads: ['寄件人'], boundary: 'chapter' as const };
    const result = { ...response, reviewRequest: undefined, narrativeFrame: { kind: 'cutaway' }, narrativeBeat };
    localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
    if (mode === 'prediction') {
      vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(result), usage, elapsedMs: 1 });
      const live = useGameStore.getState();
      await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(live.currentWorld!.id, live.currentPlaythroughId, parent), world: live.currentWorld!, snapshot: live.createSnapshot(), recentHistory: [], inventory: [], clues: live.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: live.weather, protagonistState: live.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: '' } });
      expect(useGameStore.getState().narrativeProgress).toBeNull();
    } else vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    expect(useGameStore.getState().narrativeProgress).toEqual(narrativeBeat);
    const accepted = useGameStore.getState();
    const content = await loadBlob(accepted.currentNode!.segmentHash) as StorySegment[];
    expect(content.at(-1)?.beat).toEqual(narrativeBeat);
    const saved = useGameStore.getState().serializeState();
    const world = useGameStore.getState().currentWorld!;
    await act(async () => { await useGameStore.getState().backtrackToNode(parent); });
    expect(useGameStore.getState().narrativeProgress).toBeNull();
    act(() => useGameStore.getState().deserializeState(saved, world));
    expect(useGameStore.getState().narrativeProgress?.chapter?.id).toBe('letter');
  });
  it.each(['JSON', 'SSE', 'prediction'])('updates the author case and its facts in the same accepted %s free action, and restores on rewind', async mode => {
    const s = useGameStore.getState(), parent = s.currentNode!.id;
    const plugin = { ...resourceWorld().gameplayPlugins[0], ui: { html: '<p>supplies</p>', reading: 'inherit', initialState: { found: [] } } };
    plugin.rules = plugin.rules.map(rule => rule.id === 'explore' ? { ...rule, effects: { state: [{ op: 'add', path: '/found/-', value: 'wick' }], facts: [{ op: 'add', path: '/wick', value: '灯芯有指纹' }] } } : rule);
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([plugin]) }, gameplayModState: { supplies: { found: [] } }, gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 } });
    await storeBlob(parent, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    const result = { ...response, reviewRequest: undefined, pluginEvents: [event('explore')] };
    localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
    if (mode === 'prediction') {
      const live = useGameStore.getState();
      vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(result), usage, elapsedMs: 1 });
      await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(live.currentWorld!.id, live.currentPlaythroughId, parent), world: live.currentWorld!, snapshot: live.createSnapshot(), recentHistory: [], inventory: [], clues: live.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: live.weather, protagonistState: live.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: '' } });
      expect(live.gameplayModState.supplies.found).toEqual([]);
    } else vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    expect(useGameStore.getState().gameplayModState.supplies.found).toEqual(['wick']);
    expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)).toMatchObject({ revision: 1, facts: { wick: '灯芯有指纹' }, last: { narration: 'complete' } });
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
    await act(async () => { await useGameStore.getState().backtrackToNode(parent); });
    expect(useGameStore.getState().gameplayModState.supplies.found).toEqual([]);
    expect(gameplayLedger(useGameStore.getState().gameplayModState.supplies)).toBeUndefined();
  });
  it('keeps a local result after generation failure and retries its prose without settling another operation', async () => {
    const state = useGameStore.getState();
    const world = { ...state.currentWorld!, gameplayPlugins: parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'trial', name: '法庭结果', description: '正式结果测试', tags: [],
      prompts: { creation: '', action: '承接法庭结果', review: '' }, rules: [], ui: { html: '<p>trial</p>', reading: 'inherit' } }]) };
    useGameStore.setState({ currentWorld: world, gameplayModState: { trial: {} } });
    await commitGameplayOperation(useGameStore, 'trial', { id: 'accepted-one', expectedRevision: 0, summary: '第一句证词被推翻', state: { index: 1 }, facts: { broken: 'line-one' } });
    const committed = useGameStore.getState().currentNode!.id, scene = useGameStore.getState().currentSceneId;
    const advanceTime = vi.spyOn(useGameStore.getState(), 'advanceTime');
    const updateWeather = vi.spyOn(useGameStore.getState(), 'updateWeather');
    const sceneDetail = vi.spyOn(useGameStore.getState(), 'increaseSceneDetail');
    const beforeReviewCount = queuedAudit().length;
    const accepted = useGameStore.getState(), scope = createStreamRequestScope(accepted);
    expect(stageKeiAdvice(useGameStore, { approved: true, corrections: '', _reviewMode: 'background', _reviewLevel: 'quality', _reviewSequence: 77,
      _reviewSceneId: scene, _reviewOrigin: { ...scope, parentNodeId: accepted.currentNode!.parentId, actionId: accepted.history.at(-1)!.id },
      npcBehaviorUpdates: [{ npcName: '旧意见人物', currentActivity: '不应在补写时改动', currentMood: '平静', interactingWith: [] }] })).toBe(true);
    let attempts = 0;
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ ...response, reviewRequest: undefined, sceneChanges: ['wrong-scene'], itemsUsed: ['随身笔记'], criticalFactsDiscovered: ['不应重复结算的事实'] }), usage, elapsedMs: 1 });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      attempts++;
      if (attempts === 1) throw new Error('离线模拟正文失败');
      return actionRoute(new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: String(init?.body) }));
    }));
    render(React.createElement(GameScreen));
    const narrate = () => {
      const frame = screen.getByTitle('法庭结果') as HTMLIFrameElement;
      act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command: 'rpc', id: `narrate-${attempts}`, method: 'gameplay.narrate', params: { id: 'accepted-one' } } })));
    };
    narrate(); await waitFor(() => expect(attempts).toBe(1)); await waitFor(() => expect(hasActiveStream()).toBe(false));
    expect(gameplayLedger(useGameStore.getState().gameplayModState.trial)?.last.narration).toBe('pending');
    expect(useGameStore.getState().history).toHaveLength(1); expect(useGameStore.getState().currentNode?.id).toBe(committed);
    narrate(); await waitFor(() => expect(gameplayLedger(useGameStore.getState().gameplayModState.trial)?.last.narration).toBe('complete'));
    expect(useGameStore.getState().history).toHaveLength(2);
    expect(gameplayLedger(useGameStore.getState().gameplayModState.trial)?.revision).toBe(1);
    expect(useGameStore.getState().currentSceneId).toBe(scene);
    expect(useGameStore.getState().criticalFacts).not.toContain('不应重复结算的事实');
    expect(vi.mocked(callAi).mock.calls).toHaveLength(1);
    expect(advanceTime).not.toHaveBeenCalled();
    expect(updateWeather).not.toHaveBeenCalled();
    expect(sceneDetail).not.toHaveBeenCalled();
    expect(queuedAudit()).toHaveLength(beforeReviewCount);
    expect(useGameStore.getState().npcBehaviors['旧意见人物']).toBeUndefined();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(committed));
  });
  async function installConditionalCard(extra?: { variables?: Record<string, unknown>; conditional?: string }) {
    const asset = await importCardAsset(new TextEncoder().encode(JSON.stringify({ name: '守卫原卡', description: '谨慎的守卫', extensions: { eidos: { publicVariables: ['trust'] } }, character_book: { entries: [
      { comment: '[InitVar]', enabled: false, content: JSON.stringify({ trust: 20, secret: '暗号', ...extra?.variables }) },
      { constant: true, content: extra?.conditional ?? "<% if (getvar('stat_data.trust') >= 60) { %>愿意交谈<% } else { %>不愿交谈<% } %>" },
    ] } })), 'conditional.json');
    const s = useGameStore.getState(), world = mountCardWorld({ asset, role: 'world', world: s.currentWorld! });
    useGameStore.setState({ currentWorld: world, gameplayModState: normalizeGameplayModState(world) });
    const parent = s.currentNode!.id;
    await storeBlob(parent, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    return { asset, parent, world };
  }
  it.each([false, true])('rechecks plugin resources after asynchronous card preflight (insufficient=%s)', async insufficient => {
    const { asset, parent } = await installConditionalCard();
    const before = useGameStore.getState();
    useGameStore.setState({ currentWorld: { ...before.currentWorld!, gameplayPlugins: [...before.currentWorld!.gameplayPlugins!, ...resourceWorld().gameplayPlugins] }, gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 } });
    let finish!: () => void;
    const preflight = vi.spyOn(cardContexts, 'preflightCardVariableContext').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, reviewRequest: undefined, pluginEvents: [event('explore')], cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] }))));
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(preflight).toHaveBeenCalled());
    useGameStore.setState({ worldFlags: { background_fact: true }, gameplayResources: { ...useGameStore.getState().gameplayResources, 'gameplay.supplies.stamina': insufficient ? 1 : 5 } });
    finish();
    if (insufficient) {
      await screen.findByRole('heading', { name: '行动未执行' });
      expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
      expect(useGameStore.getState().currentNode?.id).toBe(parent);
      expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
    } else {
      await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
      expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(1);
      expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
    }
    expect(useGameStore.getState().worldFlags.background_fact).toBe(true);
  });
  it('does not settle any variables or resources after cancellation during preflight', async () => {
    const { asset, parent } = await installConditionalCard();
    let finish!: () => void;
    const preflight = vi.spyOn(cardContexts, 'preflightCardVariableContext').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...response, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] })));
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(preflight).toHaveBeenCalled());
    abortActiveStream(); finish(); await waitFor(() => expect(hasActiveStream()).toBe(false));
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    expect(useGameStore.getState().currentNode?.id).toBe(parent);
    expect(useGameStore.getState().history).toEqual([]);
  });
  it('accounts a late JSON usage receipt after cancellation without accepting its gameplay', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const parent = useGameStore.getState().currentNode!.id;
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(finish).toBeTypeOf('function'));
    abortActiveStream(); finish(Response.json({ ...response, _tokenUsage: usage }));
    await waitFor(() => expect(useGameStore.getState().tokensUsed).toBe(usage.totalTokens));
    expect(useGameStore.getState().history).toEqual([]); expect(useGameStore.getState().currentNode?.id).toBe(parent);
  });
  it('keeps a newer request busy when the old streaming HTTP error arrives late', async () => {
    localStorage.setItem('eidos_stream_mode', 'true');
    const replies: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => replies.push(resolve))));
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(replies).toHaveLength(1));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '询问守卫新的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));
    await waitFor(() => expect(replies).toHaveLength(2));
    await act(async () => { replies[0](Response.json({ error: '旧请求失败' }, { status: 422 })); });
    expect(useGameStore.getState().isLoading).toBe(true);
    expect(hasActiveStream()).toBe(true);
    await act(async () => { replies[1](new Response(`data: ${JSON.stringify({ type: 'done', ...response })}\n\n`)); });
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(useGameStore.getState().history[0].playerInput).toBe('询问守卫新的问题');
  });
  it('does not retry a server failure through the non-streaming paid endpoint', async () => {
    const parent = useGameStore.getState().currentNode!.id;
    localStorage.setItem('eidos_stream_mode', 'true');
    const fetcher = vi.fn(async () => Response.json({ error: '上下文预计超过窗口' }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => { expect(fetcher).toHaveBeenCalled(); expect(useGameStore.getState().isLoading).toBe(false); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(useGameStore.getState().currentNode?.id).toBe(parent);
    expect(useGameStore.getState().history).toEqual([]);
  });
  it.each(['JSON', 'SSE', 'prediction'] as const)('settles raw card variables once after %s acceptance and restores them on rewind', async mode => {
    const { asset, parent, world } = await installConditionalCard(), s = useGameStore.getState();
    const accepted = { ...response, reviewRequest: undefined, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] };
    let sent: any;
    if (mode === 'prediction') {
      vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(accepted), usage, elapsedMs: 1 });
      await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(world.id, s.currentPlaythroughId, parent), world, snapshot: s.createSnapshot(), recentHistory: [], inventory: [], clues: s.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: s.weather, protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: '' } });
      expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    } else {
      if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
      vi.stubGlobal('fetch', vi.fn(async (_url, init) => { sent = JSON.parse(init.body); return new Response(mode === 'SSE' ? `data: ${JSON.stringify({ type: 'segments', segments: accepted.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...accepted })}\n\n` : JSON.stringify(accepted)); }));
    }
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.variables.trust).toBe(65);
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(1);
    if (sent) { expect(sent.cardContext.dynamicSuffix).toContain('不愿交谈'); expect(sent.snapshot.gameplayModState).toBeUndefined(); }
    await useGameStore.getState().backtrackToNode(parent);
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.variables.trust).toBe(20);
  });
  it.each(['JSON', 'SSE'] as const)('rejects stale %s card variables before other gameplay effects or time/history', async mode => {
    const { asset, parent } = await installConditionalCard(), s = useGameStore.getState(), time = { ...s.gameTime };
    const invalid = { ...response, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 19, newValue: 65 }] }] };
    if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mode === 'SSE' ? `data: ${JSON.stringify({ type: 'done', ...invalid })}\n\n` : JSON.stringify(invalid))));
    render(React.createElement(GameScreen)); submit(); await screen.findByRole('heading', { name: '行动未执行' });
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    expect(useGameStore.getState().gameTime).toEqual(time); expect(useGameStore.getState().history).toEqual([]);
    expect(useGameStore.getState().currentNode?.id).toBe(parent);
  });
  it.each(['variables', 'branch'] as const)('rejects an update that makes required %s context exceed the budget', async kind => {
    const { asset, parent } = await installConditionalCard(kind === 'variables' ? { variables: { a: 'a', b: 'b', c: 'c' } } : { conditional: "<% if (getvar('trust') >= 60) { %>" + '长'.repeat(25_000) + '<% } %>' });
    const time = { ...useGameStore.getState().gameTime };
    const changes = kind === 'variables' ? ['a', 'b', 'c'].map(path => ({ path, oldValue: path, newValue: path.repeat(8000) })) : [{ path: 'trust', oldValue: 20, newValue: 65 }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes }] }))));
    render(React.createElement(GameScreen)); submit();
    await screen.findByRole('heading', { name: '行动未执行' });
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    expect(useGameStore.getState().gameTime).toEqual(time); expect(useGameStore.getState().currentNode?.id).toBe(parent);
  });
  it('keeps pending introspection from settling a card proposal when the screen remounts', async () => {
    const { asset, parent } = await installConditionalCard();
    const pending = { scope: createStreamRequestScope(useGameStore.getState()), input: '思考目前处境', introspection: true,
      event: { ...response, reviewRequest: undefined, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] } };
    setActiveStream(new AbortController(), pending.scope);
    setPendingResult(pending); render(React.createElement(GameScreen));
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
  });
  it('discards a variable acceptance when its branch changes during context preflight', async () => {
    const { asset, parent } = await installConditionalCard();
    let finish!: () => void;
    const preflight = vi.spyOn(cardContexts, 'preflightCardVariableContext').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] }))));
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(preflight).toHaveBeenCalled());
    useGameStore.setState({ currentSceneId: 'other-scene' }); finish();
    await waitFor(() => expect(hasActiveStream()).toBe(false));
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    expect(useGameStore.getState().currentNode?.id).toBe(parent); expect(useGameStore.getState().history).toEqual([]);
  });
  it('buffers an adopted prediction if the screen leaves during local preflight', async () => {
    const { asset, parent, world } = await installConditionalCard(), s = useGameStore.getState();
    vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify({ ...response, reviewRequest: undefined, cardVariableUpdates: [{ assetId: asset.id, expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] }), usage, elapsedMs: 1 });
    await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(world.id, s.currentPlaythroughId, parent), world, snapshot: s.createSnapshot(), recentHistory: [], inventory: [], clues: s.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: s.weather, protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: '' } });
    let finish!: () => void;
    const preflight = vi.spyOn(cardContexts, 'preflightCardVariableContext').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(preflight).toHaveBeenCalled());
    view.unmount(); preflight.mockRestore(); finish();
    await waitFor(() => expect(hasActiveStream()).toBe(false));
    expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(0);
    render(React.createElement(GameScreen));
    await waitFor(() => expect(cardLedger(useGameStore.getState().gameplayModState, asset.id)?.revision).toBe(1));
  });
  it.each(['JSON', 'SSE'] as const)('projects accepted %s plugin state into optional hints and restores them on rewind', async mode => {
    const state = useGameStore.getState(), root = state.currentNode!.id;
    useGameStore.setState({ currentWorld: { ...state.currentWorld!, gameplayPlugins: parseGameplayPlugins([{ ...openPlugin,
      rules: [{ id: 'find-signal', description: '找到信号源', sets: { found: true }, resourceChanges: { energy: -2 } }],
    }]) }, gameplayResources: { 'gameplay.open-story.energy': 2 }, worldFlags: {} });
    await storeBlob(root, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...state.allNodes, [root]: { ...state.allNodes[root], snapshotHash: root } } });
    const accepted = { ...response, pluginEvents: [{ pluginId: 'open-story', ruleId: 'find-signal' }] };
    if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mode === 'SSE' ? `data: ${JSON.stringify({ type: 'done', ...accepted })}\n\n` : JSON.stringify(accepted))));
    render(React.createElement(GameScreen));
    expect(screen.getByRole('region', { name: '玩法 HUD' }).textContent).toContain('寻找未知信号');
    submit();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(root));
    expect(screen.getByRole('region', { name: '玩法 HUD' }).textContent).not.toContain('寻找未知信号');
    expect(screen.getByRole('region', { name: '玩法 HUD' }).textContent).toContain('可以休息或继续探索');
    await useGameStore.getState().backtrackToNode(root);
    await waitFor(() => expect(screen.getByRole('region', { name: '玩法 HUD' }).textContent).toContain('寻找未知信号'));
    expect(screen.getByRole('region', { name: '玩法 HUD' }).textContent).not.toContain('可以休息或继续探索');
  });
  it.each(['JSON', 'SSE'] as const)('carries renamed identity and opening evidence into the real first %s prompt', async mode => {
    const root = useGameStore.getState().currentNode!.id;
    const identityOptions = [{ id: 'asagiri', name: '朝雾', description: '档案管理员',
      startingScene: useGameStore.getState().currentSceneId, openingNarrative: '朝雾整理着随身的笔记。' }];
    useGameStore.setState({ phase: 'identity', inventory: [], identityOptions: [], currentWorld: { ...useGameStore.getState().currentWorld!, identityOptions } });
    let actualPrompt = '', requests = 0;
    const opening = { ...response, reviewRequest: undefined, itemsGained: [{ id: 'opening-notebook', name: '随身笔记', description: '开场已携带的档案笔记。', category: 'document', quantity: 1, consumable: false }] };
    vi.mocked(callAi).mockImplementation(async options => {
      if (options.role !== 'alice') return new Promise(() => {});
      actualPrompt = options.systemPrompt;
      return { content: JSON.stringify(opening), usage, elapsedMs: 1 };
    });
    vi.mocked(callAiStream).mockImplementation(async options => {
      actualPrompt = options.systemPrompt;
      options.onChunk(JSON.stringify(opening)); options.onDone(JSON.stringify(opening), usage);
    });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/game/action' || url === '/api/game/action/stream') {
        requests++;
        // JSDOM and Node have different AbortSignal constructors; cancellation is covered separately.
        const { signal: _signal, ...localInit } = init ?? {};
        const request = new NextRequest(`http://localhost${url}`, localInit);
        return url.endsWith('/stream') ? streamRoute(request) : actionRoute(request);
      }
      return new Response('{}');
    });
    if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
    const identity = render(React.createElement(IdentitySelect));
    fireEvent.click(await screen.findByRole('button', { name: '选择身份：朝雾' }));
    fireEvent.change(screen.getByLabelText('角色名字'), { target: { value: '小雾' } });
    fireEvent.click(screen.getByRole('button', { name: '进入裂隙之城' }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('playing'));
    identity.unmount();
    render(React.createElement(GameScreen));
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(root));
    expect(actualPrompt).toContain('档案管理员');
    expect(actualPrompt).toContain('朝雾整理着随身的笔记');
    expect(actualPrompt).toContain('"canonicalName":"朝雾"');
    expect(actualPrompt).toContain('"playerName":"小雾"');
    expect(actualPrompt).toContain('首次入场背包清点');
    expect(requests).toBe(1);
    expect(useGameStore.getState().inventory.map(item => item.name)).toEqual(['随身笔记']);
  });
  it.each(['JSON', 'SSE'] as const)('registers opening belongings and restores them from cached history on %s', async mode => {
    const state = useGameStore.getState(), root = state.currentNode!.id;
    useGameStore.setState({ inventory: [] });
    await storeBlob(root, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...state.allNodes, [root]: { ...state.allNodes[root], snapshotHash: root } } });
    const opening = { ...response, itemsGained: [{ id: 'opening-lamp', name: '随身手电', description: '进入街区前便装在口袋里的手电。', category: 'tool', quantity: 1, consumable: false }] };
    if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mode === 'SSE' ? `data: ${JSON.stringify({ type: 'done', ...opening })}\n\n` : JSON.stringify(opening))));
    render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '（进入世界，观察周围）' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(root));
    expect(useGameStore.getState().inventory.map(item => [item.name, item.quantity])).toEqual([['随身手电', 1]]);
    await useGameStore.getState().backtrackToNode(root);
    expect(useGameStore.getState().inventory).toEqual([]);
    await useGameStore.getState().tryMatchChildNode('（进入世界，观察周围）');
    expect(useGameStore.getState().inventory.map(item => [item.name, item.quantity])).toEqual([['随身手电', 1]]);
    expect(useGameStore.getState().serializeState().inventory[0].name).toBe('随身手电');
  });
  it('cancels a toast expiry when leaving the game screen', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const scheduled = vi.spyOn(globalThis, 'setTimeout'), cancelled = vi.spyOn(globalThis, 'clearTimeout');
    const view = render(React.createElement(GameScreen)); submit();
    const index = scheduled.mock.calls.findIndex(call => call[1] === 2500);
    expect(index).toBeGreaterThanOrEqual(0);
    const timer = scheduled.mock.results[index].value;
    view.unmount();
    expect(cancelled).toHaveBeenCalledWith(timer);
  });
  it('waits for the accepted node write before restoring a requested backtrack', async () => {
    const s = useGameStore.getState(), parent = s.currentNode!.id, realAdd = s.addActionNode;
    await storeBlob(parent, 'snapshot', s.createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const delayed = vi.fn(async (...args: Parameters<typeof realAdd>) => { await gate; return realAdd(...args); });
    useGameStore.setState({ addActionNode: delayed });
    render(React.createElement(GameScreen)); submit(); await waitFor(() => expect(delayed).toHaveBeenCalled());
    let restored = false;
    const backtrack = useGameStore.getState().backtrackToNode(parent).then(() => { restored = true; });
    await act(async () => { await Promise.resolve(); });
    expect(restored).toBe(false);
    await act(async () => { finish(); await backtrack; });
    expect(useGameStore.getState().currentNode?.id).toBe(parent);
    expect(useGameStore.getState().history).toEqual([]);
  });
  it('commits plugin flags into the action snapshot and restores them on rewind', async () => {
    const s = useGameStore.getState(), parent = s.currentNode!.id;
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, gameplayPlugins: parseGameplayPlugins([{
      format: 'eidos-gameplay-plugin', version: 1, id: 'clue-test', name: '证据', description: '测试', tags: [],
      prompts: { creation: '', action: '', review: '核查证据' },
      rules: [{ id: 'observe', description: '确认车辆', requires: {}, sets: { observed: true } }],
    }]) }, worldFlags: {} });
    await storeBlob(parent, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, pluginEvents: [{ pluginId: 'clue-test', ruleId: 'observe' }] }))));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(useGameStore.getState().worldFlags['gameplay.clue-test.observed']).toBe(true);
    expect(useGameStore.getState().createSnapshot().worldFlags['gameplay.clue-test.observed']).toBe(true);
    // KEI validates against the action's input snapshot, before the proposed transition.
    expect(vi.mocked(callAi).mock.calls[0][0].systemPrompt).toContain('核查证据');
    expect(vi.mocked(callAi).mock.calls[0][0].systemPrompt).toContain('"pluginId":"clue-test","ruleId":"observe"');
    await useGameStore.getState().backtrackToNode(parent);
    expect(useGameStore.getState().worldFlags['gameplay.clue-test.observed']).toBeUndefined();
  });
  it.each(['JSON', 'SSE', 'prediction'] as const)('settles resources and rewinds the stored ledger on %s acceptance', async mode => {
    const s = useGameStore.getState(), parent = s.currentNode!.id;
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, ...resourceWorld() }, worldFlags: {}, gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 } });
    await storeBlob(parent, 'snapshot', useGameStore.getState().createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    const accepted = { ...response, pluginEvents: [event('explore')] };
    if (mode === 'SSE') {
      localStorage.setItem('eidos_stream_mode', 'true');
      vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ type: 'segments', segments: accepted.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...accepted })}\n\n`)));
    } else if (mode === 'prediction') {
      vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(accepted), usage, elapsedMs: 1 });
      await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], {
        scope: speculationScope(s.currentWorld!.id, s.currentPlaythroughId, parent), world: useGameStore.getState().currentWorld, snapshot: useGameStore.getState().createSnapshot(),
        recentHistory: [], inventory: [], clues: s.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: s.weather,
        protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: 'test' },
      });
    } else vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(accepted))));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    await waitFor(() => expect(useGameStore.getState().currentNode!.id).not.toBe(parent));
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(1);
    expect(useGameStore.getState().createSnapshot().gameplayResources?.['gameplay.supplies.stamina']).toBe(1);
    expect(vi.mocked(callAi).mock.calls.at(-1)?.[0].systemPrompt).toContain('"gameplay.supplies.stamina":3');
    await useGameStore.getState().backtrackToNode(parent);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
  });
  it.each(['JSON', 'SSE'] as const)('preserves the ledger after invalid overspending and ends repeated bad reports honestly on %s', async mode => {
    const s = useGameStore.getState(), time = { ...s.gameTime };
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, ...resourceWorld() }, worldFlags: {}, gameplayResources: { 'gameplay.supplies.stamina': 0, 'gameplay.supplies.food': 0, 'gameplay.supplies.secret': 0 } });
    const invalid = { ...response, pluginEvents: [event('find-food'), event('explore')], sceneChanges: { worldFlags: { 'gameplay.supplies.explored': true } }, gameplayResources: { 'gameplay.supplies.food': 1000 } };
    if (mode === 'SSE') localStorage.setItem('eidos_stream_mode', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mode === 'SSE' ? `data: ${JSON.stringify({ type: 'segments', segments: invalid.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...invalid })}\n\n` : JSON.stringify(invalid), mode === 'SSE' ? { headers: { 'Content-Type': 'text/event-stream' } } : undefined)));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.food']).toBe(0);
    expect(useGameStore.getState().worldFlags).toEqual({});
    expect(useGameStore.getState().gameTime).toEqual(time);
    expect(useGameStore.getState().history[0].summary).toBe('操作未完成');
    expect(useGameStore.getState().history[0].aiResponse).not.toContain(response.segments[0].text);
  });
  it('keeps an unknown plugin event out of world state and records an honest failure after correction exhaustion', async () => {
    const time = { ...useGameStore.getState().gameTime };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, pluginEvents: [{ pluginId: 'unknown', ruleId: 'erase' }] }))));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
    expect(useGameStore.getState().gameTime).toEqual(time);
    expect(useGameStore.getState().history[0].summary).toBe('操作未完成');
    expect(callAi).not.toHaveBeenCalled();
  });
  it('records failure billing from SSE without accepting an action', async () => {
    localStorage.setItem('eidos_stream_mode', 'true');
    const failedUsage = { model: 'alice', promptTokens: 1000, completionTokens: 10, totalTokens: 1010, elapsedMs: 40, callType: 'alice_stream', success: false };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ type: 'usage', usage: failedUsage })}\n\ndata: ${JSON.stringify({ type: 'error', message: 'disconnected' })}\n\n`)));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().tokensUsed).toBe(1010));
    await waitFor(() => expect(hasActiveStream()).toBe(false));
    expect(useGameStore.getState().tokensUsed).toBe(1010);
    expect(useGameStore.getState().history).toHaveLength(0);
    expect(useGameStore.getState().aiCalls).toHaveLength(1);
    expect(useGameStore.getState().aiCalls[0].success).toBe(false);
  });
  it('keeps streamed prose for review when completion happens in another panel', async () => {
    localStorage.setItem('eidos_stream_mode', 'true');
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)));
    const view = render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(hasActiveStream()).toBe(true));
    view.unmount();
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ type: 'segments', segments: response.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...response, segments: undefined })}\n\n`);
    controller.enqueue(bytes); controller.close();
    await waitFor(() => expect(hasActiveStream()).toBe(false));
    render(React.createElement(GameScreen));
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(hasPendingKeiApplication()).toBe(false);
    expect(material().current.responseText).toBe('守卫确认自己没有看见驾驶者。');
  });
  it.each(['JSON', 'SSE', 'fallback'] as const)('submits review immediately when accepting %s', async mode => {
    if (mode !== 'JSON') {
      localStorage.setItem('eidos_stream_mode', 'true');
      vi.stubGlobal('fetch', vi.fn(async url => mode === 'SSE'
        ? new Response(`data: ${JSON.stringify({ type: 'segments', segments: response.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...response, segments: undefined })}\n\n`)
        : String(url).endsWith('/stream') ? new Response('', { status: 404 }) : new Response(JSON.stringify(response))));
    }
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(hasPendingKeiApplication()).toBe(false);
    expect(queuedAudit()[0].origin.actionId).toBe(useGameStore.getState().history[0].id);
    expect(material().gameTime).toEqual({ day: 0, hour: 8, minute: 0 });
    expect(material().current.responseText).toBe('守卫确认自己没有看见驾驶者。');
    expect(callAi).toHaveBeenCalledOnce();
  });
  it('creates an application only after adopting a speculative response', async () => {
    const s = useGameStore.getState();
    vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(response), usage, elapsedMs: 1 });
    await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], {
      scope: speculationScope(s.currentWorld!.id, s.currentPlaythroughId, s.currentNode!.id), world: s.currentWorld, snapshot: s.createSnapshot(),
      recentHistory: [], inventory: s.inventory, clues: s.clues, encyclopedia: s.encyclopedia, criticalFacts: s.criticalFacts, questLog: [], weather: s.weather,
      protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: 'test' },
    });
    expect(hasPendingKeiApplication()).toBe(false);
    expect(keiQualityQueue.actionCount).toBe(0);
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(queuedAudit()[0].origin.parentNodeId).toBe(s.currentNode!.id);
    expect(fetch).not.toHaveBeenCalled(); expect(keiQualityQueue.actionCount).toBe(1);
  });
  it('submits once during reading and does not resubmit when rereading', async () => {
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(hasPendingKeiApplication()).toBe(false);
    expect(callAi).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '守卫确认自己没有看见驾驶者。' }));
    expect(hasPendingKeiApplication()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '守卫确认自己没有看见驾驶者。' }));
    expect(hasPendingKeiApplication()).toBe(false);
  });
  it('does not create an application for a rejected action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...response, validity: { isPossible: false, reason: '无法执行', fantasyResponse: '无法飞行' } }))));
    render(React.createElement(GameScreen)); submit();
    await screen.findByRole('heading', { name: '行动未执行' });
    expect(hasPendingKeiApplication()).toBe(false);
    expect(useGameStore.getState().history).toHaveLength(0);
    expect(callAi).not.toHaveBeenCalled();
  });
});

it.each(['JSON', 'SSE'])('launches a restricted ability only after the accepted %s action was persisted', async mode => {
  const { resolveGameplayPlugins } = await import('@/lib/game/plugins/builtins');
  const before = useGameStore.getState(), root = before.currentNode!.id;
  await storeBlob(root, 'snapshot', before.createSnapshot());
  useGameStore.setState({ currentWorld: { ...before.currentWorld!, gameplayPlugins: resolveGameplayPlugins(['loop-manager']),
    gameModeConfig: { rewind: { anchorLabels: ['黎明'], requires: { 'gameplay.loop-manager.ready': true } } } },
    allNodes: { ...before.allNodes, [root]: { ...before.allNodes[root], label: '黎明', snapshotHash: root } } });
  const result = { ...response, reviewRequest: undefined, segments: [{ type: 'narration', text: '你终于问清：银月是仓库的暗号。坍塌随即将你吞没，能力在这次失败中发动。' }],
    summary: '问清银月暗号后遭遇失败', pluginEvents: [{ pluginId: 'loop-manager', ruleId: 'allow-rewind' }], worldImpacts: [`[BACKTRACK:${root}] 本轮失败触发已设定的能力`], personalityObservations: {} };
  const inference = vi.spyOn(useGameStore.getState(), 'runInference');
  localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
  vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(useGameStore.getState().rewindMemory?.count).toBe(1));
  const s = useGameStore.getState();
  expect(s.currentNode?.parentId).toBe(root); expect(s.currentNode?.id).not.toBe(root);
  expect(s.rewindMemory?.digest).toContain('银月'); expect(s.worldFlags['gameplay.loop-manager.ready']).not.toBe(true);
  expect(Object.keys(s.allNodes)).toHaveLength(3);
  expect(Object.values(s.allNodes).some(n => n.summary === result.summary && n.worldImpacts[0].includes(root))).toBe(true);
  expect(inference).not.toHaveBeenCalled();
});

it('continues the saved game rewind after write-only retry without repeating the triggering action', async () => {
  const storage = await import('@/lib/game/storage');
  const before = useGameStore.getState(), root = before.currentNode!.id;
  await storeBlob(root, 'snapshot', before.createSnapshot());
  useGameStore.setState({ currentWorld: { ...before.currentWorld!, gameModeConfig: { rewind: { anchorLabels: ['黎明'] } } },
    allNodes: { ...before.allNodes, [root]: { ...before.allNodes[root], label: '黎明', snapshotHash: root } } });
  const result = { ...response, reviewRequest: undefined, worldImpacts: [`[BACKTRACK:${root}] 坍塌触发回溯`], summary: '唯一的一次坍塌经历' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(result)));
  const write = vi.spyOn(storage, 'saveMeta').mockRejectedValueOnce(new Error('disk full'));
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(screen.getByRole('button', { name: '重试保存' })).toBeDefined());
  expect(useGameStore.getState().rewindMemory).toBeNull();
  const acceptedCount = useGameStore.getState().history.length;
  fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(useGameStore.getState().rewindMemory?.count).toBe(1));
  expect(useGameStore.getState().history).toHaveLength(1);
  expect(acceptedCount).toBe(1);
  expect(Object.values(useGameStore.getState().allNodes).filter(n => n.summary === result.summary)).toHaveLength(1);
  expect(write.mock.calls.length).toBeGreaterThan(1);
});

it.each(['JSON', 'SSE', 'prediction'])('commits a new character speech profile only when the %s action is adopted', async mode => {
  const parent = useGameStore.getState().currentNode!.id;
  const result = { ...response, reviewRequest: undefined,
    segments: [{ type: 'dialogue' as const, speaker: '佐吉', emotion: 'neutral' as const, text: '我回去问问。' }],
    npcSpeechProfiles: { 佐吉: speechProfile('客气，但不喜欢把话说满。') } };
  localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
  if (mode === 'prediction') {
    vi.mocked(callAi).mockResolvedValueOnce({ content: JSON.stringify(result), usage, elapsedMs: 1 });
    const live = useGameStore.getState();
    await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(live.currentWorld!.id, live.currentPlaythroughId, parent), world: live.currentWorld!, snapshot: live.createSnapshot(), recentHistory: [], inventory: [], clues: live.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: live.weather, protagonistState: live.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: '' } });
    expect(useGameStore.getState().npcPersonalities.佐吉).toBeUndefined();
  } else vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
  expect(useGameStore.getState().npcPersonalities.佐吉?.speechProfile).toEqual(result.npcSpeechProfiles.佐吉);
  const accepted = useGameStore.getState();
  const snapshot = await loadBlob(accepted.currentNode!.snapshotHash) as WorldSnapshot;
  expect(snapshot.npcMemory?.records.佐吉.personality?.speechProfile).toEqual(result.npcSpeechProfiles.佐吉);
});
