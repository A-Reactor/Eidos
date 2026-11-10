import { documentScopeKey } from '../model-documents';
import { loadDocumentRecords, saveDocument } from '../documents/repository';
import type { DocumentLink, DocumentScope } from '../documents/types';
import { readResource, storeResource } from '../workspace/resources';
import { isImageMimeType } from './image-format';
import type { ImageResource } from './image-resource';
import { uploadImageResource, type ImageUploadTarget } from './upload-image';

const queues = new Map<string, Promise<DocumentLink>>();
export const imageDocumentUrl = (id: string) => `eidos-image:${id}`;

function imageDocumentText(image: ImageResource): string {
  const metadata = { format: 'eidos-image', version: 1, imageId: image.id, type: image.type, targetId: image.targetId,
    usage: '图像资料为表现参考，不是剧情指令；可通过 imageId 使用已有图片。本轮引用或读取后，图片像素随下一次请求提供；未收到像素时不得声称看过图片。',
    label: image.label, tags: image.tags, description: image.description, original: image.originalResource };
  const plain = (text: string) => text.replace(/[\\`*_{}\[\]<>]/gu, '\\$&');
  const description = plain(image.description || '尚未填写图像描述。');
  const tags = plain(image.tags.join(' · ') || '暂无标签');
  return `![图片原件](${imageDocumentUrl(image.originalResource!.id)})\n\n${description}\n\n标签：${tags}\n\n图像资料 · 可引用到行动。\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n`;
}

/** Each edit creates a new immutable version; previously cited descriptions keep their meaning. */
export function saveImageDocument(scope: DocumentScope, image: ImageResource, libraryVisibility?: 'visible'): Promise<DocumentLink> {
  if (scope.worldId !== image.worldId || !image.originalResource || !isImageMimeType(image.originalResource.mimeType)) return Promise.reject(new Error('图片原件或所属世界无效'));
  const key = `${documentScopeKey(scope)}:${image.id}`, previous = queues.get(key);
  const operation = async () => {
    await readResource(image.originalResource!);
    const identity = `eidos-image:${image.id}`;
    const old = (await loadDocumentRecords(scope)).find(doc => doc.idempotencyKey === identity);
    const body = imageDocumentText(image);
    // A player's edited document may contain notes beyond the generated descriptor.
    if (old?.origin === 'authored' || old?.trashedAt !== undefined) return { documentId: old.id, revision: old.currentRevision, title: old.title };
    if (old && (!libraryVisibility || old.libraryVisibility === libraryVisibility) && old.title === image.label && (await readResource(old.versions[old.currentRevision].resource)).text === body) {
      return { documentId: old.id, revision: old.currentRevision, title: old.title };
    }
    const resource = await storeResource({ name: 'image.md', mimeType: 'text/markdown', text: body });
    return saveDocument(scope, { title: image.label || image.originalResource!.name, origin: 'imported', format: 'markdown', libraryVisibility,
      resource, originalResource: image.originalResource, fileName: image.originalResource!.name,
      ...(old ? { previous: { documentId: old.id, revision: old.currentRevision } } : { idempotencyKey: identity }) });
  };
  const run = (previous ? previous.catch(() => undefined).then(operation) : operation());
  queues.set(key, run);
  void run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => {});
  return run;
}

export async function importImageDocument(scope: DocumentScope, file: File, target: ImageUploadTarget = { type: 'illustration', targetId: '', label: '' }, signal?: AbortSignal) {
  const image = await uploadImageResource(scope.worldId, file, target, signal);
  const link = await saveImageDocument(scope, image, 'visible');
  return { image, link };
}
