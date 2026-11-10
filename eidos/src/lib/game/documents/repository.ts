import { exportValues } from '../export-values';
import { loadMeta, saveMeta } from '../storage';
import { documentScopeKey } from '../model-documents';
import { storeResource, readResource } from '../workspace/resources';
import { adaptLegacyDocuments, readLegacyDocument } from './legacy';
import type { DocumentLink, DocumentRecord, DocumentRef, DocumentScope, SaveDocumentInput } from './types';

interface DocumentProjection { read(scope: DocumentScope): DocumentRef[] | undefined; write(scope: DocumentScope, ref: DocumentRef): void }
let projection: DocumentProjection | undefined;
export function registerDocumentProjection(reader: DocumentProjection): void { projection = reader; }
export function projectDocuments(docs: DocumentRecord[], heads?: DocumentRef[]): DocumentRecord[] {
  if (!heads) return docs.filter(doc => !doc.staged);
  const map = new Map(heads.map(ref => [ref.documentId, ref.revision]));
  return docs.filter(doc => !doc.staged && (!doc.branchManaged || map.has(doc.id))).map(doc => projectDocument(doc, map.get(doc.id) ?? doc.baseRevision ?? doc.currentRevision));
}
function projectDocument(doc: DocumentRecord, revision: string): DocumentRecord {
  const version = doc.versions[revision];
  return { ...doc, currentRevision: revision, title: version?.title ?? doc.title, fileName: version?.fileName ?? doc.fileName };
}
const queues = new Map<string, Promise<unknown>>();
export const documentLibraryKey = (scope: DocumentScope) => `document-library:${documentScopeKey(scope)}`;
async function locked<T>(scope: DocumentScope, operation: () => Promise<T>): Promise<T> {
  const key = documentLibraryKey(scope), previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request(`eidos-library-write:${key}`, operation);
    return await operation();
  });
  queues.set(key, run);
  try { return await run; } finally { if (queues.get(key) === run) queues.delete(key); }
}
export function notifyDocuments(scope: DocumentScope) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('eidos-documents-updated', { detail: documentLibraryKey(scope) }));
}
async function records(scope: DocumentScope): Promise<DocumentRecord[]> {
  const docs = await loadMeta<DocumentRecord[]>(documentLibraryKey(scope)) ?? [];
  if (!Array.isArray(docs) || docs.some(d => !d || typeof d.id !== 'string' || !d.versions || typeof d.currentRevision !== 'string')) throw new Error('文档索引无法读取，请保留数据后重试');
  return docs;
}
export async function loadDocumentRecords(scope: DocumentScope): Promise<DocumentRecord[]> {
  return locked(scope, async () => {
    const docs = await records(scope), legacy = await adaptLegacyDocuments(scope, docs);
    if (legacy.length) await saveMeta(documentLibraryKey(scope), [...docs, ...legacy]);
    return [...docs, ...legacy].sort((a, b) => b.updatedAt - a.updatedAt);
  });
}
export async function loadDocuments(scope: DocumentScope, heads = projection?.read(scope)): Promise<DocumentRecord[]> {
  // A cancelled IndexedDB write cannot be rolled back; acceptance controls catalog visibility.
  return projectDocuments(await loadDocumentRecords(scope), heads).filter(doc => doc.trashedAt === undefined);
}
export async function readDocument(scope: DocumentScope, ref: DocumentRef) {
  // Accepted history can still preview its pinned output while node association is retried.
  const record = (await loadDocumentRecords(scope)).find(doc => doc.id === ref.documentId), version = record?.versions[ref.revision];
  if (!record || !version) throw new Error('文档或指定版本在当前周目中不存在');
  if (record.referenceError && record.legacyId) {
    const old = await readLegacyDocument(scope, record.legacyId);
    return { record, resource: { ...version.resource, text: old.content } };
  }
  return { record: projectDocument(record, ref.revision), resource: await readResource(version.resource) };
}
export async function saveDocument(scope: DocumentScope, input: SaveDocumentInput): Promise<DocumentLink> {
  const title = input.title.trim();
  if (!title || title.length > 4096) throw new Error('请填写有效文档标题');
  const resource = await readResource(input.resource);
  if (resource.text === undefined || !resource.text.trim()) throw new Error('文档文本正文为空');
  return locked(scope, async () => {
    const docs = await records(scope), retry = input.idempotencyKey ? docs.find(d => d.idempotencyKey === input.idempotencyKey) : undefined;
    if (retry) return { documentId: retry.id, revision: retry.currentRevision, title: retry.title };
    const existing = input.previous ? docs.find(d => d.id === input.previous!.documentId) : undefined;
    if (existing?.trashedAt !== undefined) throw new Error('文档已移入回收站，请先恢复');
    if (input.previous && (!existing || existing.currentRevision !== input.previous.revision)) throw new Error('文档版本已变化，请重新读取后编辑');
    const now = Date.now(), id = existing?.id ?? crypto.randomUUID();
    const version = { parentRevision: input.previous?.revision, title, fileName: input.fileName ?? existing?.fileName, resource: input.resource, originalResource: input.originalResource, responseResource: input.responseResource,
      sourceRefs: input.sourceRefs, format: input.format ?? (input.resource.mimeType === 'text/markdown' ? 'markdown' : 'text'), createdAt: now } as const;
    const next: DocumentRecord = { ...existing, id, scope: { ...scope }, title, origin: input.origin, currentRevision: input.resource.id,
      libraryVisibility: input.libraryVisibility ?? existing?.libraryVisibility,
      versions: { ...existing?.versions, [input.resource.id]: version }, createdAt: existing?.createdAt ?? now, updatedAt: now,
      fileName: input.fileName ?? existing?.fileName, idempotencyKey: input.idempotencyKey ?? existing?.idempotencyKey,
      originActionId: input.originActionId ?? existing?.originActionId, linkedNodeId: input.linkedNodeId ?? existing?.linkedNodeId,
      referenceError: undefined, branchManaged: input.branchManaged ?? existing?.branchManaged, staged: input.staged ?? existing?.staged, baseRevision: input.origin === 'authored' || input.origin === 'imported' ? input.resource.id : existing?.baseRevision };
    await saveMeta(documentLibraryKey(scope), [next, ...docs.filter(d => d.id !== id)]);
    if (input.origin === 'authored' || input.origin === 'imported') projection?.write(scope, { documentId: id, revision: input.resource.id });
    notifyDocuments(scope);
    return { documentId: id, revision: input.resource.id, title };
  });
}

