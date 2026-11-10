import { expect, it } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { galleryCharacters, galleryScenes } from '@/lib/game/midori/gallery-data';
import { managedImagesFromList } from '@/lib/game/midori/image-manager';
import { applyMapUpdates } from '@/lib/game/map-state';

const file = { url: '/old.png', fileSize: 10, lastModified: 1 };
it('merges initial, mapped, runtime and bound NPC names and keeps one neutral portrait per real character', () => {
  const { world } = buildRiftCityStartState();
  const custom = { ...world, npcs: { '阿_林': '介绍', 'real_happy': '名字' } };
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: world.id, targetType: 'character', targetId: '绑定的人物', slot: 'portrait', imageUrl: '/bound.png', source: 'uploaded' });
  const images = managedImagesFromList(world.id, { sceneImages: [], detailImages: [], illustrations: [], npcImages: [
    { ...file, name: '阿_林_neutral', emotion: 'neutral' }, { ...file, name: '阿_林_happy', emotion: 'happy', url: '/happy.png', lastModified: 99 },
    { ...file, name: 'real_happy', emotion: 'happy' },
  ] }).npcs;
  const characters = galleryCharacters(custom, registry, images, { encyclopedia: [{ type: 'npc', name: '新结识的人' }, { type: 'location', name: '不是人物' }], npcBehaviors: { '行走的人': {} } });
  const names = characters.map(character => character.name);
  expect(names).toEqual(expect.arrayContaining(['阿_林', 'real_happy', '绑定的人物', '新结识的人', '行走的人']));
  expect(names).not.toContain('阿_林_neutral'); expect(names).not.toContain('阿_林_happy'); expect(names).not.toContain('real'); expect(names).not.toContain('不是人物');
  expect(characters.find(character => character.name === '阿_林')?.image?.url).toBe('/old.png');
  expect(characters.find(character => character.name === '绑定的人物')?.boundAsset?.imageUrl).toBe('/bound.png');
});

it('uses the same character identity for a scene annotation while preserving distinct explicit names', () => {
  const { world } = buildRiftCityStartState();
  const names = galleryCharacters(world, createEmptyMidoriAssetRegistry(), []).map(character => character.name);
  expect(names.filter(name => name.startsWith('神秘猫'))).toEqual(['神秘猫']);
  const explicit = { ...world, npcs: { ...world.npcs, '神秘猫（再次出现）': '独立角色' } };
  expect(galleryCharacters(explicit, createEmptyMidoriAssetRegistry(), []).map(character => character.name)).toContain('神秘猫（再次出现）');
});

it('excludes legacy region and portrait rows from the detail category', () => {
  const images = managedImagesFromList('world', { sceneImages: [], illustrations: [], detailImages: [
    { ...file, sceneId: 'npcs', regionId: '林_neutral' }, { ...file, sceneId: 'regions', regionId: '城区' }, { ...file, sceneId: 'plaza', regionId: 'sign' },
  ] });
  expect(images.npcs).toHaveLength(1); expect(images.regions).toHaveLength(1);
  expect(images.details.map(image => image.label)).toEqual(['plaza / sign']);
});

it('includes new map scenes and their NPCs rather than only the original world regions', () => {
  const { world } = buildRiftCityStartState();
  const updated = applyMapUpdates(world, { places: [{ id: 'new_workshop', name: '新工坊', regionId: Object.keys(world.regions)[0], note: '新发现' }] });
  expect(galleryScenes(updated).map(scene => scene.sceneId)).toContain('new_workshop');
  expect(galleryCharacters(updated, createEmptyMidoriAssetRegistry(), [], { currentScene: { ...Object.values(world.regions)[0].scenes[Object.keys(Object.values(world.regions)[0].scenes)[0]], id: 'new_workshop', npcs: ['工坊主人'] } }).map(character => character.name)).toContain('工坊主人');
});

it('merges a persisted reaction summary into its actual character instead of creating a sibling directory item', () => {
  const { world } = buildRiftCityStartState();
  const name = '蓝色大肥鱼', summary = '蓝色大肥鱼：一睁眼就向管理员讨饭吃';
  const custom = { ...world, npcs: { ...world.npcs, [name]: '玩家创建的人物' } };
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: world.id, targetType: 'character', targetId: summary,
    slot: 'portrait', imageUrl: '/fish.png', source: 'uploaded' });
  const source = { encyclopedia: [{ type: 'npc' as const, name: summary }], npcStates: { [summary]: 'reacted' }, relationships: { [summary]: {} } };
  const characters = galleryCharacters(custom, registry, [], source);
  expect(characters.filter(character => character.name.startsWith(name)).map(character => character.name)).toEqual([name]);
});

it('merges reaction aliases for runtime NPCs while preserving explicitly distinct colon-containing names', () => {
  const { world } = buildRiftCityStartState();
  const source = { encyclopedia: [{ type: 'npc' as const, name: '新来的渔夫' }, { type: 'npc' as const, name: '新来的渔夫：向管理员讨饭' }] };
  const custom = { ...world, npcs: { ...world.npcs, '蓝色大肥鱼': '本体', '蓝色大肥鱼：分身': '另一个实际人物' } };
  const names = galleryCharacters(custom, createEmptyMidoriAssetRegistry(), [], source).map(character => character.name);
  expect(names).toContain('新来的渔夫');
  expect(names).not.toContain('新来的渔夫：向管理员讨饭');
  expect(names).toContain('蓝色大肥鱼：分身');
});
