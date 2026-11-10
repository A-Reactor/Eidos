// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadFromDB, saveToDB } from '@/lib/game/storage';
import type { GameSave } from '@/lib/game/types';

const segments = [{ type: 'narration' as const, text: '她走到街角。' }, { type: 'narration' as const, text: '钟声在她头顶响起。' }];
beforeEach(async () => {
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), playerName: '旅人' });
  useGameStore.getState().restoreSnapshot(snapshot);
  const s = useGameStore.getState(); await s.initWorldLine(s.currentPlaythroughId!, world.id);
  const state = useGameStore.getState(), text = segments.map(s => s.text).join('\n\n');
  const record = { id: crypto.randomUUID(), timestamp: Date.now(), playerInput: '走到街角', aiResponse: text, summary: '到达街角', sceneId: state.currentSceneId, sceneName: '街角', gameTime: state.gameTime,
    timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [], availableActions: ['继续观察'], snapshot: null };
  state.addToHistory(record); const node = await state.addActionNode(record, state.createSnapshot(), segments);
  useGameStore.getState().setNodeReadText(node.id, text);
  useGameStore.setState({ sceneNarrative: '钟声在她头顶响起。', playerName: '旅人' });
  await useGameStore.getState().persistWorldLineData();
});

it('loads the saved paragraph and scene state instead of the old environment introduction', async () => {
  useGameStore.getState().saveSegmentState(segments, 1, true);
  const id = await useGameStore.getState().saveGame('退出位置');
  useGameStore.setState({ savedSegments: [{ type: 'narration', text: '另一个存档的文字' }], savedSegmentIndex: 0 });
  expect(await useGameStore.getState().loadGame(id)).toBe(true);
  const loaded = useGameStore.getState();
  expect(loaded.savedSegments).toEqual(segments);
  expect(loaded.savedSegmentIndex).toBe(1); expect(loaded.savedIsShowingSegments).toBe(true);
  expect(loaded.sceneNarrative).toBe('钟声在她头顶响起。');
});

it('opens the latest node from an old save with no playback cursor without leaking another save', async () => {
  const id = await useGameStore.getState().saveGame('旧档');
  const save = await loadFromDB(`save_data_${id}`) as GameSave;
  delete save.state.playbackPosition;
  await saveToDB(`save_data_${id}`, save);
  useGameStore.setState({ savedSegments: [{ type: 'narration', text: '另一世界的残留' }], savedSegmentIndex: 42, savedIsShowingSegments: true });
  expect(await useGameStore.getState().loadGame(id)).toBe(true);
  expect(useGameStore.getState().savedSegments).toEqual(segments);
  expect(useGameStore.getState().savedSegmentIndex).toBe(1);
});

it('clears stale playback on deserialize when no worldline exists', () => {
  const s = useGameStore.getState(), state = s.serializeState();
  useGameStore.setState({ savedSegments: segments, savedSegmentIndex: 1, savedIsShowingSegments: true });
  s.deserializeState(state, s.currentWorld!);
  expect(useGameStore.getState().savedSegments).toEqual([]);
  expect(useGameStore.getState().savedIsShowingSegments).toBe(false);
});
