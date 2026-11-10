import { exportValues } from '../export-values';
import { inlineDocumentTokens, documentHref } from './inline-links';
import { computeContentHash } from '../cas-storage';
import { documentScopeKey, loadModelDocuments, type SavedModelDocument } from '../model-documents';
import { saveToDB } from '../storage';
import { parseResource, readResource, storeResource } from '../workspace/resources';
import type { ModResource, ResourceRef } from '../workspace/types';
import { loadDocumentRecords, reconcileAcceptedDocuments, restoreDocumentRecords } from './repository';
import type { DocumentRecord, DocumentRef, DocumentScope } from './types';

export interface DocumentBundle {
  version: 'eidos_documents_v1'; records: DocumentRecord[]; resources: Record<string, ModResource>;
  legacy?: Array<{ scope: DocumentScope; documents: SavedModelDocument[] }>;
}
export const documentTransferKey = (scope: DocumentScope, ref: DocumentRef) => JSON.stringify([documentScopeKey(scope), ref.documentId, ref.revision]);
function scopeValid(scope: DocumentScope) {
  if (!scope || typeof scope.worldId !== 'string' || !scope.worldId || typeof scope.playthroughId !== 'string' || !scope.playthroughId || (scope.archiveId !== undefined && typeof scope.archiveId !== 'string')) throw new Error('文档作用域无效');
}
function refsOf(doc: DocumentRecord): ResourceRef[] {
  return Object.values(doc.versions).flatMap(v => [v.resource, v.originalResource, v.responseResource].filter((r): r is ResourceRef => Boolean(r)));
}
function hasLegacy(bundle: DocumentBundle, record: DocumentRecord) {
  return bundle.legacy?.some(group => documentScopeKey(group.scope) === documentScopeKey(record.scope) && group.documents.some(doc => doc.id === record.legacyId));
}
/** Inspect all references before any destination index can become visible. */
export async function validateDocumentBundle(bundle: DocumentBundle): Promise<void> {
  if (!bundle || bundle.version !== 'eidos_documents_v1' || !Array.isArray(bundle.records) || !bundle.resources || typeof bundle.resources !== 'object' || Array.isArray(bundle.resources)) throw new Error('文档恢复包无效');
  const ids = new Set<string>();
  for (const group of bundle.legacy ?? []) {
    scopeValid(group.scope);
    if (!Array.isArray(group.documents) || group.documents.some(d => typeof d.id !== 'string' || typeof d.content !== 'string' || !Array.isArray(d.parts))) throw new Error('旧文档原文无效');
  }
  await validateResourceBundle(bundle.resources);
  for (const doc of bundle.records) {
    scopeValid(doc.scope);
    const identity = JSON.stringify([documentScopeKey(doc.scope), doc.id]);
    if (typeof doc.id !== 'string' || !doc.id || typeof doc.title !== 'string' || !doc.title || ids.has(identity) || !doc.versions || !doc.versions[doc.currentRevision]) throw new Error('文档索引或当前版本无效');
    ids.add(identity);
    for (const [revision, v] of Object.entries(doc.versions)) {
      if (!v || !['text', 'markdown'].includes(v.format) || revision !== v.resource?.id) throw new Error('文档历史版本无效');
      for (const ref of [v.resource, v.originalResource, v.responseResource].filter((r): r is ResourceRef => Boolean(r))) {
        if (!bundle.resources[ref.id]) {
          if (ref === v.resource && doc.referenceError && ref.id.startsWith('legacy_') && hasLegacy(bundle, doc)) continue;
          throw new Error('文档版本缺少完整原件');
        }
        const resource = bundle.resources[ref.id];
        if (ref.size !== resource.size || ref.mimeType !== resource.mimeType) throw new Error('文档版本元信息与原件不一致');
      }
      if (v.sourceRefs !== undefined && (!Array.isArray(v.sourceRefs) || v.sourceRefs.some(c => typeof c.blockId !== 'string' || !Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end) || c.start < 0 || c.end <= c.start))) throw new Error('文档来源区间无效');
      assertDocumentReferences(v.sourceRefs, doc.scope, bundle);
    }
  }
}
export function assertDocumentReferences(value: unknown, scope: DocumentScope, bundle: DocumentBundle): void {
  const known = new Map(bundle.records.filter(doc => documentScopeKey(doc.scope) === documentScopeKey(scope)).map(doc => [doc.id, doc.versions]));
  const check = (ref: Partial<DocumentRef>) => {
    if (typeof ref.documentId === 'string' && typeof ref.revision === 'string' && !known.get(ref.documentId)?.[ref.revision]) throw new Error('节点引用的文档版本缺失');
  };
  for (const item of exportValues(value)) {
    if (typeof item === 'string') { for (const token of inlineDocumentTokens(item)) if (token.ref) check(token.ref); }
    else if (item && typeof item === 'object') check(item as Partial<DocumentRef>);
  }
}

