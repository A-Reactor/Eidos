// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { imageTag, imageTags } from '@/lib/game/midori/image-tags';
import { imageResourceId, type ImageResource } from '@/lib/game/midori/image-resource';
import { selectImageResource } from '@/lib/game/midori/image-selection';
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { imageCatalogForState, imageCatalogPrompt, parseImageCatalog } from '@/lib/game/midori/image-context';
import { rememberIllustrationDrafts } from '@/lib/game/midori/illustration-drafts';
import { worldImageResources } from '@/lib/game/midori/resource-catalog';
import { managedImagesFromList } from '@/lib/game/midori/image-manager';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { speculationStateKey } from '@/lib/ai/speculation';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';

const { world } = buildRiftCityStartState();
const resource = (name: string, patch: Partial<ImageResource> = {}): ImageResource => ({
  id: imageResourceId(`/${name}.png`), imageUrl: `/${name}.png`, worldId: world.id, type: 'character', targetId: '神秘猫', label: '神秘猫',
  tags: ['平静'], description: '白色毛发', source: 'uploaded', createdAt: 1, updatedAt: 1, ...patch,
});
const lookup = { worldId: world.id, targetType: 'character' as const, targetId: '神秘猫', slot: 'portrait' as const };
beforeEach(() => { localStorage.clear(); useGameStore.setState(useGameStore.getInitialState()); useGameStore.getState().setCurrentWorld(world); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('normalizes basic aliases and Unicode while retaining custom tags and removing duplicates', () => {
  expect(imageTags([' happy ', '开心', 'ＮＥＵＴＲＡＬ', '夜间礼服', ' night ', 'NIGHT', '\n'])).toEqual(['开心', '平静', '夜间礼服', 'night']);
  expect(imageTag('rain')).toBe('雨');
  expect(imageTags(Array.from({ length: 40 }, (_, i) => `标签${i}`))).toHaveLength(32);
});

it('keeps multiple images, the first default, and edited tags after loading older saves', async () => {
  const store = useGameStore.getState();
  await store.bindMidoriAsset({ ...lookup, imageUrl: '/original.png', source: 'uploaded' });
  const oldSave = store.serializeState();
  await store.saveImageResource(resource('happy', { tags: ['happy', '夜间礼服'] }));
  await store.saveImageResource(resource('sad', { tags: ['sad'] }));
  expect(Object.keys(useGameStore.getState().midoriAssetRegistry.images!)).toHaveLength(3);
  expect(useGameStore.getState().midoriAssetRegistry.bindings['character:神秘猫:portrait'].imageUrl).toBe('/original.png');
  await store.saveImageResource(resource('happy', { tags: ['夜间礼服'], description: '编辑后的描述' }));
  store.deserializeState(oldSave, world);
  expect(useGameStore.getState().midoriAssetRegistry.images![imageResourceId('/happy.png')]).toMatchObject({ tags: ['夜间礼服'], description: '编辑后的描述' });
  expect(selectImageResource(useGameStore.getState().midoriAssetRegistry, { ...lookup, emotion: 'happy' })?.imageUrl).toBe('/original.png');
  expect(selectImageResource(useGameStore.getState().midoriAssetRegistry, { ...lookup, imageId: imageResourceId('/happy.png') })?.imageUrl).toBe('/happy.png');
});

it('commits resource and default changes atomically and retries after quota failure', async () => {
  await useGameStore.getState().saveImageResource(resource('one'));
  const before = useGameStore.getState().midoriAssetRegistry;
  const full = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('database full', 'QuotaExceededError'); });
  await expect(useGameStore.getState().saveImageResource(resource('two'), true)).rejects.toThrow('database full');
  expect(useGameStore.getState().midoriAssetRegistry).toBe(before);
  expect(loadWorldAssetRegistry(world).images).toEqual(before.images);
  full.mockRestore();
  await useGameStore.getState().saveImageResource(resource('two'), true);
  expect(loadWorldAssetRegistry(world).bindings['character:神秘猫:portrait'].imageUrl).toBe('/two.png');
});

it('does not restore an explicitly unbound default when editing image metadata', async () => {
  const image = resource('one');
  await useGameStore.getState().saveImageResource(image);
  await useGameStore.getState().removeMidoriAssetBinding(lookup);
  await useGameStore.getState().saveImageResource({ ...image, tags: [], description: '修改后的描述' });
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual({});
  expect(loadWorldAssetRegistry(world).bindings).toEqual({});
});

