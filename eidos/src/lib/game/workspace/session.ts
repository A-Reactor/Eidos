import { checkMetaWorkspaceAccess, stageMetaWorkspaceOperation } from '@/lib/meta-reality/workspace-bridge';
import type { MetaChannelManifest } from '@/lib/meta-reality/types';
import { loadDocumentRecords } from '../documents/repository';
import { isAutomaticImageDocument } from '../documents/visibility';
import type { DocumentLink, DocumentScope } from '../documents/types';
import { filePath, withinPath } from './paths';
import { runFileOperation } from './operations';
import { readResource } from './resources';
import { indexWorkspaceText } from './index';
import type { WorkspaceCatalogEntry, ResourceRef, WorkspaceCitation, WorkspaceFiles, WorkspaceToolRequest, WorkspaceToolResult } from './types';
import { parseImageFile, readWorkspaceImage, type WorkspaceImageLibrary } from '../midori/workspace-images';

export interface WorkspaceMetaMount { id: string; files: WorkspaceFiles; currentFiles?: () => WorkspaceFiles }
export interface WorkspaceSession {
  /** Scoped actual approvals survive a page handoff, without trusting model-authored internal fields. */
  npcProfileReceipts?: import('../action-operations').ActionOperationReceipt[];
  collapsedPaths?: Set<string>;
  imageLibrary?: WorkspaceImageLibrary;
  adopted?: boolean; writableDocuments: Set<string>; inputRevision?: string; scope: DocumentScope; actionId: string; parentNodeId: string | null; draftRoot: string;
  files: WorkspaceFiles; initialFiles: WorkspaceFiles; inputLinks: DocumentLink[]; actionInputs: DocumentLink[];
  documentByPath: Record<string, DocumentLink>; receipts: WorkspaceToolResult[]; previousEffects?: WorkspaceToolResult[]; evidence: WorkspaceCitation[];
  manifest?: MetaChannelManifest | null; currentManifest?: () => MetaChannelManifest | null;
  metaMounts: WorkspaceMetaMount[]; closed: boolean; isCurrent(): boolean;
}
const activeSessions = new Map<string, WorkspaceSession>();
export function getWorkspaceSession(requestId: string): WorkspaceSession | null { return activeSessions.get(requestId) ?? null; }
export function registerWorkspaceSession(requestId: string, session: WorkspaceSession): void {
  const known = [...activeSessions.values()].includes(session);
  if (!known && new Set(activeSessions.values()).size >= 8) {
    const oldest = activeSessions.values().next().value!; oldest.closed = true;
    for (const [key, value] of activeSessions) if (value === oldest) activeSessions.delete(key);
  }
  if (known) for (const [key, value] of activeSessions) if (value === session && !key.startsWith('prediction:')) activeSessions.delete(key);
  activeSessions.set(requestId, session);
}
export async function createWorkspaceSession(input: {
  scope: DocumentScope; actionId: string; parentNodeId: string | null; inputs: DocumentLink[]; library?: DocumentLink[]; writableDocuments?: readonly import('../documents/types').DocumentRef[];
  branchFiles?: WorkspaceFiles; metaMounts?: WorkspaceMetaMount[]; manifest?: MetaChannelManifest | null; currentManifest?: () => MetaChannelManifest | null; isCurrent?: () => boolean;
}): Promise<WorkspaceSession> {
  const files: WorkspaceFiles = {}, documentByPath: Record<string, DocumentLink> = {}, collapsedPaths = new Set<string>();
  const docs = input.inputs.length || input.library?.length ? await loadDocumentRecords(input.scope) : [];
  for (const link of input.inputs) {
    const doc = docs.find(d => d.id === link.documentId), version = doc?.versions[link.revision];
    if (!doc || doc.staged || !version) throw new Error('引用文档的版本不存在，请重新选择');
    if (doc.referenceError) throw new Error(doc.referenceError);
    const path = filePath(`inputs/${doc.id}/${link.revision}/source.${version.format === 'markdown' ? 'md' : 'txt'}`);
    files[path] = version.resource; documentByPath[path] = { ...link, title: link.title || doc.title };
    if (isAutomaticImageDocument(doc)) collapsedPaths.add(path);
  }
  for (const link of input.library ?? []) {
    const doc = docs.find(d => d.id === link.documentId), version = doc?.versions[link.revision];
    if (!doc || doc.trashedAt !== undefined || !version || doc.referenceError) continue;
    const path = filePath(`library/${doc.id}/source.${version.format === 'markdown' ? 'md' : 'txt'}`);
    files[path] = version.resource; documentByPath[path] = { ...link };
    if (isAutomaticImageDocument(doc)) collapsedPaths.add(path);
  }
  for (const [path, ref] of Object.entries(input.branchFiles ?? {})) if (withinPath(path, 'outputs')) files[filePath(path)] = ref;
  for (const mount of input.metaMounts ?? []) for (const [path, ref] of Object.entries(mount.files)) files[filePath(`meta/${mount.id}/${path}`)] = ref;
  return { collapsedPaths, writableDocuments: new Set((input.writableDocuments ?? []).map(ref => `${ref.documentId}:${ref.revision}`)), scope: { ...input.scope }, actionId: input.actionId, parentNodeId: input.parentNodeId, draftRoot: filePath(`drafts/${input.actionId}`),
    files: { ...files }, initialFiles: { ...files }, inputLinks: structuredClone(input.inputs), actionInputs: structuredClone(input.inputs), documentByPath,
    receipts: [], evidence: [], manifest: structuredClone(input.manifest), currentManifest: input.currentManifest, metaMounts: input.metaMounts ?? [], closed: false, isCurrent: input.isCurrent ?? (() => true) };
}
export function assistantCanAccess(session: WorkspaceSession, path: string, operation: 'read' | 'write') {
  if (operation === 'write') {
    if (session.imageLibrary?.entries[path]) return session.imageLibrary.entries[path].writable;
    const doc = session.documentByPath[path];
    return withinPath(path, session.draftRoot) || withinPath(path, 'library') && Boolean(doc && session.writableDocuments.has(`${doc.documentId}:${doc.revision}`));
  }
  return Boolean(session.files[path]) && (withinPath(path, 'library') || withinPath(path, 'inputs') || withinPath(path, 'outputs') || withinPath(path, 'maps') || withinPath(path, 'images') || withinPath(path, session.draftRoot));
}
export function workspaceCatalogEntry(session: WorkspaceSession, path: string, ref: ResourceRef): WorkspaceCatalogEntry {
  const link = session.documentByPath[path];
  const imagePath = link && session.imageLibrary?.pathsByDocument[`${link.documentId}:${link.revision}`];
  return { path, version: ref.id, writable: assistantCanAccess(session, path, 'write'), name: ref.revisionName ?? link?.title ?? ref.name, mimeType: ref.mimeType, size: ref.size,
    ...(imagePath ? { imagePath } : {}),
    ...(session.imageLibrary?.entries[path]?.selected || link && session.actionInputs.some(input => input.documentId === link.documentId && input.revision === link.revision) ? { selected: true } : {}) };
}
export function workspacePathOrder(session: WorkspaceSession, a: string, b: string): number {
  return Number(Boolean(workspaceCatalogEntry(session, b, session.files[b]).selected)) - Number(Boolean(workspaceCatalogEntry(session, a, session.files[a]).selected)) || Number(assistantCanAccess(session, b, 'write')) - Number(assistantCanAccess(session, a, 'write')) || a.localeCompare(b);
}
export function workspaceCatalogAccess(session: WorkspaceSession, path: string): boolean {
  if (assistantCanAccess(session, path, 'read')) return true;
  const [, mountId, ...parts] = path.split('/');
  if (!path.startsWith('meta/') || !session.metaMounts.some(m => m.id === mountId)) return false;
  return Boolean(session.manifest?.channels.some(channel => channel.workspaceGrants?.some(grant => grant.mountId === mountId && grant.npcIds.some(npcId => grant.operations.some(operation => checkMetaWorkspaceAccess({ manifest: session.manifest, actor: { kind: 'character', npcId, channelId: channel.id }, mountId, path: parts.join('/'), operation }).allowed)))));
}
export function workspaceDefaultCatalogAccess(session: WorkspaceSession, path: string): boolean {
  if (!workspaceCatalogAccess(session, path)) return false;
  return !(path.startsWith('images/') || session.collapsedPaths?.has(path)) || workspaceCatalogEntry(session, path, session.files[path]).selected === true;
}
export async function runWorkspaceTool(session: WorkspaceSession, request: WorkspaceToolRequest): Promise<WorkspaceToolResult> {
  let result: WorkspaceToolResult;
  try {
    result = request.actor?.kind === 'character' ? await stageMetaWorkspaceOperation(session, request) : await runFileOperation(request, {
      current: () => !session.closed && session.isCurrent(), files: () => session.files,
      validateWrite: (path, content) => { if (path.startsWith('images/')) parseImageFile(session, path, content); },
      replaceFiles: next => { session.files = next; }, canRename: path => withinPath(path, 'library') && assistantCanAccess(session, path, 'write'), canList: path => request.params.path === undefined ? workspaceDefaultCatalogAccess(session, path) : workspaceCatalogAccess(session, path), comparePaths: (a, b) => workspacePathOrder(session, a, b), describe: (path, ref) => workspaceCatalogEntry(session, path, ref), canAccess: (path, operation) => assistantCanAccess(session, path, operation),
    });
    if (result.entries) result.entries = result.entries.map(entry => workspaceCatalogEntry(session, entry.path, session.files[entry.path]));
    if (request.method === 'files.read' && result.path && result.text !== undefined) {
      await readWorkspaceImage(session, result.path);
      const resource = await readResource(session.files[result.path]);
      if (session.closed || !session.isCurrent()) throw new Error('请求已取消或归属发生变化');
      const start = result.offset ?? 0, end = start + result.text.length;
      result.citations = indexWorkspaceText(result.path, resource).filter(ref => ref.start < end && ref.end > start)
        .map(ref => ({ ...ref, start: Math.max(start, ref.start), end: Math.min(end, ref.end) }));
      result.document = session.documentByPath[result.path];
      session.evidence.push(...result.citations);
    }
  } catch (cause) {
    let error = cause instanceof Error ? cause.message : '文件操作失败';
    const path = typeof request.params.path === 'string' ? request.params.path : '', doc = session.documentByPath[path];
    if (doc && path.startsWith('inputs/') && ['files.write', 'files.patch', 'files.rename'].includes(request.method)) {
      const target = Object.keys(session.documentByPath).find(p => p.startsWith('library/') && session.documentByPath[p].documentId === doc.documentId);
      error = target && assistantCanAccess(session, target, 'write')
        ? `引用原件为只读版本；请使用可写文档路径 ${target}，并按该路径目录的 version 修改。`
        : '引用原件为只读版本；本次未获得该文档的修改授权。';
    }
    result = { method: request.method, ...(typeof request.params.path === 'string' ? { path: request.params.path } : {}), status: /访问|相对路径|通道|只读|授权/.test(error) ? 'denied' : 'failed', error };
  }
  result = { ...result, actor: request.actor ?? { kind: 'assistant' }, actionId: session.actionId };
  if (result.path && session.documentByPath[result.path]) result.document = session.documentByPath[result.path];
  session.receipts.push(result);
  return result;
}

/** Include all aliases and receipts: a staged version may no longer be the latest file mapping. */
export function workspaceResourcePins(): string[] {
  return [...new Set([...activeSessions.values()].filter(s => !s.closed).flatMap(s => [
    ...Object.values(s.files).map(r => r.id), ...Object.values(s.initialFiles).map(r => r.id),
    ...s.receipts.flatMap(r => [r.beforeVersion, r.afterVersion, r.resource?.id].filter((id): id is string => typeof id === 'string')),
    ...Object.values(s.imageLibrary?.entries ?? {}).flatMap(entry => entry.image.originalResource ? [entry.image.originalResource.id] : []),
  ]))];
}