export async function collectDocumentBundle(input: { scopes: DocumentScope[]; nodes?: unknown }): Promise<DocumentBundle> {
  const result: DocumentBundle = { version: 'eidos_documents_v1', records: [], resources: {} };
  for (const scope of new Map(input.scopes.map(s => [documentScopeKey(s), s])).values()) {
    if (input.nodes && input.scopes.length === 1) await reconcileAcceptedDocuments(scope, input.nodes);
    const referenced = new Set<string>();
    for (const value of exportValues(input.nodes)) if (value && typeof value === 'object') {
      const ref = value as Partial<DocumentRef>; if (typeof ref.documentId === 'string') referenced.add(ref.documentId);
    }
    const docs = (await loadDocumentRecords(scope)).filter(doc => !doc.staged || referenced.has(doc.id)); result.records.push(...docs);
    const legacy = await loadModelDocuments(scope);
    if (legacy.length) (result.legacy ??= []).push({ scope, documents: legacy });
    for (const doc of docs) for (const ref of refsOf(doc)) {
      if (doc.referenceError && ref.id.startsWith('legacy_')) continue;
      result.resources[ref.id] ??= await readResource(ref);
    }
  }
  if (input.nodes && input.scopes.length === 1) assertDocumentReferences(input.nodes, input.scopes[0], result);
  await validateDocumentBundle(result);
  return result;
}
export async function restoreDocumentBundle(bundle: DocumentBundle, scopeMap: Map<string, DocumentScope>): Promise<Map<string, DocumentRef>> {
  await validateDocumentBundle(bundle);
  const origins = new Map<DocumentRecord, DocumentScope>();
  const mapping = new Map<string, DocumentRef>(), groups = new Map<string, { scope: DocumentScope; records: DocumentRecord[]; known: Set<string> }>();
  for (const doc of bundle.records) {
    const scope = scopeMap.get(documentScopeKey(doc.scope));
    if (!scope) throw new Error('文档恢复缺少作用域映射');
    scopeValid(scope);
    const key = documentScopeKey(scope), group = groups.get(key) ?? { scope, records: [], known: new Set((await loadDocumentRecords(scope)).map(d => d.id)) };
    const id = group.known.has(doc.id) ? crypto.randomUUID() : doc.id; group.known.add(id);
    for (const revision of Object.keys(doc.versions)) mapping.set(documentTransferKey(doc.scope, { documentId: doc.id, revision }), { documentId: id, revision });
    const next = { ...structuredClone(doc), id, scope: { ...scope }, ...(doc.legacyId ? { legacyId: id } : {}) };
    group.records.push(next); origins.set(next, doc.scope); groups.set(key, group);
  }
  for (const [id, resource] of Object.entries(bundle.resources)) if ((await storeResource(resource)).id !== id) throw new Error('文档原件版本变化');
  for (const old of bundle.legacy ?? []) {
    const scope = scopeMap.get(documentScopeKey(old.scope)); if (!scope) throw new Error('旧文档恢复缺少作用域映射');
    const previous = await loadModelDocuments(scope);
    const docs = old.documents.map(doc => {
      const record = bundle.records.find(d => documentScopeKey(d.scope) === documentScopeKey(old.scope) && d.id === doc.id);
      const mapped = record ? mapping.get(documentTransferKey(old.scope, { documentId: doc.id, revision: record.currentRevision })) : undefined;
      return { ...structuredClone(doc), id: mapped?.documentId ?? crypto.randomUUID() };
    });
    await saveToDB(documentScopeKey(scope), [...docs, ...previous]);
  }
  for (const { scope, records } of groups.values()) {
    for (const doc of records) {
      const oldScope = origins.get(doc)!;
      for (const v of Object.values(doc.versions)) if (v.sourceRefs) v.sourceRefs = remapDocumentReferences(v.sourceRefs, oldScope, mapping);
    }
    await restoreDocumentRecords(scope, records);
  }
  return mapping;
}
/** Rewrite every pinned link, including inventory, history and source citations, in a cloned envelope. */
export function remapDocumentReferences<T>(value: T, scope: DocumentScope, mapping: Map<string, DocumentRef>, destination?: DocumentScope): T {
  if (typeof value === 'string') {
    let result = value as string;
    for (const token of inlineDocumentTokens(value)) if (token.ref) {
      const ref = mapping.get(documentTransferKey(scope, token.ref));
      if (!ref) throw new Error('正文文档链接无法恢复');
      result = result.replace(token.target, documentHref(ref));
    }
    return result as T;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(child => remapDocumentReferences(child, scope, mapping, destination)) as T;
  const source = value as Record<string, unknown>, next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) next[key] = remapDocumentReferences(child, scope, mapping, destination);
  if (destination && source.scope && typeof source.scope === 'object' && documentScopeKey(source.scope as DocumentScope) === documentScopeKey(scope)) next.scope = { ...destination };
  if (typeof source.documentId === 'string' && typeof source.revision === 'string') {
    const ref = mapping.get(documentTransferKey(scope, source as unknown as DocumentRef));
    if (!ref) throw new Error('文档版本引用无法恢复');
    Object.assign(next, ref);
  }
  if (typeof source.inputIdentity === 'string' && source.inputIdentity.startsWith('eidos_action_v1:')) {
    try {
      const [text, refs, revision] = JSON.parse(source.inputIdentity.slice('eidos_action_v1:'.length)) as [string, string[], string];
      const linked = refs.map(raw => { const [documentId, rev, allowWrite] = JSON.parse(raw); const ref = mapping.get(documentTransferKey(scope, { documentId, revision: rev })); if (!ref) throw new Error('行动引用无法恢复'); return JSON.stringify([ref.documentId, ref.revision, ...(typeof allowWrite === 'boolean' ? [allowWrite] : [])]); });
      let mounted = revision;
      if (revision) mounted = JSON.stringify((JSON.parse(revision) as string[]).map(entry => {
        const prefix = entry.startsWith('input:') ? 'input:' : entry.startsWith('library:') ? 'library:' : null;
        if (!prefix) return entry;
        for (const [key, ref] of mapping) { const [oldScope, id, rev] = JSON.parse(key); if (oldScope === documentScopeKey(scope) && entry === `${prefix}${id}:${rev}`) return `${prefix}${ref.documentId}:${ref.revision}`; }
        throw new Error('挂载文档引用无法恢复');
      }).sort());
      next.inputIdentity = `eidos_action_v1:${JSON.stringify([text, [...new Set(linked)].sort(), mounted])}`;
    } catch { throw new Error('行动文件身份无法恢复'); }
  }
  return next as T;
}

export async function validateResourceBundle(resources: Record<string, ModResource>): Promise<void> {
  for (const [id, raw] of Object.entries(resources)) {
    const resource = parseResource(raw);
    if (id !== raw.id || id !== `material_${await computeContentHash({ mimeType: resource.mimeType, text: resource.text, base64: resource.base64, ...(resource.revisionToken !== undefined ? { revisionToken: resource.revisionToken } : {}), ...(resource.revisionName !== undefined ? { revisionName: resource.revisionName } : {}) })}`) throw new Error('文档原件与内容版本不一致');
  }
}