it('lets old per-expression bindings participate in both tag matching and explicit image references', () => {
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { ...lookup, slot: 'emotion', variant: 'happy', imageUrl: '/legacy-happy.png', source: 'uploaded' });
  expect(selectImageResource(registry, { ...lookup, emotion: 'happy' })?.imageUrl).toBe('/legacy-happy.png');
  expect(selectImageResource(registry, { ...lookup, emotion: 'sad', imageId: imageResourceId('/legacy-happy.png') })?.imageUrl).toBe('/legacy-happy.png');
});

it('keeps deletion tombstones over both old saves and cached file listings', async () => {
  const image = resource('one');
  await useGameStore.getState().saveImageResource(image);
  const saved = useGameStore.getState().serializeState();
  await useGameStore.getState().removeImageResource(world.id, image.id);
  useGameStore.getState().deserializeState(saved, world);
  const registry = useGameStore.getState().midoriAssetRegistry;
  expect(registry.images?.[image.id]).toBeUndefined();
  expect(selectImageResource(registry, lookup)).toBeNull();
  const managed = managedImagesFromList(world.id, { sceneImages: [], detailImages: [], illustrations: [], npcImages: [{ name: '神秘猫', url: image.imageUrl!, fileSize: 1, lastModified: 1 }] });
  expect(worldImageResources(world, registry, managed).some(resource => resource.id === image.id)).toBe(false);
});

it('isolates multiple-image metadata by world and dossier without changing the active registry', async () => {
  await useGameStore.getState().saveImageResource(resource('ordinary'));
  const before = useGameStore.getState().midoriAssetRegistry;
  await useGameStore.getState().saveImageResource(resource('other', { worldId: 'other' }));
  expect(useGameStore.getState().midoriAssetRegistry).toBe(before);
  expect(loadWorldAssetRegistry('other').images?.[imageResourceId('/other.png')]?.worldId).toBe('other');
  useGameStore.setState({ sandboxMode: true, sandboxDossierId: '002', midoriAssetRegistry: createEmptyMidoriAssetRegistry() });
  await useGameStore.getState().saveImageResource(resource('sandbox'));
  expect(Object.keys(loadWorldAssetRegistry(world).images!)).toEqual([imageResourceId('/ordinary.png')]);
  expect(Object.keys(loadWorldAssetRegistry(world, null, { sandboxMode: true, sandboxDossierId: '002' }).images!)).toEqual([imageResourceId('/sandbox.png')]);
});

it('chooses emotion and weather variants, validates explicit references, and preserves the default fallback', async () => {
  const save = useGameStore.getState().saveImageResource;
  await save(resource('neutral'));
  await save(resource('smile', { tags: ['开心', '礼服'], updatedAt: 9 }));
  await save(resource('wrong-person', { targetId: '另一个人', tags: ['开心'], updatedAt: 10 }));
  const registry = useGameStore.getState().midoriAssetRegistry;
  expect(selectImageResource(registry, { ...lookup, emotion: 'happy' })?.imageUrl).toBe('/smile.png');
  expect(selectImageResource(registry, { ...lookup, emotion: 'smiling' })?.imageUrl).toBe('/smile.png');
  expect(selectImageResource(registry, { ...lookup, emotion: 'angry', imageId: imageResourceId('/wrong-person.png') })?.imageUrl).toBe('/neutral.png');
  expect(selectImageResource(registry, { ...lookup, worldId: 'other' })).toBeNull();
  await save(resource('sun', { type: 'scene', targetId: 'central_plaza', tags: ['晴'] }));
  await save(resource('rain', { type: 'scene', targetId: 'central_plaza', tags: ['雨', '夜晚'], updatedAt: 10 }));
  const sceneLookup = { worldId: world.id, targetType: 'scene' as const, targetId: 'central_plaza', slot: 'background' as const, hour: 22 };
  expect(selectImageResource(useGameStore.getState().midoriAssetRegistry, { ...sceneLookup, weather: '晴' })?.imageUrl).toBe('/sun.png');
  expect(selectImageResource(useGameStore.getState().midoriAssetRegistry, { ...sceneLookup, weather: 'rain' })?.imageUrl).toBe('/rain.png');
});