/** Association can be retried after a node CAS write without creating another document. */
export async function linkDocumentNode(scope: DocumentScope, links: DocumentLink[], actionId: string, nodeId: string, publish = true): Promise<void> {
  await locked(scope, async () => {
    const docs = await records(scope), ids = new Set(links.map(link => link.documentId));
    const next = docs.map(doc => ids.has(doc.id) && doc.originActionId === actionId ? { ...doc, staged: publish ? false : doc.staged, linkedNodeId: nodeId } : doc);
    await saveMeta(documentLibraryKey(scope), next);
  });
  notifyDocuments(scope);
}

export async function restoreDocumentRecords(scope: DocumentScope, incoming: DocumentRecord[]): Promise<void> {
  await locked(scope, async () => {
    const docs = await records(scope);
    if (incoming.some(doc => docs.some(old => old.id === doc.id))) throw new Error('文档恢复期间业务 ID 冲突，请重试导入');
    await saveMeta(documentLibraryKey(scope), [...incoming, ...docs]);
  });
  notifyDocuments(scope);
}

/** Recover publication after a crash between accepting an action and associating its artifacts. */
export async function reconcileAcceptedDocuments(scope: DocumentScope, accepted: unknown): Promise<void> {
  const outputs = new Map<string, Array<{ actionId: string; revision: string; nodeId?: string }>>();
  for (const value of exportValues(accepted)) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const actionId = typeof record.actionId === 'string' ? record.actionId : record.id;
    const branch = record.workspaceBranch as import('../workspace/branch').WorkspaceBranch | undefined;
    if (typeof actionId === 'string' && Array.isArray(record.outputDocuments)) for (const ref of record.outputDocuments) {
      if (branch && !branch.documents.some(change => change.link.documentId === ref?.documentId && change.link.revision === ref.revision && change.segmentIndex <= branch.mergedThrough)) continue;
      if (typeof ref?.documentId !== 'string' || typeof ref.revision !== 'string') continue;
      const entries = outputs.get(ref.documentId) ?? [];
      entries.push({ actionId, revision: ref.revision, nodeId: typeof record.actionId === 'string' && typeof record.id === 'string' ? record.id : undefined });
      outputs.set(ref.documentId, entries);
    }
  }
  if (!outputs.size) return;
  const changed = await locked(scope, async () => {
    let changed = false;
    const docs = (await records(scope)).map(doc => {
      const accepted = outputs.get(doc.id)?.find(output => output.actionId === doc.originActionId && doc.versions[output.revision]);
      if (!accepted || !doc.staged && (!accepted.nodeId || doc.linkedNodeId)) return doc;
      changed = true;
      return { ...doc, staged: false, linkedNodeId: accepted.nodeId ?? doc.linkedNodeId };
    });
    if (changed) await saveMeta(documentLibraryKey(scope), docs);
    return changed;
  });
  if (changed) notifyDocuments(scope);
}

