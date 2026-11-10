// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { hydrateWorldAssetLibrary, loadWorldAssetRegistry, readWorldAssetRegistry, resetImageLibraryCache, saveWorldImageEdits } from '@/lib/game/midori/asset-library';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { imageResourceId, type ImageResource } from '@/lib/game/midori/image-resource';
import { extractPartialSegments, extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { selectImageResource } from '@/lib/game/midori/image-selection';
const { world } = buildRiftCityStartState();
const lookup = { worldId: world.id, targetType: 'character' as const, targetId: '神秘猫', slot: 'portrait' as const };
const resource = (index: number): ImageResource => ({ id: imageResourceId(`/expressions/${index}.png`), worldId: world.id, type: 'character', targetId: '神秘猫',
  label: `表情${index}`, imageUrl: `/expressions/${index}.png`, tags: ['得意'], description: '表情描述'.repeat(700), source: 'uploaded', createdAt: index, updatedAt: index });
beforeEach(() => { localStorage.clear(); useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world }); });
afterEach(() => vi.restoreAllMocks());
it('stores a large expression catalogue even when localStorage refuses all writes, then reloads it durably', async () => {
  const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('small store full', 'QuotaExceededError'); });
  const images = Array.from({ length: 1600 }, (_, i) => resource(i));
  await saveWorldImageEdits(world.id, { images: images.map(image => ({ id: image.id, image })) });
  resetImageLibraryCache();
  const loaded = await readWorldAssetRegistry(world);
  expect(Object.keys(loaded.images!)).toHaveLength(1600);
  expect(loaded.images![images[1599].id].tags).toEqual(['得意']);
  expect(full).not.toHaveBeenCalled();
});
it('migrates old overrides only after the database transaction commits', async () => {
  const asset = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { ...lookup, imageUrl: '/legacy.png', source: 'uploaded' }).bindings['character:神秘猫:portrait'];
  const key = `eidos_image_assets_${encodeURIComponent(world.id)}`;
  const original = JSON.stringify({ version: 1, overrides: { [asset.id]: asset }, imageOverrides: {} });
  localStorage.setItem(key, original);
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('disk failed'); });
  await expect(hydrateWorldAssetLibrary(world.id)).rejects.toThrow('disk failed');
  expect(localStorage.getItem(key)).toBe(original);
  failure.mockRestore();
  await hydrateWorldAssetLibrary(world.id);
  expect(localStorage.getItem(key)).toBeNull();
  resetImageLibraryCache();
  expect((await readWorldAssetRegistry(world)).bindings[asset.id].imageUrl).toBe('/legacy.png');
});
it('does not publish an expression when the transaction aborts after put success', async () => {
  await useGameStore.getState().saveImageResource(resource(1));
  const before = useGameStore.getState().midoriAssetRegistry;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = put.call(this, value, key);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(useGameStore.getState().saveImageResource(resource(2))).rejects.toThrow();
  expect(useGameStore.getState().midoriAssetRegistry).toBe(before);
  expect(loadWorldAssetRegistry(world).images?.[resource(2).id]).toBeUndefined();
});
it('keeps a player-defined expression through complete and progressive parsing and selects its image', async () => {
  const image = { ...resource(1), description: '' };
  await useGameStore.getState().saveImageResource(image);
  const segment = { type: 'dialogue', speaker: '神秘猫', emotion: '得意', text: '这次轮到我了。' };
  const raw = JSON.stringify({ segments: [segment] });
  expect(extractPartialSegments(raw)[0].emotion).toBe('得意');
  expect(extractSegmentsProgressive(raw).segments[0].emotion).toBe('得意');
  expect(selectImageResource(useGameStore.getState().midoriAssetRegistry, { ...lookup, emotion: '得意' })?.imageUrl).toBe(image.imageUrl);
});
