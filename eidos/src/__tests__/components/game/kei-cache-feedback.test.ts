import { recentActionsForModel } from '@/lib/ai/action-context-diagnostics';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '@/app/page';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { speculativeEngine, speculationScope, type SpeculationInput } from '@/lib/ai/speculation';
import { abortActiveStream, hasActiveStream } from '@/lib/game/stream-lifecycle';
import { callAi } from '@/lib/ai/client';
import { hasPendingKeiReviews, hasBlockingKeiReviews } from '@/lib/ai/kei-review';
import { getKeiReviewAuditSnapshot } from '@/lib/ai/kei-review-audit';
import { setCurrentDirectorFrame } from '@/lib/ai/action-handler';
import type { DirectorFrame } from '@/lib/ai/types';
import { loadBlob } from '@/lib/game/cas-storage';
import * as casStorage from '@/lib/game/cas-storage';
import { makeResponse, usage } from '../../lib/ai/kei-fixtures';

vi.mock('@/lib/ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
const frame: DirectorFrame = { beatFunction: 'recognition', tensionTarget: 'lower', narrativeFocus: [{ target: '守卫', instruction: '确认知识边界后寻找司机', visibility: 'overt', expiresInActions: 2 }], revealBudget: { allowNewSecret: false, maxFactsToReveal: 1, forbiddenFacts: [] }, successCriteria: ['玩家理解守卫无法提供更多信息'] };
const initial = useGameStore.getInitialState();
beforeEach(async () => {
  cleanup(); localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  setCurrentDirectorFrame(null);
  localStorage.setItem("eidos_storage_version", "3");
  vi.stubGlobal("crypto", webcrypto);
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, keiApiKey: 'kei-test', aliceApiKey: '' });
  localStorage.setItem('eidos_stream_mode', 'false');
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: `feedback_${crypto.randomUUID()}`,
    currentScene: null, currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime,
    currentNode: null, worldLine: null, allNodes: {}, history: [], availableActions: [], savedSegments: [], savedIsShowingSegments: false,
    midoriSettings: { ...initial.midoriSettings, enabled: false }, momoiSettings: { ...initial.momoiSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(makeResponse()))));
  vi.mocked(callAi).mockReset();
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function speculationInput(): SpeculationInput {
  const s = useGameStore.getState();
  return { scope: speculationScope(s.currentWorld!.id, s.currentPlaythroughId, s.currentNode!.id), world: s.currentWorld, snapshot: s.createSnapshot(),
    recentHistory: recentActionsForModel(s.history), inventory: s.inventory, clues: s.clues, encyclopedia: s.encyclopedia, criticalFacts: s.criticalFacts,
    questLog: [], weather: s.weather, protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'alice-test', keiApiKey: 'kei-test' } };
}
async function acceptAction() {
  const view = render(React.createElement(Home));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '询问守卫' } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
  await waitFor(() => {
    expect(useGameStore.getState().history).toHaveLength(1);
    expect(useGameStore.getState().currentNode?.actionId).toBe(useGameStore.getState().history[0].id);
  });
  return view;
}
function firstResponse(review: 'background' | 'blocking' = 'background') {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(makeResponse(review === 'background'
    ? { reviewRequest: { reason: 'narrative_stall', evidence: '守卫无法提供新的内容' } }
    : { timelineDeviation: { eventId: useGameStore.getState().currentWorld!.timeline[0].id, newOutcome: '已确认事件因玩家行动改变' } } ))));
}
function submit(input: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: input } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}
function audit() { const s = useGameStore.getState(); return getKeiReviewAuditSnapshot({ worldId: s.currentWorld!.id, playthroughId: s.currentPlaythroughId }).entries; }
describe('KEI feedback into speculative generation', () => {
  it.each(['background', 'blocking'] as const)('applies explicit model withdrawal from %s review without adding reviews', async mode => {
    useGameStore.getState().setDirectorFrame(frame);
    firstResponse(mode);
    vi.mocked(callAi).mockImplementation(async options => ({ content: JSON.stringify(options.callType === 'causal'
      ? { approved: true, corrections: '' }
      : { approved: true, corrections: '', directorFrame: null }), usage, elapsedMs: 1 }));
    await acceptAction();
    await waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    const reviewedNode = useGameStore.getState().currentNode!;
    if (mode === 'background') {
      expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
      expect(audit().some(e => e.phase === 'staged')).toBe(true);
    } else {
      expect(useGameStore.getState().currentDirectorFrame).toBeNull();
      expect(await loadBlob(reviewedNode.snapshotHash)).toMatchObject({ lastDirectorFrame: null });
    }
    submit('继续调查');
    await waitFor(() => expect(useGameStore.getState().currentNode?.actionId).toBe(useGameStore.getState().history[1]?.id));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(request.snapshot.lastDirectorFrame).toBeNull();
    const next = useGameStore.getState().currentNode!;
    expect(await loadBlob(next.snapshotHash)).toMatchObject({ lastDirectorFrame: null });
    expect(vi.mocked(callAi).mock.calls.filter(c => c[0].callType === 'quality')).toHaveLength(1);
    expect(vi.mocked(callAi).mock.calls.every(c => c[0].callType === 'quality' || c[0].callType === 'causal')).toBe(true);
    await act(async () => { await useGameStore.getState().backtrackToNode(reviewedNode.id); });
    expect(useGameStore.getState().currentDirectorFrame).toEqual(mode === 'background' ? frame : null);
  });

  it.each([false, true])('includes ready advice in the immediate next action request, streaming=%s', async streaming => {
    localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
    let responses = 0;
    vi.mocked(fetch).mockImplementation(async () => {
      const data = makeResponse(responses++ === 0 ? { reviewRequest: { reason: 'narrative_stall', evidence: '守卫无法提供新的内容' } } : {});
      return streaming
        ? new Response(`data: ${JSON.stringify({ type: 'segments', segments: data.segments })}\n\ndata: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
        : new Response(JSON.stringify(data));
    });
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 });
    await acceptAction();
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    expect(useGameStore.getState().history).toHaveLength(1);
    submit('继续调查');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(request.snapshot.lastDirectorFrame).toEqual(frame);
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(audit().filter(e => e.phase === 'activated')).toHaveLength(1);
  });

  it('includes ready advice in new predictions immediately after the reviewed node', async () => {
    firstResponse();
    vi.mocked(callAi).mockImplementation(async options => ({
      content: JSON.stringify(options.callType === 'alice_action' ? makeResponse() : { approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1,
    }));
    await acceptAction();
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    act(() => saveSettings({ ...loadSettings(), enableSpeculation: false }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test', enableSpeculation: true }));
    await waitFor(() => expect(vi.mocked(callAi).mock.calls.some(c => c[0].callType === 'alice_action')).toBe(true));
    const predictionCalls = vi.mocked(callAi).mock.calls.filter(c => c[0].callType === 'alice_action');
    expect(predictionCalls.every(c => c[0].systemPrompt.includes('确认知识边界后寻找司机'))).toBe(true);
    expect(useGameStore.getState().history).toHaveLength(1);
  });

  it.each(['background', 'blocking'] as const)('turns preparation and %s review off without preventing normal actions, then reenables both', async mode => {
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test', enableSpeculation: false, enableContentReview: false }));
    firstResponse(mode);
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    await acceptAction();
    expect(callAi).not.toHaveBeenCalled();
    expect(hasPendingKeiReviews()).toBe(false);
    expect(audit().at(-1)).toMatchObject({ phase: 'skipped', reason: 'review_disabled' });
    act(() => saveSettings({ ...loadSettings(), enableSpeculation: true, enableContentReview: true }));
    await waitFor(() => expect(vi.mocked(callAi).mock.calls.some(c => c[0].callType === 'alice_action')).toBe(true));
    firstResponse(); submit('另行调查');
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    await waitFor(() => expect(vi.mocked(callAi).mock.calls.some(c => c[0].callType === 'quality')).toBe(true));
  });

  it('cancels active review and unselected predictions when their settings are saved off', async () => {
    firstResponse();
    let finishReview!: () => void; let finishPrediction!: () => void;
    vi.mocked(callAi).mockImplementation((options) => new Promise(resolve => {
      const finish = () => resolve({ content: JSON.stringify(options.callType === 'alice_action' ? makeResponse() : { approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 });
      if (options.callType === 'alice_action') finishPrediction = finish; else finishReview = finish;
    }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    await acceptAction();
    await waitFor(() => { expect(finishPrediction).toBeTypeOf('function'); expect(finishReview).toBeTypeOf('function'); });
    act(() => saveSettings({ ...loadSettings(), enableSpeculation: false, enableContentReview: false }));
    expect(hasPendingKeiReviews()).toBe(false); expect(speculativeEngine.status).toBe('cancelled');
    await act(async () => { finishReview(); finishPrediction(); });
    expect(speculativeEngine.size).toBe(0); expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    submit('正常行动');
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
  });

  it('lets an already selected prediction finish after pregeneration is turned off', async () => {
    let finish!: () => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify(makeResponse({ summary: 'selected action completed' })), usage, elapsedMs: 1 }); }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test', enableContentReview: false }));
    await acceptAction(); await waitFor(() => expect(finish).toBeTypeOf('function'));
    submit('离开询问货车司机');
    await waitFor(() => expect(speculativeEngine.hasSelectedWait).toBe(true));
    act(() => saveSettings({ ...loadSettings(), enableSpeculation: false }));
    await act(async () => { finish(); });
    await waitFor(() => expect(useGameStore.getState().history[1]?.summary).toBe('selected action completed'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(speculativeEngine.status).toBe('cancelled');
    expect(speculativeEngine.size).toBe(0);
  });

  it('discards staged review advice across a disabled interval instead of applying it when reenabled', async () => {
    firstResponse();
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 });
    await acceptAction(); await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    act(() => saveSettings({ ...loadSettings(), enableContentReview: false }));
    act(() => saveSettings({ ...loadSettings(), enableContentReview: true }));
    submit('正常行动');
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    expect(audit().filter(e => e.phase === 'activated')).toHaveLength(0);
  });

  it('reuses the automatically started in-flight prediction when the player chooses it', async () => {
    firstResponse(); let finishPrediction!: () => void; let predictionCalls = 0;
    vi.mocked(callAi).mockImplementation(async (options) => {
      if (options.callType !== 'alice_action') return await new Promise(() => {});
      predictionCalls++;
      if (predictionCalls === 1) return await new Promise(resolve => { finishPrediction = () => resolve({ content: JSON.stringify(makeResponse({ summary: 'selected in-flight response' })), usage, elapsedMs: 1 }); });
      return { content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 };
    });
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    await acceptAction();
    await waitFor(() => expect(finishPrediction).toBeTypeOf('function'));
    submit('离开询问货车司机');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(fetch).toHaveBeenCalledOnce(); expect(useGameStore.getState().history).toHaveLength(1);
    expect(hasActiveStream()).toBe(true);
    expect(screen.queryByText(/衔接预生成|ALICE 生成/)).toBeNull();
    await act(async () => { finishPrediction(); });
    await waitFor(() => expect(useGameStore.getState().history[1]?.summary).toBe('selected in-flight response'));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['background', 'blocking'] as const)('keeps %s review diagnostics out of the player UI', async mode => {
    firstResponse(mode); vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    await acceptAction();
    expect(hasPendingKeiReviews()).toBe(true);
    expect(screen.queryByText(/KEI 后台审核|KEI 关键复核/)).toBeNull();
  });
  it('buffers selected prediction work while the game screen is unmounted', async () => {
    let finishPrediction!: () => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finishPrediction = () => resolve({ content: JSON.stringify(makeResponse({ summary: 'continued across panel' })), usage, elapsedMs: 1 }); }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    const view = await acceptAction(); await waitFor(() => expect(finishPrediction).toBeTypeOf('function'));
    submit('离开询问货车司机');
    await waitFor(() => expect(hasActiveStream()).toBe(true));
    act(() => useGameStore.getState().setPhase('inventory'));
    view.unmount();
    await act(async () => { finishPrediction(); });
    act(() => useGameStore.getState().setPhase('playing'));
    render(React.createElement(Home));
    await waitFor(() => expect(useGameStore.getState().history[1]?.summary).toBe('continued across panel'));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('hands a selected result to the new instance when remount precedes completion', async () => {
    let finish!: () => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify(makeResponse({ summary: 'after remount' })), usage, elapsedMs: 1 }); }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    const view = await acceptAction(); await waitFor(() => expect(finish).toBeTypeOf('function'));
    submit('离开询问货车司机'); await waitFor(() => expect(hasActiveStream()).toBe(true));
    view.unmount(); render(React.createElement(Home));
    await act(async () => { finish(); });
    await waitFor(() => expect(useGameStore.getState().history[1]?.summary).toBe('after remount'));
    expect(useGameStore.getState().isLoading).toBe(false); expect(fetch).toHaveBeenCalledOnce();
  });
  it('retries a failed local node save before sending the retained next input', async () => {
    vi.spyOn(casStorage, 'hashAndStore').mockRejectedValueOnce(new Error('temporary disk failure'));
    render(React.createElement(Home)); submit('询问守卫');
    const retry = await screen.findByRole('button', { name: '重试保存' });
    expect(useGameStore.getState().history).toHaveLength(1);
    submit('去找司机'); expect(fetch).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    await waitFor(() => { expect(useGameStore.getState().history).toHaveLength(2); expect(useGameStore.getState().currentNode?.actionId).toBe(useGameStore.getState().history[1].id); });
    const s = useGameStore.getState(); expect(s.allNodes[s.currentNode!.parentId!].actionId).toBe(s.history[0].id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('keeps a slow selected prediction and falls back once only after its provider fails', async () => {
    const failures = new Map<string, () => void>();
    vi.mocked(callAi).mockImplementation(options => new Promise((_resolve, reject) => { failures.set(options.userMessage, () => reject(new Error('provider timeout'))); }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    await acceptAction();
    await waitFor(() => expect(speculativeEngine.hasPendingAction('离开询问货车司机', speculationInput().scope)).toBe(true));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submit('离开询问货车司机');
    await waitFor(() => expect(hasActiveStream()).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(hasActiveStream()).toBe(true);
    expect(speculativeEngine.hasSelectedWait).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    vi.useRealTimers();
    await act(async () => { failures.get('离开询问货车司机')!(); });
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a selected prediction completed after leaving the world', async () => {
    let finish!: () => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify(makeResponse({ summary: 'late result' })), usage, elapsedMs: 1 }); }));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    await acceptAction(); await waitFor(() => expect(finish).toBeTypeOf('function'));
    submit('离开询问货车司机'); await waitFor(() => expect(hasActiveStream()).toBe(true));
    act(() => useGameStore.getState().setPhase('world_select'));
    await act(async () => { finish(); });
    expect(useGameStore.getState().history).toHaveLength(1); expect(fetch).toHaveBeenCalledOnce();
    expect(hasActiveStream()).toBe(false);
  });
  it('waits for the local node save so a quick next input remains its child', async () => {
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    const originalHashAndStore = casStorage.hashAndStore;
    let finishSave!: () => void; let held = false;
    vi.spyOn(casStorage, 'hashAndStore').mockImplementation(async (...args) => {
      const hash = await originalHashAndStore(...args);
      if (args[0] === 'snapshot' && !held) { held = true; await new Promise<void>(resolve => { finishSave = resolve; }); }
      return hash;
    });
    render(React.createElement(Home)); submit('询问守卫');
    await waitFor(() => { expect(useGameStore.getState().history).toHaveLength(1); expect(finishSave).toBeTypeOf('function'); });
    submit('去找司机');
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => { finishSave(); });
    await waitFor(() => { expect(useGameStore.getState().history).toHaveLength(2); expect(useGameStore.getState().currentNode?.actionId).toBe(useGameStore.getState().history[1].id); });
    const s = useGameStore.getState();
    expect(s.allNodes[s.currentNode!.parentId!].actionId).toBe(s.history[0].id);
  });
  it.each([false, true])('keeps a prediction prepared before background advice, pending=%s', async pending => {
    firstResponse();
    let finishReview!: () => void; let finishPrediction!: () => void;
    vi.mocked(callAi).mockImplementation(async ({ callType: type }) => {
      if (type !== 'alice_action') return await new Promise(resolve => { finishReview = () => resolve({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 }); });
      if (pending) await new Promise<void>(resolve => { finishPrediction = resolve; });
      return { content: JSON.stringify(makeResponse({ summary: 'already prepared' })), usage, elapsedMs: 1 };
    });
    await acceptAction();
    expect(hasPendingKeiReviews()).toBe(true); expect(hasBlockingKeiReviews()).toBe(false);
    const input = speculationInput(); const warm = speculativeEngine.triggerSpeculation(['离开询问货车司机'], input);
    if (!pending) await warm;
    await act(async () => { finishReview(); });
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    expect(useGameStore.getState().keiQuality.totalReviews).toBe(1);
    if (pending) await act(async () => { finishPrediction(); await warm; });
    expect(speculativeEngine.checkCache('离开询问货车司机', input.scope)?.summary).toBe('already prepared');
  });
  it('adopts the next cached response during a slow review and includes late advice in the next fresh request', async () => {
    firstResponse(); let finishReview!: () => void;
    vi.mocked(callAi).mockImplementation(async (options) => {
      if (options.callType !== 'alice_action') return await new Promise(resolve => { finishReview = () => resolve({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 }); });
      return { content: JSON.stringify(makeResponse({ summary: 'cached continuation' })), usage, elapsedMs: 1 };
    });
    await acceptAction(); const input = speculationInput();
    await speculativeEngine.triggerSpeculation(['离开询问货车司机'], input);
    submit('离开询问货车司机');
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(useGameStore.getState().history[1].summary).toBe('cached continuation');
    expect(fetch).toHaveBeenCalledOnce(); expect(hasPendingKeiReviews()).toBe(true);
    await act(async () => { finishReview(); });
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    submit('继续调查');
    await waitFor(() => expect(useGameStore.getState().currentNode?.actionId).toBe(useGameStore.getState().history[2]?.id));
    const request = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(request.snapshot.lastDirectorFrame).toEqual(frame);
    const node = useGameStore.getState().currentNode!;
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
    expect(await loadBlob(node.snapshotHash)).toMatchObject({ lastDirectorFrame: frame });
    submit('再看一眼');
    await waitFor(() => expect(useGameStore.getState().currentNode?.parentId).toBe(node.id));
    await act(async () => { await useGameStore.getState().backtrackToNode(node.id); });
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
  });
  it('uses activated advice for the following speculative generation without regenerating the cached continuation', async () => {
    firstResponse(); let finishReview!: () => void;
    vi.mocked(callAi).mockImplementation(async (options) => {
      if (options.callType !== 'alice_action') return await new Promise(resolve => { finishReview = () => resolve({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 }); });
      return { content: JSON.stringify(makeResponse({ summary: options.systemPrompt.includes('确认知识边界后寻找司机') ? 'new direction' : 'old direction', availableActions: ['观察新线索'] })), usage, elapsedMs: 1 };
    });
    await acceptAction(); const input = speculationInput();
    await speculativeEngine.triggerSpeculation(['离开询问货车司机'], input);
    await act(async () => { finishReview(); });
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    act(() => saveSettings({ ...loadSettings(), aliceApiKey: 'alice-test' }));
    submit('离开询问货车司机');
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(useGameStore.getState().history[1].summary).toBe('old direction');
    await waitFor(() => expect(speculativeEngine.checkCache('观察新线索', speculationInput().scope)?.summary).toBe('new direction'));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('continues automatic selection while ordinary review is pending', async () => {
    firstResponse(); vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    await acceptAction();
    act(() => saveSettings({ ...loadSettings(), autoAdvance: true, autoSelect: true, autoStopSteps: 1 }));
    fireEvent.click(screen.getByRole('button', { name: '守卫确认自己没有看见驾驶者。' }));
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2), { timeout: 2000 });
    expect(hasPendingKeiReviews()).toBe(true);
    expect(useGameStore.getState().history[1].playerInput).toBe('离开询问货车司机');
  });
  it.each(['success', 'failure', 'timeout'] as const)('retains one manual action until critical review %s', async outcome => {
    firstResponse('blocking'); let finish!: () => void;
    if (outcome === 'timeout') vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(callAi).mockImplementation(options => options.callType === 'causal' ? Promise.resolve({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 }) : new Promise((resolve, reject) => {
      finish = () => outcome === 'failure' ? reject(new Error('provider failed')) : resolve({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 });
    }));
    await acceptAction();
    submit('去找司机'); submit('去找司机');
    expect(fetch).toHaveBeenCalledOnce(); expect(hasBlockingKeiReviews()).toBe(true);
    if (outcome === 'timeout') { await act(async () => { await vi.advanceTimersByTimeAsync(25000); }); await vi.waitFor(() => expect(useGameStore.getState().history).toHaveLength(2)); vi.useRealTimers(); }
    else await act(async () => { finish(); });
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2); expect(useGameStore.getState().history[1].playerInput).toBe('去找司机');
  });
  it('verifies background fact proposals against latest state before generating another action', async () => {
    firstResponse(); let finishReview!: () => void; let finishCheckpoint!: () => void;
    vi.mocked(callAi).mockImplementationOnce(() => new Promise(resolve => { finishReview = () => resolve({ content: JSON.stringify({ approved: false, corrections: '需要核对', correctedUpdates: { criticalFactsDiscovered: ['车主身份未知'] } }), usage, elapsedMs: 1 }); }))
      .mockImplementationOnce(() => new Promise(resolve => { finishCheckpoint = () => resolve({ content: '{"approved":true,"corrections":"提案已失效"}', usage, elapsedMs: 1 }); }));
    await acceptAction();
    await act(async () => { finishReview(); });
    await waitFor(() => expect(audit().some(e => e.phase === 'staged')).toBe(true));
    act(() => useGameStore.getState().addCriticalFact('车主已出示证件'));
    expect(useGameStore.getState().criticalFacts.some(f => f.text === '车主身份未知')).toBe(false);
    submit('继续调查');
    expect(hasBlockingKeiReviews()).toBe(true); expect(fetch).toHaveBeenCalledOnce();
    const body = vi.mocked(callAi).mock.calls[1][0].userMessage;
    const material = JSON.parse(body.slice(body.indexOf('{')));
    expect(material.stateVerification.currentSnapshot.criticalFacts.some((f: { text: string }) => f.text === '车主已出示证件')).toBe(true);
    await act(async () => { finishCheckpoint(); });
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
    expect(useGameStore.getState().criticalFacts.some(f => f.text === '车主身份未知')).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('invalidates predictions and persists actual critical state corrections for backtracking', async () => {
    firstResponse('blocking'); let finishReview!: () => void;
    vi.mocked(callAi).mockImplementation(async (options) => {
      if (options.callType === 'causal') return { content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 };
      if (options.callType === 'alice_action') return { content: JSON.stringify(makeResponse({ summary: 'obsolete prediction' })), usage, elapsedMs: 1 };
      return await new Promise(resolve => { finishReview = () => resolve({ content: JSON.stringify({ approved: false, corrections: '补充核实信息', directorFrame: frame, correctedUpdates: { criticalFactsDiscovered: ['司机能确认车辆去向'] } }), usage, elapsedMs: 1 }); });
    });
    await acceptAction(); const input = speculationInput(); const node = useGameStore.getState().currentNode!;
    await speculativeEngine.triggerSpeculation(['离开询问货车司机'], input);
    await act(async () => { finishReview(); });
    await waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(speculativeEngine.checkCache('离开询问货车司机', input.scope)).toBeNull();
    expect(await loadBlob(useGameStore.getState().allNodes[node.id].snapshotHash)).toMatchObject({ lastDirectorFrame: frame });
    submit('继续调查');
    await waitFor(() => expect(useGameStore.getState().currentNode?.parentId).toBe(node.id));
    await act(async () => { await useGameStore.getState().backtrackToNode(node.id); });
    expect(useGameStore.getState().criticalFacts.some(f => f.text === '司机能确认车辆去向')).toBe(true);
  });
  it('recomputes timeline causality on corrected current facts instead of accepting the old batch', async () => {
    const s = useGameStore.getState();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(makeResponse({ timelineDeviation: { eventId: s.currentWorld!.timeline[0].id, newOutcome: '玩家阻止了事故' } }))));
    let causalCalls = 0; let finishOld!: () => void;
    vi.mocked(callAi).mockImplementation(async (options) => {
      if (options.callType === 'quality') return { content: JSON.stringify({ approved: false, corrections: '已核实', correctedUpdates: { criticalFactsDiscovered: ['道路已经恢复通行'] } }), usage, elapsedMs: 1 };
      causalCalls++;
      if (causalCalls === 1) return await new Promise(resolve => { finishOld = () => resolve({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 }); });
      return { content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 };
    });
    await acceptAction();
    await waitFor(() => expect(causalCalls).toBe(2));
    const causalRequests = vi.mocked(callAi).mock.calls.filter(c => c[0].callType === 'causal');
    expect(causalRequests[0][0].signal?.aborted).toBe(true);
    const body = causalRequests[1][0].userMessage; const material = JSON.parse(body.slice(body.indexOf('{')));
    expect(material.causalRecheck.currentSnapshot.criticalFacts.some((f: { text: string }) => f.text === '道路已经恢复通行')).toBe(true);
    await act(async () => { finishOld(); });
  });
  it('discards a late background result after backtracking to the parent', async () => {
    firstResponse(); let finish!: () => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify({ approved: true, corrections: '', directorFrame: frame }), usage, elapsedMs: 1 }); }));
    await acceptAction(); const s = useGameStore.getState(); const parent = s.allNodes[s.currentNode!.parentId!];
    act(() => { useGameStore.setState({ currentNode: parent, history: [] }); finish(); });
    await waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    expect(audit().at(-1)).toMatchObject({ phase: 'discarded', reason: 'stale_action' });
  });
});
