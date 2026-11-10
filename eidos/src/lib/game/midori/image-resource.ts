import { imageTags } from './image-tags';
import type { MidoriAssetBinding } from './asset-registry';
import type { ResourceRef } from '../workspace/types';
import { isImageMimeType } from './image-format';
import { MAX_IMAGE_UPLOAD_BYTES } from './image-tags';

export type ImageResourceType = 'character' | 'scene' | 'illustration';
export interface ImageResource {
  id: string;
  worldId: string;
  type: ImageResourceType;
  targetId: string;
  label: string;
  tags: string[];
  description: string;
  imageUrl?: string;
  relativePath?: string;
  originalResource?: ResourceRef;
  source: 'uploaded' | 'generated' | 'default' | 'edited';
  slot?: 'portrait' | 'avatar' | 'background' | 'detail';
  createdAt: number;
  updatedAt: number;
}

/** A stable compact identity deduplicates old files without sending paths or data URLs to the model. */
export function imageResourceId(url: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `image:${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

/** One identity for both mounted files and dialogue references; no host filesystem access. */
export const imageWorkspacePath = (imageId: string): string => `images/${imageResourceId(imageId).slice(6)}.json`;
export const isImageWorkspacePath = (value: unknown): value is string => typeof value === 'string' && /^images\/[a-f0-9]{16}\.json$/u.test(value);

export function normalizeImageResource(value: unknown): ImageResource | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.worldId !== 'string' || !raw.worldId ||
    !['character', 'scene', 'illustration'].includes(String(raw.type)) || typeof raw.targetId !== 'string') return null;
  if (raw.id.length > 4096 || raw.worldId.length > 512 || raw.targetId.length > 512 ||
    raw.type !== 'illustration' && !raw.targetId.trim()) return null;
  const imageUrl = typeof raw.imageUrl === 'string' && raw.imageUrl ? raw.imageUrl : undefined;
  // Only illustration plans can exist without a file.
  if (!imageUrl && raw.type !== 'illustration') return null;
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const original = raw.originalResource as Partial<ResourceRef> | undefined;
  const originalResource = original && typeof original.id === 'string' && /^material_[a-f0-9]{16}$/u.test(original.id) &&
    typeof original.name === 'string' && original.name.length <= 240 && typeof original.mimeType === 'string' && isImageMimeType(original.mimeType) &&
    typeof original.size === 'number' && Number.isSafeInteger(original.size) && original.size > 0 && original.size <= MAX_IMAGE_UPLOAD_BYTES
    ? { id: original.id, name: original.name, mimeType: original.mimeType, size: original.size } : undefined;
  return {
    id: raw.id, worldId: raw.worldId, type: raw.type as ImageResourceType, targetId: raw.targetId,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 160) : raw.targetId,
    tags: imageTags(raw.tags), description: typeof raw.description === 'string' ? raw.description.slice(0, 4000) : '',
    ...(imageUrl ? { imageUrl } : {}), ...(typeof raw.relativePath === 'string' ? { relativePath: raw.relativePath } : {}),
    ...(originalResource ? { originalResource } : {}),
    source: ['uploaded', 'generated', 'default', 'edited'].includes(String(raw.source)) ? raw.source as ImageResource['source'] : 'generated',
    ...(['portrait', 'avatar', 'background', 'detail'].includes(String(raw.slot)) ? { slot: raw.slot as ImageResource['slot'] } : {}),
    createdAt: time(raw.createdAt), updatedAt: time(raw.updatedAt),
  };
}

export function normalizeImageResources(value: unknown): Record<string, ImageResource> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const resources: Record<string, ImageResource> = {};
  for (const item of Object.values(value)) {
    const resource = normalizeImageResource(item);
    if (resource) Object.defineProperty(resources, resource.id, { value: resource, enumerable: true, writable: true, configurable: true });
  }
  return resources;
}

export function boundImageResource(binding: MidoriAssetBinding): ImageResource | null {
  if (!['character', 'scene', 'detail'].includes(binding.targetType)) return null;
  return {
    id: imageResourceId(binding.imageUrl), worldId: binding.worldId,
    type: binding.targetType === 'detail' ? 'illustration' : binding.targetType as 'character' | 'scene',
    targetId: binding.targetId, label: binding.label ?? binding.targetId, imageUrl: binding.imageUrl,
    tags: imageTags(binding.variant ? [binding.variant] : binding.targetType === 'character' ? ['平静'] : []),
    description: '', source: binding.source, createdAt: binding.createdAt, updatedAt: binding.updatedAt,
    slot: binding.slot === 'avatar' ? 'avatar' : binding.targetType === 'character' ? 'portrait' : binding.targetType === 'scene' ? 'background' : 'detail',
  };
}
