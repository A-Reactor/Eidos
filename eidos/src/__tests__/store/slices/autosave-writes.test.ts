// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import * as storage from '@/lib/game/storage';

beforeEach(() => {
  useGameStore.setState(useGameStore.getInitialState());
  useGameStore.getState().cancelBackgroundAutoSave();
  const fixture = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld(fixture.world);
  useGameStore.setState({ currentPlaythroughId: crypto.randomUUID(), playerName: '测试玩家', currentSceneId: fixture.snapshot.currentSceneId, currentScene: Object.values(fixture.world.regions).flatMap(r => Object.values(r.scenes)).find(s => s.id === fixture.snapshot.currentSceneId)!, history: [{ id: 'h1', summary: '已进入城市', gameTime: fixture.snapshot.currentGameTime, snapshot: null }] as never });
});
it('does not rotate or rewrite an unchanged recovery point, and the next real change keeps the earlier point', async () => {
  const spy = vi.spyOn(storage, 'saveToDB');
  const state = useGameStore.getState();
  await state.autoSave();
  const writes = spy.mock.calls.length;
  await Promise.all([state.autoSave(), state.autoSave(), state.autoSave()]);
  expect(spy.mock.calls.length).toBe(writes);
  useGameStore.setState({ phase: 'map', pendingInput: '草稿不会改变恢复点' });
  await state.autoSave(); expect(spy.mock.calls.length).toBe(writes);
  useGameStore.setState({ gameplayModState: { ...state.gameplayModState }, sceneNarrative: '新的剧情' });
  await state.autoSave();
  const current = await storage.loadFromDB(storage.autoSaveDataKey(state.currentPlaythroughId!)) as { state: { sceneNarrative: string } };
  const previous = await storage.loadFromDB(`autosave_prev_data_${state.currentPlaythroughId}`) as { state: { sceneNarrative: string } };
  expect(current.state.sceneNarrative).toBe('新的剧情');
  expect(previous.state.sceneNarrative).not.toBe('新的剧情');
  expect(spy.mock.calls.length).toBeGreaterThan(writes);
  spy.mockRestore();
});
