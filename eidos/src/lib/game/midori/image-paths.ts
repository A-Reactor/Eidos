import path from 'node:path';
import type { ImageCacheKey } from './types';
import { IMAGE_FILE_EXTENSION } from './image-format';
export { GENERATED_ROOT } from '../media-root';
import { GENERATED_ROOT } from '../media-root';

const IMAGE_DIRECTORIES = new Set(['scenes', 'details', 'npcs', 'regions', 'uploads', 'illustrations']);

/** Preserve Unicode identifiers: lossy filename sanitizing makes distinct worlds share files. */
export function isImagePathSegment(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 &&
    value !== '.' && value !== '..' && !/[\x00-\x1f\x7f/\\<>:"|?*]/u.test(value);
}

export function readImageCacheKey(value: unknown): ImageCacheKey | null {
  if (!value || typeof value !== 'object') return null;
  const key = value as Record<string, unknown>;
  if (![key.worldId, key.sceneId, key.weather].every(isImagePathSegment) ||
      typeof key.timeOfDay !== 'string' || !isImagePathSegment(key.timeOfDay.replaceAll(':', '')) ||
      key.regionId !== undefined && !isImagePathSegment(key.regionId)) return null;
  return key as unknown as ImageCacheKey;
}

export function imageFilePath(worldId: string, relativePath: string): string {
  const parts = relativePath.split('/');
  if (!isImagePathSegment(worldId) || parts.length < 2 || !IMAGE_DIRECTORIES.has(parts[0]) ||
      !parts.every(isImagePathSegment) || !IMAGE_FILE_EXTENSION.test(parts.at(-1)!)) {
    throw new Error('Invalid image path');
  }
  return path.join(GENERATED_ROOT, worldId, ...parts);
}

export function imagePublicUrl(worldId: string, relativePath: string): string {
  imageFilePath(worldId, relativePath);
  return `/generated/${[worldId, ...relativePath.split('/')].map(encodeURIComponent).join('/')}`;
}

export function imageCachePaths(input: ImageCacheKey): string[] {
  const key = readImageCacheKey(input);
  if (!key) throw new Error('Invalid image cache key');
  const formats = (paths: string[]) => paths.flatMap(file => ['png', 'gif', 'webp', 'jpg', 'jpeg'].map(ext => file.replace(/\.png$/u, `.${ext}`)));
  if (!key.regionId) return formats([`scenes/${key.sceneId}_${key.weather}_${key.timeOfDay.replaceAll(':', '')}.png`]);
  const primary = `details/${key.sceneId}_${key.regionId}.png`;
  if (key.sceneId === 'npcs') return formats([primary, `details/icon_npc_${key.regionId}.png`, `npcs/${key.regionId}.png`,
    ...(/_neutral$/i.test(key.regionId) ? [`npcs/${key.regionId.slice(0, -8)}.png`, `details/npcs_${key.regionId.slice(0, -8)}.png`, `details/icon_npc_${key.regionId.slice(0, -8)}.png`] : [])]);
  if (key.sceneId === 'regions') return formats([primary, `regions/${key.regionId}_overview.png`]);
  return formats([primary]);
}
