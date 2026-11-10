// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { assembleLibraryWorlds, rememberLibraryWorldRemoval } from '@/lib/game/library-worlds';
import { renameWorldData, META_WORLDS_KEY } from '@/store/slices/save-slice';
import { loadMeta, saveMeta } from '@/lib/game/storage';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldDefinition } from '@/lib/game/types';
import { useGameStore, loadPlayerWorlds } from '@/store/game-store';

afterEach(() => localStorage.clear());
it('persists renaming, removal and explicit reimport for a seed world', async () => {
  const world = buildRiftCityStartState().world;
  await saveMeta(META_WORLDS_KEY, []);
  const result = await renameWorldData(world.id, '新的名称', [], '新的副标题', world);
  expect(result?.worlds[0]).toMatchObject({ id: world.id, name: '新的名称', subtitle: '新的副标题' });
  const stored = await loadMeta<WorldDefinition[]>(META_WORLDS_KEY);
  expect(assembleLibraryWorlds([world], stored!)[0].name).toBe('新的名称');
  rememberLibraryWorldRemoval(world.id);
  expect(assembleLibraryWorlds([world], [])).toEqual([]);
  expect(assembleLibraryWorlds([world], result!.worlds)[0].name).toBe('新的名称');
});

it('keeps other persisted worlds when adding or removing before the in-memory collection loads', () => {
  const seed = buildRiftCityStartState().world;
  const other = { ...seed, id: 'other', name: '另一个世界' };
  localStorage.setItem('eidos_player_worlds', JSON.stringify([seed, other]));
  useGameStore.setState({ playerWorlds: [] });
  useGameStore.getState().removePlayerWorld(seed.id);
  expect(loadPlayerWorlds().map(world => world.id)).toEqual(['other']);
  useGameStore.setState({ playerWorlds: [] });
  const added = { ...seed, id: 'new' };
  useGameStore.getState().addPlayerWorld(added);
  expect(loadPlayerWorlds().map(world => world.id)).toEqual(['other', 'new']);
  useGameStore.getState().addPlayerWorld({ ...added, name: '更新世界' });
  expect(loadPlayerWorlds().map(world => world.name)).toEqual(['另一个世界', '更新世界']);
});
