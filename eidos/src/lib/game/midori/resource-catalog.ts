import type { WorldDefinition } from '../types';
import type { MidoriAssetRegistry } from './asset-registry';
import { characterAssetId } from './character-target';
import { galleryCharacters, galleryScenes, type GalleryNpcSource } from './gallery-data';
import type { ManagedImage, ManagedImages } from './image-manager';
import { boundImageResource, imageResourceId, type ImageResource } from './image-resource';
import { imageTags, imageTimeTag } from './image-tags';

/** All consumers share one catalog; explicit metadata always wins over inferred legacy filenames. */
export function worldImageResources(world: WorldDefinition, registry: MidoriAssetRegistry, managed?: ManagedImages | null, source: GalleryNpcSource = {}): ImageResource[] {
  const knownNames = new Set(galleryCharacters(world, registry, [], source).map(npc => npc.name));
  const sceneNames = new Map(galleryScenes(world).map(scene => [scene.sceneId, scene.name]));
  const images = new Map<string, ImageResource>();
  const urls = new Map<string, string>();
  const add = (image: ImageResource | null) => {
    if (image?.worldId !== world.id) return;
    if (image.imageUrl) {
      const previousId = urls.get(image.imageUrl);
      if (previousId && previousId !== image.id) images.delete(previousId);
      urls.set(image.imageUrl, image.id);
    }
    images.set(image.id, image);
  };
  for (const image of managed?.scenes ?? []) {
    add(cachedResource(image, 'scene', image.cacheKey.sceneId, sceneNames.get(image.cacheKey.sceneId), [image.cacheKey.weather, imageTimeTag(image.cacheKey.timeOfDay)]));
  }
  for (const image of managed?.npcs ?? []) {
    const raw = image.cacheKey.regionId ?? image.label;
    const exact = characterAssetId(world, raw);
    const name = knownNames.has(exact) ? exact : characterAssetId(world, raw.replace(/_(neutral|happy|sad|angry|surprised|thinking|worried|smiling)$/iu, ''));
    // A cached illustration named like a portrait cannot invent an NPC in the directory.
    const isCharacter = knownNames.has(name);
    add(cachedResource(image, isCharacter ? 'character' : 'illustration', isCharacter ? name : '', isCharacter ? name : image.label,
      isCharacter ? [image.emotion ?? 'neutral'] : []));
  }
  for (const image of [...(managed?.details ?? []), ...(managed?.illustrations ?? [])]) add(cachedResource(image, 'illustration', image.cacheKey.sceneId));
  for (const image of managed?.regions ?? []) add(cachedResource(image, 'illustration', '', image.label, ['区域俯瞰']));
  for (const binding of Object.values(registry.bindings)) add(boundImageResource(binding));
  for (const image of Object.values(registry.images ?? {})) add(image.type === 'character' ? { ...image, targetId: characterAssetId(world, image.targetId) } : image);
  for (const id of registry.removedImageIds ?? []) images.delete(id);
  return [...images.values()].sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

function cachedResource(image: ManagedImage, type: ImageResource['type'], targetId: string, label = image.label, tags: string[] = []): ImageResource | null {
  if (!image.url) return null;
  return {
    id: imageResourceId(image.url), worldId: image.cacheKey.worldId, type, targetId, label,
    tags: imageTags(tags), description: '', imageUrl: image.url, relativePath: image.relativePath, source: 'generated',
    createdAt: image.lastModified ?? 0, updatedAt: image.lastModified ?? 0,
  };
}
