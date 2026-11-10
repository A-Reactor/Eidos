import { fileBytes, bytesToBase64 } from '../documents/file-bytes';
import { storeResource } from '../workspace/resources';
import { imageResourceId, type ImageResource, type ImageResourceType } from './image-resource';
import { isImageMimeType } from './image-format';
import { MAX_IMAGE_UPLOAD_BYTES, imageTags } from './image-tags';

export interface ImageUploadTarget { type: ImageResourceType; targetId: string; label: string; tags?: string[]; resource?: ImageResource }

/** Gallery and document imports retain the same original, without flattening GIF animation. */
export async function uploadImageResource(worldId: string, file: File, target: ImageUploadTarget, signal?: AbortSignal): Promise<ImageResource> {
  if (!isImageMimeType(file.type)) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片');
  if (!file.size) throw new Error('图片为空');
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error('图片不能超过 32 MB');
  const form = new FormData();
  form.set('worldId', worldId); form.set('targetType', target.type === 'illustration' ? 'detail' : target.type);
  form.set('targetId', target.targetId || 'illustration');
  form.set('slot', target.type === 'character' ? 'portrait' : target.type === 'scene' ? 'background' : 'detail'); form.set('file', file);
  const response = await fetch('/api/midori/upload-image', { method: 'POST', body: form, signal });
  const data = await response.json();
  if (!response.ok || typeof data.imageUrl !== 'string' || !data.imageUrl) throw new Error(data.error ?? '上传失败');
  signal?.throwIfAborted();
  const bytes = await fileBytes(file);
  const originalResource = await storeResource({ name: file.name.slice(0, 240), mimeType: file.type, base64: bytesToBase64(bytes) });
  signal?.throwIfAborted();
  const now = Date.now();
  return { ...target.resource, id: target.resource?.id ?? imageResourceId(data.imageUrl), worldId,
    type: target.type, targetId: target.targetId, label: target.resource?.label ?? (target.type === 'illustration' ? file.name.replace(/\.[^.]+$/u, '').slice(0, 160) : target.label),
    imageUrl: data.imageUrl, ...(typeof data.relativePath === 'string' ? { relativePath: data.relativePath } : {}), originalResource,
    tags: imageTags(target.tags ?? target.resource?.tags), description: target.resource?.description ?? '', source: 'uploaded',
    createdAt: target.resource?.createdAt ?? now, updatedAt: now };
}
