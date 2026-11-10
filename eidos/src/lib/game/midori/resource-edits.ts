import type { ArchiveScopeSource } from '../archive-scope';
import type { WorldDefinition } from '../types';
import { bindMidoriAsset, makeMidoriAssetKey, type MidoriAssetBinding, type MidoriAssetRegistry } from './asset-registry';

import { worldImageResources } from './resource-catalog';
import { characterAssetId } from './character-target';
import { imageResourceId, normalizeImageResource, type ImageResource } from './image-resource';

const bindingLookup = (image: ImageResource) => ({ worldId: image.worldId,
  targetType: image.type === 'illustration' ? 'detail' as const : image.type,
  targetId: image.targetId, slot: image.slot === 'avatar' ? 'avatar' as const : image.type === 'character' ? 'portrait' as const : image.type === 'scene' ? 'background' as const : 'detail' as const });

export function editImageResource(options: {
  world: WorldDefinition | string; registry: MidoriAssetRegistry; image: ImageResource;
  makeDefault?: boolean; scope: ArchiveScopeSource; persist?: boolean;
}): MidoriAssetRegistry {
  const { registry } = options;
  const worldId = typeof options.world === 'string' ? options.world : options.world.id;
  let image = normalizeImageResource(options.image);
  if (!image || image.worldId !== worldId) throw new Error('图像资源无效');
  if (image.type === 'character') image = { ...image, targetId: characterAssetId(typeof options.world === 'string' ? null : options.world, image.targetId) };
  const definitions = typeof options.world === 'string' ? { id: worldId, npcs: {}, regions: {} } as WorldDefinition : options.world;
  const images = Object.fromEntries(worldImageResources(definitions, registry).map(resource => [resource.id, resource]));
  images[image.id] = image;
  const bindings = { ...registry.bindings };
  const previousImage = registry.images?.[image.id];
  const changes: Array<{ lookup: MidoriAssetBinding; asset: MidoriAssetBinding | null }> = [];
  for (const [key, binding] of Object.entries(bindings)) {
    if (binding.worldId !== worldId || binding.imageUrl !== image.imageUrl && binding.imageUrl !== previousImage?.imageUrl && imageResourceId(binding.imageUrl) !== image.id) continue;
    const lookup = bindingLookup(image);
    if (binding.targetType !== lookup.targetType || binding.targetId !== lookup.targetId || binding.slot !== lookup.slot) {
      delete bindings[key]; changes.push({ lookup: binding, asset: null });
    } else if (image.imageUrl && binding.imageUrl !== image.imageUrl) {
      // Rehydrating the same immutable original must not leave a default pointing at its old cache path.
      bindings[key] = { ...binding, imageUrl: image.imageUrl, updatedAt: image.updatedAt };
      changes.push({ lookup: binding, asset: bindings[key] });
    }
  }
  let next: MidoriAssetRegistry = { ...registry, bindings, images, removedImageIds: registry.removedImageIds?.filter(id => id !== image.id) };
  const lookup = bindingLookup(image), key = makeMidoriAssetKey(lookup.targetType, lookup.targetId, lookup.slot);
  const previous = registry.images?.[image.id];
  const newTarget = !previous || previous.type !== image.type || previous.targetId !== image.targetId;
  // Editing labels must not undo the player's deliberate choice to unbind an existing image.
  const useDefault = image.imageUrl && image.type !== 'illustration' && (options.makeDefault ?? (newTarget && !next.bindings[key]));
  if (useDefault) next = bindMidoriAsset(next, { ...lookup, imageUrl: image.imageUrl!, source: image.source, label: image.label, updatedAt: image.updatedAt });
  return next;
}

export function eraseImageResource(options: { registry: MidoriAssetRegistry; worldId: string; id: string; scope: ArchiveScopeSource }): MidoriAssetRegistry {
  const { registry, worldId, id } = options;
  const image = registry.images?.[id];
  if (image && image.worldId !== worldId) throw new Error('图像不属于当前世界');
  const images = { ...registry.images }, bindings = { ...registry.bindings };
  const removals = Object.values(bindings).filter(binding => binding.worldId === worldId && (imageResourceId(binding.imageUrl) === id || Boolean(image?.imageUrl && binding.imageUrl === image.imageUrl)));
  for (const binding of removals) delete bindings[binding.id];
  delete images[id];
  return { ...registry, images, bindings, removedImageIds: [...new Set([...(registry.removedImageIds ?? []), id])] };
}
