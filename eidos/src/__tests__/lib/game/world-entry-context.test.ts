// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { buildEntryContext, entryContextPrompt } from '@/lib/game/world-entry';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { buildWorldContext } from '@/lib/ai/context-builder';
const option = { id: 'archivist', name: '朝雾', description: '整理档案的人。', openingNarrative: '朝雾看向写着“朝雾”的旧店招。', startingScene: 'central_plaza' };
beforeEach(() => { useGameStore.setState(useGameStore.getInitialState()); });
it('keeps each role’s own opening and alias without replacing names inside authored prose', () => {
  const { world } = buildRiftCityStartState();
  const entry = buildEntryContext({ world, playerName: '小雾', startingSceneId: 'central_plaza', option });
  expect(entry).toMatchObject({ source: 'preset', canonicalName: '朝雾', playerName: '小雾', openingNarrative: option.openingNarrative });
  expect(entryContextPrompt(entry, world.id)).toContain('不是其他候选身份的经历');
  expect(entryContextPrompt(entry, world.id)).toContain('同一角色');
  expect(entryContextPrompt(entry, 'other-world')).toBe('');
});
it('leaves a custom identity’s arrival to the first observation rather than copying a prewritten protagonist', () => {
  const { world } = buildRiftCityStartState();
  const entry = buildEntryContext({ world, playerName: '阿宁', startingSceneId: 'central_plaza', customIdentity: '在附近卖茶的老人' });
  expect(entry).toMatchObject({ source: 'custom', openingNarrative: '', identityDescription: '在附近卖茶的老人' });
  expect(entryContextPrompt(entry, world.id)).toContain('首次观察');
  expect(entryContextPrompt(entry, world.id)).not.toContain(option.openingNarrative);
});
it('persists entry context through saves and worldline snapshots; old saves clear previous identity context', () => {
  const { world } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld(world);
  const beforeSelection = useGameStore.getState().createSnapshot();
  const entry = buildEntryContext({ world, playerName: '小雾', startingSceneId: 'central_plaza', option });
  useGameStore.getState().setEntryContext(entry);
  useGameStore.getState().setPlayerName('小雾'); useGameStore.getState().navigateToScene('central_plaza');
  const state = useGameStore.getState(), save = state.serializeState(), snapshot = state.createSnapshot();
  expect(save.entryContext).toEqual(entry); expect(snapshot.entryContext).toEqual(entry);
  state.setEntryContext(null); state.restoreSnapshot(snapshot); expect(useGameStore.getState().entryContext).toEqual(entry);
  state.restoreSnapshot(beforeSelection); expect(useGameStore.getState().entryContext).toEqual(entry);
  expect(useGameStore.getState().playerName).toBe('小雾');
  delete save.entryContext;
  state.deserializeState(save, world); expect(useGameStore.getState().entryContext).toBeNull();
});
it('puts the selected identity into every request even after the initial history was compressed away', () => {
  const { world, snapshot } = buildRiftCityStartState();
  const entry = buildEntryContext({ world, playerName: '小雾', startingSceneId: snapshot.currentSceneId, option });
  const context = buildWorldContext({ world, snapshot: { ...snapshot, playerName: '小雾', entryContext: entry }, historySummary: '很久以后，你重返广场。' });
  expect(context).toContain('本周目入场上下文'); expect(context).toContain('整理档案的人。'); expect(context).toContain('默认主角');
  expect(useGameStore.getState().history).toEqual([]);
});
