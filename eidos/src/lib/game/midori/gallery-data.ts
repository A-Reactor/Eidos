import { mapScenes } from '../map-state';
import type { WorldDefinition } from '../types';
import { npcReferenceContext, resolveNpcReference, type NpcReferenceSource } from '../npc-reference';
import { findMidoriAsset, type MidoriAssetBinding, type MidoriAssetRegistry } from './asset-registry';
import type { ManagedImage } from './image-manager';
import { characterAssetId } from './character-target';

export interface GalleryCharacter {
  name: string;
  image: ManagedImage | null;
  boundAsset: MidoriAssetBinding | null;
}
export type GalleryNpcSource = NpcReferenceSource;

export function galleryScenes(world: WorldDefinition) {
  return Object.entries(mapScenes(world)).map(([sceneId, scene]) => ({
    sceneId, name: scene.name || sceneId,
    regionName: world.regions[scene.region]?.name ?? Object.values(world.regions).find(region => Object.hasOwn(region.scenes, sceneId))?.name ?? scene.region,
  }));
}

export function galleryCharacters(world: WorldDefinition, registry: MidoriAssetRegistry, images: ManagedImage[], source: GalleryNpcSource = {}): GalleryCharacter[] {
  const context = npcReferenceContext(world, source);
  context.names.push(
    ...Object.values(registry.bindings).filter(asset => asset.worldId === world.id && asset.targetType === 'character').map(asset => asset.targetId),
    ...Object.values(registry.images ?? {}).filter(image => image.worldId === world.id && image.type === 'character').map(image => image.targetId),
  );
  const resolve = (name: string) => characterAssetId(world, resolveNpcReference(name, context));
  const names = new Set(context.names.filter(name => name.trim()).map(resolve));
  const byName = new Map<string, ManagedImage>();
  for (const image of images) {
    const raw = image.cacheKey.regionId ?? image.label;
    // Exact known names win over parsing a legacy expression suffix.
    const name = resolve(names.has(raw) ? raw : raw.replace(/_(neutral|happy|sad|angry|surprised|thinking)$/i, ''));
    const previous = byName.get(name);
    const neutral = image.emotion === 'neutral' || /_neutral$/i.test(raw);
    const previousNeutral = previous?.emotion === 'neutral' || /_neutral$/i.test(previous?.cacheKey.regionId ?? '');
    if (!previous || neutral && !previousNeutral || neutral === previousNeutral && (image.lastModified ?? 0) > (previous.lastModified ?? 0)) byName.set(name, image);
    names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).map(name => ({
    name, image: byName.get(name) ?? null,
    boundAsset: findMidoriAsset(registry, { worldId: world.id, targetType: 'character', targetId: name, slot: 'portrait' }),
  }));
}
