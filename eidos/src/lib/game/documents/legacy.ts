import { loadModelDocuments, type SavedModelDocument } from '../model-documents';
import { MAX_RESOURCE_BYTES } from '../workspace/types';
import { storeResource } from '../workspace/resources';
import type { DocumentRecord, DocumentScope } from './types';

export async function adaptLegacyDocuments(scope: DocumentScope, known: DocumentRecord[]): Promise<DocumentRecord[]> {
  const result: DocumentRecord[] = [];
  for (const old of await loadModelDocuments(scope)) {
    if (known.some(doc => doc.id === old.id)) continue;
    const size = new TextEncoder().encode(old.content).length;
    const resource = size > MAX_RESOURCE_BYTES
      ? { id: `legacy_${old.id}`, name: 'legacy.md', mimeType: 'text/markdown', size }
      : await storeResource({ name: 'legacy.md', mimeType: 'text/markdown', text: old.content });
    const raw = JSON.stringify(old.parts), responseResource = new TextEncoder().encode(raw).length <= MAX_RESOURCE_BYTES
      ? await storeResource({ name: 'response.json', mimeType: 'application/json', text: raw }) : undefined;
    result.push({ id: old.id, scope: { ...scope }, title: old.title, origin: old.recovered ? 'recovered' : 'generated',
      currentRevision: resource.id, versions: { [resource.id]: { resource, responseResource, format: 'markdown', createdAt: old.createdAt } },
      createdAt: old.createdAt, updatedAt: old.updatedAt, legacyId: old.id,
      ...(size > MAX_RESOURCE_BYTES ? { referenceError: '旧文档超过 4 MiB，可完整阅读和导出；请拆分后引用。' } : {}) });
  }
  return result;
}
export async function readLegacyDocument(scope: DocumentScope, id: string): Promise<SavedModelDocument> {
  const old = (await loadModelDocuments(scope)).find(doc => doc.id === id);
  if (!old) throw new Error('旧文档原件不存在');
  return old;
}
