// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { subscribeTokenUsage } from '@/lib/ai/client';
import { speculativeEngine, speculationScope, type SpeculationInput } from '@/lib/ai/speculation';
import { abortActiveStream, hasActiveStream } from '@/lib/game/stream-lifecycle';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { makeResponse } from '../../lib/ai/kei-fixtures';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));

const initial = useGameStore.getInitialState();
const action = '询问守卫';
const response = makeResponse({ availableActions: [] });
let unsubscribe = () => {};

function providerResponse() {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100,
      prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 },
  }));
}

function speculationInput(): SpeculationInput {
  const s = useGameStore.getState();
  return { scope: speculationScope(s.currentWorld!.id, s.currentPlaythroughId, s.currentNode!.id),
    world: s.currentWorld, snapshot: s.createSnapshot(), recentHistory: [], inventory: s.inventory,
    clues: s.clues, encyclopedia: s.encyclopedia, criticalFacts: s.criticalFacts, questLog: [],
    weather: s.weather, protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test-key' } };
}

function submit() {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: action } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}

function expectSingleCharge() {
  const s = useGameStore.getState();
  expect(s.tokensUsed).toBe(1100);
  expect(s.aiCalls).toHaveLength(1);
  expect(s.tokenDetail.aliceCached).toBe(800);
  expect(s.worldTokenUsage[s.currentWorld!.id].tokensUsed).toBe(1100);
}

function expectNoRepeatedSelectedRequest() {
  // Remounting can prepare other recommended actions; reusing this selected action must not request it again.
  const selectedRequests = vi.mocked(fetch).mock.calls.filter(([url, options]) =>
    String(url).endsWith('/chat/completions') && JSON.parse(String(options?.body)).messages.at(-1).content === action);
  expect(selectedRequests).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/api/game/action'))).toBe(false);
}

beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  vi.stubGlobal('crypto', webcrypto);
  saveSettings({ ...loadSettings(), aliceApiKey: 'test-key', keiApiKey: '', autoAdvance: false,
    autoSelect: false, enableSpeculation: true, enableContentReview: false });
  localStorage.setItem('eidos_stream_mode', 'false');
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world,
    currentPlaythroughId: `usage_${crypto.randomUUID()}`, currentScene: null,
    currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime,
    currentNode: null, worldLine: null, allNodes: {}, history: [], availableActions: [],
    savedSegments: [], savedIsShowingSegments: false,
    midoriSettings: { ...initial.midoriSettings, enabled: false },
    momoiSettings: { ...initial.momoiSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  // The page's subscription records client-side requests as soon as the provider completes.
  unsubscribe = subscribeTokenUsage(usage => useGameStore.getState().addTokenUsage(usage),
    () => useGameStore.getState().currentWorld?.id ?? null);
  vi.stubGlobal('fetch', vi.fn(async () => providerResponse()));
});
afterEach(async () => {
  cleanup(); unsubscribe(); abortActiveStream(); speculativeEngine.cancel();
  const store = useGameStore.getState();
  await Promise.all([store.loadPersistedTokens(), store.hydrateModelAnalytics()]);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('one charge per speculative provider request', () => {
  it('adopts a completed prediction without charging its usage again, while updating the foreground context', async () => {
    render(React.createElement(GameScreen));
    await act(async () => { await speculativeEngine.triggerSpeculation([action], speculationInput()); });
    expectSingleCharge();
    expect(useGameStore.getState().worldAliceContext).toEqual({});
    submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expectSingleCharge();
    expectNoRepeatedSelectedRequest();
    expect(useGameStore.getState().worldAliceContext[useGameStore.getState().currentWorld!.id].inputTokens).toBe(1000);
  });

  it.each([false, true])('charges a selected pending prediction once when completion is buffered=%s', async buffered => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/api/game/runtime-log')
      ? Promise.resolve(new Response('{}')) : new Promise(resolve => { finish = resolve; }));
    const view = render(React.createElement(GameScreen));
    let warm!: Promise<void>;
    act(() => { warm = speculativeEngine.triggerSpeculation([action], speculationInput()); });
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    submit();
    await waitFor(() => expect(speculativeEngine.hasSelectedWait).toBe(true));
    if (buffered) view.unmount();
    await act(async () => { finish(providerResponse()); await warm; });
    await waitFor(() => expect(hasActiveStream()).toBe(false));
    if (buffered) {
      expectSingleCharge();
      expect(useGameStore.getState().history).toHaveLength(0);
      render(React.createElement(GameScreen));
    }
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expectSingleCharge();
    expectNoRepeatedSelectedRequest();
    expect(useGameStore.getState().worldAliceContext[useGameStore.getState().currentWorld!.id].inputTokens).toBe(1000);
  });

  it.each([false, true])('automatically warms and reuses a choice after long reading, phone=%s', async phone => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: phone, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    useGameStore.setState({ availableActions: [action] });
    render(React.createElement(GameScreen));
    await waitFor(() => expect(speculativeEngine.size).toBe(1));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now + 120_000);
    submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expect(useGameStore.getState().speculationHits).toBe(1);
    expectNoRepeatedSelectedRequest();
    expectSingleCharge();
  });

  it('keeps the phone selected request alive beyond the former eight-second cutoff', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(url => String(url).endsWith('/api/game/runtime-log')
      ? Promise.resolve(new Response('{}')) : new Promise(resolve => { finish = resolve; }));
    useGameStore.setState({ availableActions: [action] });
    render(React.createElement(GameScreen));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    // Fake gameplay timers without stalling fake IndexedDB's setImmediate queue.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await act(async () => { submit(); });
      expect(speculativeEngine.hasSelectedWait).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
      expect(speculativeEngine.hasSelectedWait).toBe(true);
      await act(async () => { finish(providerResponse()); });
      expect(useGameStore.getState().history).toHaveLength(1);
      expectNoRepeatedSelectedRequest();
      expectSingleCharge();
    } finally { vi.useRealTimers(); }
  });

  it('still charges a fresh server action returned through JSON', async () => {
    saveSettings({ ...loadSettings(), enableSpeculation: false });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...response,
      _tokenUsage: { model: 'alice', promptTokens: 1000, completionTokens: 100, totalTokens: 1100,
        cachedTokens: 800, elapsedMs: 10, callType: 'alice_action' } })));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
    expectSingleCharge();
    const state = useGameStore.getState();
    expect(state.speculationHits).toBe(0);
    expect(state.speculationMisses).toBe(0);
    expect(state.modelAnalytics?.worlds[state.currentWorld!.id].speculationMisses).toBe(0);
  });
});