export interface BranchDocumentChange { link: DocumentLink; beforeRevision: string | null; resource: import('../workspace/types').ResourceRef; segmentIndex: number; changes?: { added: number; removed: number } }
export async function stageDocumentRevision(scope: DocumentScope, ref: DocumentRef, resource: import('../workspace/types').ResourceRef): Promise<DocumentLink> {
  await readResource(resource);
  return locked(scope, async () => {
    const docs = await records(scope), old = docs.find(d => d.id === ref.documentId);
    if (old?.trashedAt !== undefined) throw new Error('文档已移入回收站，请先恢复');
    if (!old?.versions[ref.revision]) throw new Error('文档基础版本不存在');
    const next = { ...old, baseRevision: old.baseRevision ?? old.currentRevision, versions: { ...old.versions, [ref.revision]: { ...old.versions[ref.revision], title: old.versions[ref.revision].title ?? old.title, fileName: old.versions[ref.revision].fileName ?? old.fileName }, [resource.id]: old.versions[resource.id] ?? { ...old.versions[ref.revision], pending: true, parentRevision: ref.revision, title: resource.revisionName ?? old.versions[ref.revision].title ?? old.title, fileName: resource.revisionName ?? old.versions[ref.revision].fileName ?? old.fileName, resource, createdAt: Date.now() } } };
    await saveMeta(documentLibraryKey(scope), docs.map(doc => doc.id === old.id ? next : doc));
    return { documentId: old.id, revision: resource.id, title: next.versions[resource.id].title ?? old.title };
  });
}
/** One paragraph is one compare-and-swap batch; no document head moves on a conflict. */
export async function mergeBranchDocuments(scope: DocumentScope, changes: BranchDocumentChange[], heads: DocumentRef[]): Promise<DocumentRef[]> {
  return locked(scope, async () => {
    const docs = await records(scope), revisions = new Map(heads.map(r => [r.documentId, r.revision]));
    for (const change of changes) {
      const doc = docs.find(d => d.id === change.link.documentId);
      if (doc?.trashedAt !== undefined) throw new Error('文档已移入回收站，恢复后可重试合并');
      if (!doc?.versions[change.link.revision]) throw new Error('文件分支缺少原件');
      const actual = revisions.get(doc.id) ?? (doc.staged ? null : doc.baseRevision ?? doc.currentRevision);
      if (actual !== change.beforeRevision && actual !== change.link.revision) throw new Error('文件合并发生版本冲突，未覆盖现有内容');
      revisions.set(doc.id, change.link.revision);
    }
    const next = docs.map(doc => changes.some(change => change.link.documentId === doc.id) ? { ...projectDocument(doc, revisions.get(doc.id)!), staged: false,
      versions: Object.fromEntries(Object.entries(doc.versions).map(([id, version]) => [id, changes.some(c => c.link.documentId === doc.id && c.link.revision === id) ? { ...version, pending: false } : version])) } : doc);
    await saveMeta(documentLibraryKey(scope), next);
    return [...revisions].map(([documentId, revision]) => ({ documentId, revision }));
  });
}