it('keeps unknown legacy illustration filenames out of NPCs and lets explicit reclassification win', async () => {
  const managed = managedImagesFromList(world.id, { sceneImages: [], detailImages: [], illustrations: [], npcImages: [
    { name: '神秘猫_happy', emotion: 'happy', url: '/cat.png', fileSize: 1, lastModified: 1 },
    { name: '码头月夜', url: '/moon.png', fileSize: 1, lastModified: 1 },
  ] });
  const catalog = worldImageResources(world, createEmptyMidoriAssetRegistry(), managed);
  expect(catalog.find(image => image.imageUrl === '/moon.png')?.type).toBe('illustration');
  expect(catalog.find(image => image.imageUrl === '/cat.png')).toMatchObject({ type: 'character', targetId: '神秘猫', tags: ['开心'] });
  await useGameStore.getState().saveImageResource(resource('cat', { tags: ['开心'] }));
  await useGameStore.getState().saveImageResource(resource('cat', { type: 'illustration', targetId: 'central_plaza', tags: ['月夜'] }));
  const registry = useGameStore.getState().midoriAssetRegistry;
  expect(registry.bindings['character:神秘猫:portrait']).toBeUndefined();
  expect(selectImageResource(registry, lookup)).toBeNull();
  expect(worldImageResources(world, registry, managed).filter(image => image.imageUrl === '/cat.png')).toEqual([expect.objectContaining({ type: 'illustration', tags: ['月夜'] })]);
});

it('keeps legacy regional overview artwork accessible under illustrations', () => {
  const managed = managedImagesFromList(world.id, { sceneImages: [], detailImages: [], illustrations: [], regionImages: [
    { sceneId: 'regions', regionId: '旧城区', url: '/overview.png', fileSize: 1, lastModified: 1 },
  ] });
  expect(worldImageResources(world, createEmptyMidoriAssetRegistry(), managed)).toEqual([expect.objectContaining({ type: 'illustration', tags: ['区域俯瞰'], label: '旧城区' })]);
});

it('sends only scoped metadata and invalidates speculative responses when tags change', async () => {
  await useGameStore.getState().saveImageResource(resource('smile', { tags: ['礼服'] }));
  const state = useGameStore.getState(), snapshot = state.createSnapshot();
  const catalog = imageCatalogForState(state);
  expect(catalog[0]).toMatchObject({ tags: ['礼服'], available: true, description: '白色毛发' });
  expect(catalog[0]).not.toHaveProperty('imageUrl');
  const foreign = { ...catalog[0], worldId: 'elsewhere', label: '不该读取的图' };
  const prompt = imageCatalogPrompt(world.id, [...catalog, foreign], undefined, [catalog[0].targetId]);
  expect(prompt).toContain('礼服'); expect(prompt).not.toContain('不该读取的图');
  const context = buildWorldContextSections({ world, snapshot, imageCatalog: catalog });
  expect(context.dynamicSuffix).not.toContain('白色毛发');
  expect(context.dynamicSuffix).toContain('files.search');
  expect(imageCatalogPrompt(world.id, catalog)).toContain('礼服');
  expect(context.stablePrefix).not.toContain('图像资源');
  const next = [{ ...catalog[0], tags: ['雨衣'] }];
  expect(speculationStateKey(world, snapshot, null, [], '', catalog)).not.toBe(speculationStateKey(world, snapshot, null, [], '', next));
  expect(() => parseImageCatalog([{ ...catalog[0], tags: 'wrong' }])).toThrow('目录无效');
});

it('stores illustration plans independently, deduplicates accepted retries, and keeps deletion final', async () => {
  const draft = [{ label: '月下相遇', description: '远处的灯塔，近处的两道剪影', tags: ['月夜'], sceneId: 'central_plaza' }];
  await rememberIllustrationDrafts(useGameStore.getState(), draft, 'accepted-action');
  await rememberIllustrationDrafts(useGameStore.getState(), draft, 'accepted-action');
  const catalog = imageCatalogForState(useGameStore.getState());
  expect(catalog).toEqual([expect.objectContaining({ type: 'illustration', available: false, tags: ['月夜'] })]);
  expect(useGameStore.getState().midoriAssetRegistry.bindings).toEqual({});
  await useGameStore.getState().removeImageResource(world.id, catalog[0].id);
  await rememberIllustrationDrafts(useGameStore.getState(), draft, 'accepted-action');
  expect(imageCatalogForState(useGameStore.getState())).toEqual([]);
});

it('preserves model image references in both streamed complete and partial paragraphs', () => {
  const segment = { type: 'dialogue', speaker: '神秘猫', imageId: imageResourceId('/cat.png'), text: '喵' };
  expect(extractSegmentsProgressive(JSON.stringify({ segments: [segment] })).segments[0].imageId).toBe(segment.imageId);
  const partial = `{"segments":[{"type":"narration","imageId":"${segment.imageId}","text":"海边`;
  expect(extractSegmentsProgressive(partial).segments[0]?.imageId).toBe(segment.imageId);
});
