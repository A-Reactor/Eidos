import { loadDocumentRecords } from '../documents/repository';
import { readResource } from './resources';
import type { WorkspaceSession } from './session';
import type { ActionImageInput } from '@/lib/ai/action-images';
import { isImageMimeType } from '../midori/image-format';
import { modelImageInput } from '../midori/model-image-input';

/** Only explicitly selected or successfully read documents send pixels, never the whole gallery. */
export async function workspaceImageInputs(session: WorkspaceSession | null, signal?: AbortSignal): Promise<ActionImageInput[] | undefined> {
  if (!session) return undefined;
  const refs = [...session.actionInputs, ...session.receipts.filter(receipt => receipt.method === 'files.read' && receipt.status === 'committed' && receipt.actor?.kind !== 'character').flatMap(receipt => receipt.document ? [receipt.document] : [])];
  const imageReads = session.receipts.filter(receipt => receipt.method === 'files.read' && receipt.status === 'committed' && receipt.actor?.kind !== 'character' && receipt.path && session.imageLibrary?.entries[receipt.path]);
  if (!refs.length && !imageReads.length) return undefined;
  const docs = await loadDocumentRecords(session.scope), images: ActionImageInput[] = [], seen = new Set<string>();
  const current = () => { signal?.throwIfAborted(); if (session.closed || !session.isCurrent()) throw new DOMException('图片查阅已取消', 'AbortError'); };
  current();
  for (const ref of refs) {
    const doc = docs.find(doc => doc.id === ref.documentId), version = doc?.versions[ref.revision], original = version?.originalResource;
    if (!original || !isImageMimeType(original.mimeType) || seen.has(original.id)) continue;
    if (images.length >= 8) throw new Error('一次最多引用 8 张图片，请分批查看');
    seen.add(original.id);
    const entry = Object.entries(session.documentByPath).find(([, link]) => link.documentId === ref.documentId && link.revision === ref.revision);
    if (!entry) throw new Error('图片文档不在本轮工作区中，请重新引用');
    const resource = await readResource(original); current();
    const media = await modelImageInput(resource); current();
    images.push({ path: entry[0], version: version!.resource.id, name: version!.title ?? doc!.title, ...media });
  }
  for (const receipt of imageReads) {
    const entry = session.imageLibrary!.entries[receipt.path!], original = entry.image.originalResource;
    if (!original || seen.has(original.id)) continue;
    if (images.length >= 8) throw new Error('一次最多引用 8 张图片，请分批查看');
    seen.add(original.id);
    const media = await modelImageInput(await readResource(original)); current();
    images.push({ path: receipt.path!, version: receipt.version!, name: entry.image.label, ...media });
  }
  return images.length ? images : undefined;
}
