import { bytesToBase64 } from '../documents/file-bytes';
import { storeResource } from '../workspace/resources';
import { IMAGE_FILE_EXTENSION, IMAGE_MIME_EXTENSIONS, isImageMimeType, matchesImageType } from './image-format';
import { MAX_IMAGE_UPLOAD_BYTES } from './image-tags';
import type { ImageResource } from './image-resource';

function localPath(image: ImageResource): boolean {
  if (!image.imageUrl?.startsWith('/generated/') || /[?#]/u.test(image.imageUrl)) return false;
  try {
    const parts = image.imageUrl.slice('/generated/'.length).split('/').map(decodeURIComponent);
    return parts.length >= 3 && parts[0] === image.worldId && parts.every(part => part && part !== '.' && part !== '..' && !/[\\/\u0000-\u001f]/u.test(part)) && IMAGE_FILE_EXTENSION.test(parts.at(-1)!);
  } catch { return false; }
}
const dataImage = (image: ImageResource) => image.imageUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/u);
export function canAdaptImageOriginal(image: ImageResource): boolean {
  return Boolean(image.originalResource || image.source === 'uploaded' && (localPath(image) || dataImage(image)));
}

/** Adapt old player uploads in place; never fetch a model-authored or external URL automatically. */
export async function retainImageOriginal(image: ImageResource, signal?: AbortSignal): Promise<ImageResource> {
  if (image.originalResource) return image;
  if (!canAdaptImageOriginal(image)) throw new Error('这张图像没有可读取的本地原件，请重新上传');
  const data = dataImage(image);
  let type: string, bytes: Uint8Array;
  if (data) {
    type = data[1];
    if (data[2].length > Math.ceil(MAX_IMAGE_UPLOAD_BYTES / 3) * 4) throw new Error('图片不能超过 32 MB');
    bytes = Uint8Array.from(atob(data[2]), char => char.charCodeAt(0));
  } else {
    const response = await fetch(image.imageUrl!, { signal });
    if (!response.ok) throw new Error(`图片原件读取失败（HTTP ${response.status}）`);
    if (Number(response.headers.get('Content-Length')) > MAX_IMAGE_UPLOAD_BYTES) throw new Error('图片不能超过 32 MB');
    type = response.headers.get('Content-Type')?.split(';')[0].toLowerCase() ?? '';
    if (!isImageMimeType(type)) {
      const ext = image.imageUrl!.split('.').at(-1)!.toLowerCase();
      type = Object.entries(IMAGE_MIME_EXTENSIONS).find(([, value]) => value === (ext === 'jpeg' ? 'jpg' : ext))?.[0] ?? '';
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  signal?.throwIfAborted();
  if (bytes.length > MAX_IMAGE_UPLOAD_BYTES) throw new Error('图片不能超过 32 MB');
  if (!isImageMimeType(type) || !matchesImageType(bytes, type)) throw new Error('图片原件格式无效');
  const originalResource = await storeResource({ name: `${image.label.slice(0, 160) || 'image'}.${IMAGE_MIME_EXTENSIONS[type]}`, mimeType: type, base64: bytesToBase64(bytes) });
  return { ...image, originalResource };
}
