import { findMidoriAsset, type MidoriAssetLookup, type MidoriAssetRegistry } from './asset-registry';
import { boundImageResource, imageResourceId, imageWorkspacePath, type ImageResource } from './image-resource';
import { imageTag, imageTimeTag, SCENE_IMAGE_TAGS } from './image-tags';
import { expressionMatcher } from './expression-match';

interface ImageSelection extends MidoriAssetLookup {
  imageId?: string;
  imagePath?: string;
  expressionTags?: string[];
  emotion?: string;
  weather?: string;
  hour?: number;
}

function availableImages(registry: MidoriAssetRegistry, lookup: Omit<ImageSelection, 'slot'> & { slot?: ImageSelection['slot'] }): ImageResource[] {
  const type = lookup.targetType === 'detail' ? 'illustration' : lookup.targetType;
  const metadata = Object.values(registry.images ?? {});
  const overriddenUrls = new Set(metadata.filter(image => image.worldId === lookup.worldId).map(image => image.imageUrl));
  const inferred = Object.values(registry.bindings).map(boundImageResource).filter((image): image is ImageResource => Boolean(image && !overriddenUrls.has(image.imageUrl)));
  return [...inferred, ...metadata].filter(image => image.imageUrl && image.worldId === lookup.worldId &&
    image.type === type && image.targetId === lookup.targetId && (!lookup.slot || (lookup.slot === 'avatar' ? image.slot === 'avatar' : image.slot !== 'avatar')) &&
    !registry.removedImageIds?.includes(image.id));
}
function explicitImage(images: ImageResource[], lookup: Pick<ImageSelection, 'imageId' | 'imagePath'>) {
  return images.find(image => image.id === lookup.imageId) ?? images.find(image => imageWorkspacePath(image.id) === lookup.imagePath);
}
function bestMatch(images: ImageResource[], score: (image: ImageResource) => number) {
  return images.map(image => ({ image, score: score(image) })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.image.slot === 'avatar') - Number(a.image.slot === 'avatar') ||
      a.image.tags.length - b.image.tags.length || b.image.updatedAt - a.image.updatedAt || a.image.id.localeCompare(b.image.id))[0]?.image;
}

function emotionScore(image: ImageResource, desired: string): number {
  const related = desired === '微笑' ? '开心' : desired === '担忧' ? '悲伤' : '';
  // Tag storage deduplicates without case; selection must use the same identity.
  const tags = image.tags.map(tag => imageTag(tag).toLocaleLowerCase());
  return Number(Boolean(desired && tags.includes(desired.toLocaleLowerCase()))) * 8 + Number(Boolean(related && tags.includes(related))) * 4;
}

/** A matching expression or explicit image must win before falling back to a static avatar. */
export function selectDialogueImageResource(registry: MidoriAssetRegistry, lookup: Omit<ImageSelection, 'slot' | 'targetType'>): ImageResource | null {
  const candidates = availableImages(registry, { ...lookup, targetType: 'character' });
  const explicit = explicitImage(candidates, lookup);
  if (explicit) return explicit;
  const keywords = bestMatch(candidates, expressionMatcher(lookup.expressionTags));
  if (keywords) return keywords;
  const desired = lookup.emotion ? imageTag(lookup.emotion) : '';
  return bestMatch(candidates, image => emotionScore(image, desired))
    ?? selectImageResource(registry, { ...lookup, targetType: 'character', slot: 'avatar' })
    ?? selectImageResource(registry, { ...lookup, targetType: 'character', slot: 'portrait' });
}

/** No fuzzy object matching: a model-selected illustration can never become a character portrait. */
export function selectImageResource(registry: MidoriAssetRegistry, lookup: ImageSelection): ImageResource | null {
  const type = lookup.targetType === 'detail' ? 'illustration' : lookup.targetType;
  const available = availableImages(registry, lookup);
  const explicit = explicitImage(available, lookup);
  if (explicit) return explicit;
  if (lookup.targetType === 'character') {
    const keywords = bestMatch(available, expressionMatcher(lookup.expressionTags));
    if (keywords) return keywords;
  }
  const desired = lookup.targetType === 'character' ? imageTag(lookup.emotion ?? 'neutral') : lookup.weather ? imageTag(lookup.weather) : '';
  const time = lookup.hour === undefined ? '' : imageTimeTag(lookup.hour);
  const score = (image: ImageResource) => emotionScore(image, desired) + Number(Boolean(time && image.tags.includes(time)));
  const matched = available.filter(image => score(image) > 0 && (lookup.targetType !== 'scene' || !desired || image.tags.includes(desired) ||
    !image.tags.some(tag => (SCENE_IMAGE_TAGS as readonly string[]).includes(tag))))
    .sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt)[0];
  if (matched) return matched;
  const binding = findMidoriAsset(registry, lookup);
  if (!binding) return null;
  const id = imageResourceId(binding.imageUrl);
  const image = registry.images?.[id] ?? Object.values(registry.images ?? {}).find(resource => resource.imageUrl === binding.imageUrl);
  if (registry.removedImageIds?.includes(id) || image && (image.type !== type || image.targetId !== lookup.targetId)) return null;
  return image ?? { id, worldId: binding.worldId, type: type as ImageResource['type'], targetId: binding.targetId,
    label: binding.label ?? binding.targetId, imageUrl: binding.imageUrl, source: binding.source, tags: [], description: '', createdAt: binding.createdAt, updatedAt: binding.updatedAt };
}