/** Restoring is a local edit against the projected head; old links retain their original bytes. */
export async function restoreDocumentVersion(scope: DocumentScope, input: { current: DocumentRef; source: DocumentRef; isCurrent?: () => boolean }): Promise<DocumentLink> {
  return locked(scope, async () => {
    const docs = await records(scope), doc = docs.find(d => d.id === input.current.documentId);
    const active = () => projectDocuments(docs, projection?.read(scope)).find(d => d.id === input.current.documentId);
    const check = () => {
      if (input.isCurrent && !input.isCurrent()) throw new Error('文档所属进度已变化，请重新打开');
      if (doc?.trashedAt !== undefined) throw new Error('文档已移入回收站，请先恢复');
      if (!doc || active()?.currentRevision !== input.current.revision) throw new Error('文档版本已变化，请重新载入');
    };
    check();
    const source = doc!.versions[input.source.revision];
    if (input.source.documentId !== doc!.id || !source) throw new Error('历史版本不属于这份文档');
    if (source.pending) throw new Error('候选版本尚未播放合并，不能恢复');
    if (input.source.revision === input.current.revision) throw new Error('已是当前版本');
    const original = await readResource(source.resource);
    const resource = await storeResource({ ...original, revisionToken: crypto.randomUUID() });
    check();
    const title = source.title ?? doc!.title, fileName = source.fileName ?? doc!.fileName;
    const next = { ...doc!, origin: 'authored' as const, title, fileName, currentRevision: resource.id, baseRevision: resource.id, updatedAt: Date.now(),
      versions: { ...doc!.versions, [resource.id]: { ...source, resource, pending: false, restoredFrom: input.source.revision, parentRevision: input.current.revision, createdAt: Date.now() } } };
    await saveMeta(documentLibraryKey(scope), docs.map(d => d.id === next.id ? next : d));
    projection?.write(scope, { documentId: next.id, revision: resource.id });
    notifyDocuments(scope);
    return { documentId: next.id, revision: resource.id, title };
  });
}

export async function loadTrashedDocuments(scope: DocumentScope): Promise<DocumentRecord[]> {
  return (await loadDocumentRecords(scope)).filter(doc => doc.trashedAt !== undefined && !doc.staged).map(doc => projectDocument(doc, doc.trashedRevision && doc.versions[doc.trashedRevision] ? doc.trashedRevision : doc.currentRevision));
}
/** Soft deletion preserves immutable resources, pinned links and branch heads. */
export async function setDocumentTrashed(scope: DocumentScope, ref: DocumentRef, trashed: boolean): Promise<void> {
  await locked(scope, async () => {
    const docs = await records(scope), doc = docs.find(d => d.id === ref.documentId);
    if (!doc || doc.staged) throw new Error('当前资料库中没有这份文档');
    const active = projectDocuments(docs, projection?.read(scope)).find(d => d.id === ref.documentId);
    if (trashed && active?.currentRevision !== ref.revision) throw new Error('文档版本已变化，请重新载入');
    if ((doc.trashedAt !== undefined) === trashed) return;
    await saveMeta(documentLibraryKey(scope), docs.map(d => d.id === doc.id ? { ...d, trashedAt: trashed ? Date.now() : undefined, trashedRevision: trashed ? ref.revision : undefined } : d));
  });
  notifyDocuments(scope);
}
