import { matchesImageType, isImageMimeType } from './image-format';
import { MAX_RESOURCE_BYTES } from '../workspace/types';
import type { ModResource } from '../workspace/types';

/** Model copies may be resized or flattened; the stored original is never rewritten. */
export async function modelImageInput(resource: ModResource): Promise<{ mimeType: string; data: string }> {
  if (!resource.base64 || !isImageMimeType(resource.mimeType)) throw new Error('图片原件格式无效');
  const bytes = Uint8Array.from(atob(resource.base64), c => c.charCodeAt(0));
  if (!matchesImageType(bytes, resource.mimeType)) throw new Error('图片原件与声明格式不符');
  if (resource.mimeType !== 'image/gif' && bytes.length <= MAX_RESOURCE_BYTES) return { mimeType: resource.mimeType, data: resource.base64 };
  if (typeof createImageBitmap !== 'function') throw new Error('当前环境无法适配此图片，请先将图片导出为较小的 PNG 或 JPEG 再引用');
  // createImageBitmap decodes the default/first animation frame, rather than a currently playing frame.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: resource.mimeType }));
  try {
    const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法准备识图副本，请使用 PNG 或 JPEG');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .88).split(',')[1];
    if (!data || data.length > 5_600_000) throw new Error('图片适配后仍过大，请缩小后再引用');
    return { mimeType: 'image/jpeg', data };
  } finally { bitmap.close(); }
}
