import { loadFromDB, saveToDB } from './storage';
import type { ModelDocument } from '@/lib/ai/document-response';

import type { DocumentScope } from './documents/types';
export type { DocumentScope } from './documents/types';
export interface PendingModelDocument { document: ModelDocument; request: string; appendId?: string }
export interface ResourceDocumentSelection { scope: DocumentScope; initial?: PendingModelDocument; initialId?: string }
export interface SavedModelDocument extends ModelDocument {
  id: string; createdAt: number; updatedAt: number; request: string;
  parts: Array<{ content: string; rawOutput?: string; request: string; createdAt: number; recovered?: boolean; incomplete?: boolean }>;
}
const queues = new Map<string, Promise<unknown>>();
export function documentScopeKey(scope: DocumentScope): string {
  return `model-documents:${JSON.stringify([scope.worldId, scope.playthroughId, scope.archiveId ?? 'main'])}`;
}
export function currentDocumentScope(state: { currentWorld: { id: string } | null; currentPlaythroughId: string | null; sandboxMode?: boolean; sandboxDossierId?: string | null }): DocumentScope | null {
  return state.currentWorld && state.currentPlaythroughId ? { worldId: state.currentWorld.id, playthroughId: state.currentPlaythroughId, archiveId: state.sandboxMode ? `sandbox:${state.sandboxDossierId ?? 'default'}` : 'main' } : null;
}
export async function loadModelDocuments(scope: DocumentScope): Promise<SavedModelDocument[]> {
  const value = await loadFromDB(documentScopeKey(scope));
  if (value === null) return [];
  if (!Array.isArray(value) || value.some(doc => !doc || typeof doc.id !== 'string' || typeof doc.content !== 'string' || !Array.isArray(doc.parts))) throw new Error('文档索引无法读取，请保留数据后重试');
  return value as SavedModelDocument[];
}

/** Model output never chooses a path or overwrite target; append IDs come from the reader UI. */
export async function saveModelDocument(scope: DocumentScope, document: ModelDocument, request: string, appendId?: string): Promise<SavedModelDocument> {
  if (!document.content.trim()) throw new Error('文档正文为空');
  const key = documentScopeKey(scope);
  const operation = async () => {
    const documents = await loadModelDocuments(scope), now = Date.now();
    const existing = appendId ? documents.find(doc => doc.id === appendId) : undefined;
    if (appendId && !existing) throw new Error('待追加的文档不存在，请重新选择');
    const part = { content: document.content, rawOutput: document.rawOutput, request, createdAt: now, recovered: document.recovered, incomplete: document.incomplete };
    const next: SavedModelDocument = existing ? { ...existing, content: `${existing.content}\n\n${document.content}`, updatedAt: now,
      rawOutput: undefined, recovered: existing.recovered || document.recovered, incomplete: document.incomplete,
      parts: [...existing.parts, part] } : { ...document, id: crypto.randomUUID(), request, createdAt: now, updatedAt: now, parts: [part] };
    await saveToDB(key, [next, ...documents.filter(doc => doc.id !== next.id)]);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eidos-documents-updated', { detail: key }));
    return next;
  };
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`eidos-document-write:${key}`, operation);
    return await operation();
  });
  queues.set(key, run);
  try { return await run; } finally { if (queues.get(key) === run) queues.delete(key); }
}

export function documentMarkdown(document: SavedModelDocument): string {
  return `# ${document.title}\n\n${document.content}\n`;
}
