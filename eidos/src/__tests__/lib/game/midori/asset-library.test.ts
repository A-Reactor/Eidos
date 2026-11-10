// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState, buildTestSaveState } from '@/lib/test/fixtures';
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry, findMidoriAsset } from '@/lib/game/midori/asset-registry';

const initial = useGameStore.getInitialState();
const asset = (worldId: string, imageUrl = '/portrait.png') => ({ worldId, targetType: 'character' as const, targetId: '阿林', slot: 'portrait' as const, imageUrl, source: 'uploaded' as const });
beforeEach(() => { localStorage.clear(); useGameStore.setState(initial); });
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(initial); localStorage.clear(); });

it('persists library edits without changing a different active world, then applies them to new games and old saves', async () => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: world });
  await useGameStore.getState().bindMidoriAsset(asset('other-world'));
  expect(useGameStore.getState().midoriAssetRegistry).toEqual(createEmptyMidoriAssetRegistry());
  expect(findMidoriAsset(loadWorldAssetRegistry('other-world'), asset('other-world'))?.imageUrl).toBe('/portrait.png');
  expect(findMidoriAsset(loadWorldAssetRegistry(world.id), asset(world.id))).toBeNull();
  const other = { ...world, id: 'other-world' };
  useGameStore.getState().setCurrentWorld(other);
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(other.id))?.imageUrl).toBe('/portrait.png');
  useGameStore.getState().deserializeState(buildTestSaveState(other, { midoriAssetRegistry: createEmptyMidoriAssetRegistry() }), other);
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(other.id))?.imageUrl).toBe('/portrait.png');
});

it('keeps equal character names in different worlds isolated', async () => {
  const { world } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld(world);
  await useGameStore.getState().bindMidoriAsset(asset(world.id, '/one.png'));
  await useGameStore.getState().bindMidoriAsset(asset('other-world', '/two.png'));
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(world.id))?.imageUrl).toBe('/one.png');
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset('other-world'))).toBeNull();
  await useGameStore.getState().removeMidoriAssetBinding(asset('other-world'));
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(world.id))?.imageUrl).toBe('/one.png');
  expect(findMidoriAsset(loadWorldAssetRegistry('other-world'), asset('other-world'))).toBeNull();
});

it('remembers unbinding so loading an old save does not resurrect it', async () => {
  const { world } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld(world);
  await useGameStore.getState().bindMidoriAsset(asset(world.id));
  const old = useGameStore.getState().serializeState();
  await useGameStore.getState().removeMidoriAssetBinding(asset(world.id));
  useGameStore.getState().deserializeState(old, world);
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(world.id))).toBeNull();
});

it('isolates overrides and removal markers by sandbox dossier', async () => {
  await useGameStore.getState().bindMidoriAsset(asset('same-world', '/ordinary.png'));
  useGameStore.setState({ sandboxMode: true, sandboxDossierId: '002' });
  await useGameStore.getState().bindMidoriAsset(asset('same-world', '/sandbox.png'));
  useGameStore.setState({ sandboxDossierId: '003' });
  await useGameStore.getState().removeMidoriAssetBinding(asset('same-world'));
  expect(findMidoriAsset(loadWorldAssetRegistry('same-world'), asset('same-world'))?.imageUrl).toBe('/ordinary.png');
  expect(findMidoriAsset(loadWorldAssetRegistry('same-world', null, { sandboxMode: true, sandboxDossierId: '002' }), asset('same-world'))?.imageUrl).toBe('/sandbox.png');
  expect(findMidoriAsset(loadWorldAssetRegistry('same-world', null, { sandboxMode: true, sandboxDossierId: '003' }), asset('same-world'))).toBeNull();
});

it('does not commit an in-memory binding when persistence fails and permits retry', async () => {
  const { world } = buildRiftCityStartState();
  useGameStore.getState().setCurrentWorld(world);
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('database full', 'QuotaExceededError'); });
  await expect(useGameStore.getState().bindMidoriAsset(asset(world.id))).rejects.toThrow('database full');
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual({});
  failure.mockRestore();
  await useGameStore.getState().bindMidoriAsset(asset(world.id));
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, asset(world.id))?.imageUrl).toBe('/portrait.png');
});

it('migrates an annotated NPC binding and lets canonical unbinding override older annotated saves', async () => {
  const { world } = buildRiftCityStartState();
  const annotated = { ...asset(world.id), targetId: '神秘猫（再次出现）' };
  const legacy = bindMidoriAsset(createEmptyMidoriAssetRegistry(), annotated);
  useGameStore.getState().deserializeState(buildTestSaveState(world, { midoriAssetRegistry: legacy }), world);
  expect(findMidoriAsset(useGameStore.getState().midoriAssetRegistry, { ...annotated, targetId: '神秘猫' })?.imageUrl).toBe('/portrait.png');
  expect(useGameStore.getState().midoriAssetRegistry.bindings['character:神秘猫（再次出现）:portrait']).toBeUndefined();
  await useGameStore.getState().removeMidoriAssetBinding(annotated);
  useGameStore.getState().deserializeState(buildTestSaveState(world, { midoriAssetRegistry: legacy }), world);
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual({});
});

it('restores a legacy reaction-named portrait under the existing character without losing its image', () => {
  const { world } = buildRiftCityStartState();
  const custom = { ...world, npcs: { ...world.npcs, '蓝色大肥鱼': '玩家创建的人物' } };
  const legacy = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { ...asset(world.id), targetId: '蓝色大肥鱼：一睁眼就向管理员讨饭吃' });
  const restored = loadWorldAssetRegistry(custom, legacy);
  expect(findMidoriAsset(restored, { ...asset(world.id), targetId: '蓝色大肥鱼' })?.imageUrl).toBe('/portrait.png');
  expect(Object.values(restored.bindings).map(binding => binding.targetId)).toEqual(['蓝色大肥鱼']);
});
