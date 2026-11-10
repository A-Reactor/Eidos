// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { speculativeEngine, speculationScope } from '@/lib/ai/speculation';
import { abortActiveStream, takePendingKeiApplication } from '@/lib/game/stream-lifecycle';
import { callAi } from '@/lib/ai/client';
import { makeResponse, usage } from '../../lib/ai/kei-fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { storeBlob, loadBlob } from '@/lib/game/cas-storage';
import type { StorySegment } from '@/lib/ai/types';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));

vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
const nativeAuto = vi.hoisted(() => ({ continue: (_request: { kind: 'continue' }) => {} }));
vi.mock('@/components/game/use-native-reading-continuation', () => ({ useNativeReadingContinuation: (options: { onContinue: typeof nativeAuto.continue }) => { nativeAuto.continue = options.onContinue; } }));
const response = makeResponse();
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
import { openChapter } from '../../lib/game/chapter-fixtures';
import { chapterBasis } from '@/lib/game/chapters/state';

describe('formal chapter acceptance', () => {
  function install() {
    const s = useGameStore.getState();
    const plugin = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'chapter-narrative', name: '篇章叙事', description: '篇章测试', tags: [], rules: [], prompts: { creation: '', action: '', review: '' } }]);
    useGameStore.setState({ currentWorld: { ...s.currentWorld!, isPlayerCreated: true, gameplayPlugins: plugin }, chapterState: null });
    return useGameStore.getState();
  }
  it.each(['JSON', 'SSE', 'prediction'])('commits only accepted %s prose, projects one title and rewinds its evidence', async mode => {
    const s = install(), parent = s.currentNode!.id;
    await storeBlob(parent, 'snapshot', s.createSnapshot());
    useGameStore.setState({ allNodes: { ...s.allNodes, [parent]: { ...s.allNodes[parent], snapshotHash: parent } } });
    const preparation = { basis: chapterBasis(s.currentWorld!.id, null), decision: openChapter() };
    const result = { ...response, chapterPreparation: preparation, narrativeBeat: { chapter: { id: 'invented', title: 'ALICE另起标题' } } };
    localStorage.setItem('eidos_stream_mode', mode === 'SSE' ? 'true' : 'false');
    if (mode === 'prediction') {
      vi.mocked(callAi).mockImplementation(async args => ({ content: JSON.stringify(args.role === 'kei' ? openChapter() : result), usage, elapsedMs: 1 }));
      await speculativeEngine.triggerSpeculation(['询问守卫驾驶者的身份'], { scope: speculationScope(s.currentWorld!.id, s.currentPlaythroughId, parent), world: s.currentWorld!, snapshot: s.createSnapshot(), recentHistory: [], inventory: [], clues: s.clues, encyclopedia: [], criticalFacts: [], questLog: [], weather: s.weather, protagonistState: s.protagonistState, clientSettings: { aliceApiKey: 'test', keiApiKey: 'test-key' } });
      expect(useGameStore.getState().chapterState).toBeNull();
    } else vi.stubGlobal('fetch', vi.fn(async () => mode === 'SSE' ? new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`) : Response.json(result)));
    render(React.createElement(GameScreen)); submit();
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    const accepted = useGameStore.getState(), chapter = accepted.chapterState!;
    expect(chapter.activeId).toBe('clock');
    expect(chapter.experiences).toHaveLength(1);
    expect(chapter.experiences[0]).toMatchObject({ actionId: accepted.history[0].id, inputSource: 'player' });
    expect(chapter.chapters[0].openedAt).toBe(accepted.history[0].id);
    const segments = await loadBlob(accepted.currentNode!.segmentHash) as StorySegment[];
    expect(chapter.experiences[0].segments).toEqual(segments.map(s => s.text));
    expect(segments.at(-1)?.beat?.chapter?.id).toBe('clock');
    expect(accepted.narrativeProgress?.chapter?.id).toBe('clock');
    const saved = accepted.serializeState();
    await act(async () => { await useGameStore.getState().backtrackToNode(parent); });
    expect(useGameStore.getState().chapterState).toBeNull();
    act(() => useGameStore.getState().deserializeState(saved, s.currentWorld!));
    expect(useGameStore.getState().chapterState).toEqual(chapter);
    expect(useGameStore.getState().createSnapshot().chapterState).toEqual(chapter);
  });
  it('rejects stale chapter preparation before accepting prose or world effects', async () => {
    const s = install();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...response, chapterPreparation: { basis: { worldId: s.currentWorld!.id, revision: 7, lastActionId: 'future' }, decision: openChapter() }, criticalFactsDiscovered: ['不能入账'] })));
    render(React.createElement(GameScreen)); submit();
    await screen.findByRole('heading', { name: '行动未执行' });
    expect(useGameStore.getState().chapterState).toBeNull();
    expect(useGameStore.getState().history).toEqual([]);
    expect(useGameStore.getState().criticalFacts).not.toContain('不能入账');
  });
  it('labels native automatic continuation as automatic rather than a player preference', async () => {
    const s = install(), parent = s.currentNode!.id;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...response, chapterPreparation: { basis: chapterBasis(s.currentWorld!.id), decision: openChapter() } })));
    render(React.createElement(GameScreen));
    act(() => nativeAuto.continue({ kind: 'continue' }));
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).not.toBe(parent));
    expect(useGameStore.getState().chapterState?.experiences[0].inputSource).toBe('automatic');
  });

});
