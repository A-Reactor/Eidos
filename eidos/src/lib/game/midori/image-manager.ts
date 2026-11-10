import type { GalleryDetailImage, GalleryListResponse, ImageCacheKey } from './types';

export type ImageStatus = 'missing' | 'queued' | 'generating' | 'cached' | 'failed';
export interface ManagedImage {
  cacheKey: ImageCacheKey;
  label: string;
  type: 'scene' | 'npc' | 'region' | 'detail';
  status: ImageStatus;
  url?: string;
  relativePath?: string;
  emotion?: string;
  lastChecked: number;
  lastModified?: number;
}
export interface ManagedImages {
  scenes: ManagedImage[];
  npcs: ManagedImage[];
  regions: ManagedImage[];
  details: ManagedImage[];
  illustrations?: ManagedImage[];
}

export const managedImageId = (image: ManagedImage): string => image.relativePath ?? image.url ??
  JSON.stringify([image.cacheKey.worldId, image.cacheKey.sceneId, image.cacheKey.regionId, image.cacheKey.weather, image.cacheKey.timeOfDay]);

export async function fetchGalleryImages(worldId: string, signal?: AbortSignal): Promise<GalleryListResponse> {
  const response = await fetch(`/api/midori/list-images?worldId=${encodeURIComponent(worldId)}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`无法读取图像列表（HTTP ${response.status}）`);
  const data = await response.json();
  const sceneValid = (value: Record<string, unknown>) => typeof value.sceneId === 'string' && typeof value.weather === 'string' && typeof value.timeOfDay === 'string';
  const detailValid = (value: Record<string, unknown>) => typeof value.sceneId === 'string' && typeof value.regionId === 'string';
  const arrayValid = (values: unknown, fields: (value: Record<string, unknown>) => boolean) => Array.isArray(values) && values.every(value =>
    value && typeof value === 'object' && typeof value.url === 'string' && value.url &&
    (value.relativePath === undefined || typeof value.relativePath === 'string') && fields(value));
  if (!data || !arrayValid(data.sceneImages, sceneValid) || !arrayValid(data.detailImages, detailValid) ||
      !arrayValid(data.illustrations, sceneValid) || data.npcImages !== undefined && !arrayValid(data.npcImages, value => typeof value.name === 'string' && Boolean(value.name.trim())) ||
      data.regionImages !== undefined && !arrayValid(data.regionImages, detailValid)) throw new Error('图像列表格式不完整，请重试');
  return data as GalleryListResponse;
}

/** All panels derive their categories from the same response; no second request can race the first. */
export function managedImagesFromList(worldId: string, data: GalleryListResponse): ManagedImages {
  const lastChecked = Date.now();
  const legacyNpcs = data.detailImages.filter(image => image.sceneId === 'npcs');
  const legacyRegions = data.detailImages.filter(image => image.sceneId === 'regions');
  const detail = (image: GalleryDetailImage, type: 'detail' | 'region'): ManagedImage => ({
    cacheKey: { worldId, sceneId: image.sceneId, regionId: image.regionId, weather: 'detail', timeOfDay: 'detail' },
    label: type === 'region' ? image.regionId : `${image.sceneId} / ${image.regionId}`,
    type, status: 'cached', url: image.url, relativePath: image.relativePath, lastChecked, lastModified: image.lastModified,
  });
  const npcs = [...(data.npcImages ?? []), ...legacyNpcs.map(image => ({ ...image, name: image.regionId }))];
  return {
    scenes: data.sceneImages.map(image => ({
      cacheKey: { worldId, sceneId: image.sceneId, weather: image.weather, timeOfDay: image.timeOfDay },
      label: `${image.sceneId} / ${image.weather}·${image.timeOfDay}`, type: 'scene', status: 'cached',
      url: image.url, relativePath: image.relativePath, lastChecked, lastModified: image.lastModified,
    })),
    npcs: npcs.map(image => ({
      cacheKey: { worldId, sceneId: 'npcs', regionId: image.name, weather: 'neutral', timeOfDay: 'portrait' },
      label: image.name, type: 'npc', status: 'cached', url: image.url, relativePath: image.relativePath,
      emotion: 'emotion' in image ? image.emotion : undefined, lastChecked, lastModified: image.lastModified,
    })),
    regions: [...(data.regionImages ?? []), ...legacyRegions].map(image => detail(image, 'region')),
    details: data.detailImages.filter(image => !['npcs', 'regions'].includes(image.sceneId)).map(image => detail(image, 'detail')),
    illustrations: data.illustrations.map(image => ({
      cacheKey: { worldId, sceneId: image.sceneId, weather: image.weather || 'detail', timeOfDay: image.timeOfDay || 'detail' },
      label: image.sceneId, type: 'detail', status: 'cached', url: image.url, relativePath: image.relativePath,
      lastChecked, lastModified: image.lastModified,
    })),
  };
}

export async function listManagedImages(worldId: string): Promise<ManagedImages> {
  return managedImagesFromList(worldId, await fetchGalleryImages(worldId));
}

export async function deleteImage(cacheKey: ImageCacheKey, relativePath?: string): Promise<void> {
  const response = await fetch('/api/midori/delete-image', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cacheKey, relativePath }),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(data.error ?? '删除图像失败，请重试');
}
