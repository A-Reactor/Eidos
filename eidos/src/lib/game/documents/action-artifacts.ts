import type { StorySegment } from '@/lib/ai/types';
import { prepareMetaWorkspaceEffects, type PreparedMetaWorkspaceEffects } from '@/lib/meta-reality/workspace-bridge';
import { parseActionDocuments } from '@/lib/ai/document-response';
import type { WorldLineNode } from '../types';
import type { WorkspaceFiles, WorkspaceToolResult } from '../workspace/types';
import type { WorkspaceSession } from '../workspace/session';
import { withinPath } from '../workspace/paths';
import { lineChanges } from '../workspace/line-changes';
import { readResource, storeResource } from '../workspace/resources';
import { linkDocumentNode, saveDocument, stageDocumentRevision } from './repository';
import type { WorkspaceBranch } from '../workspace/branch';
import { inlineDocumentTokens, resolveBranchInlineDocuments } from './inline-links';
import type { DocumentLink, DocumentScope } from './types';
import { prepareImageChanges } from '../midori/workspace-images';
import { libraryRevisionEffects } from './library-revisions';
import { ACTION_TOOL_LIMITS } from '../action-tool-budget';

export interface PreparedActionArtifacts {
  branch?: WorkspaceBranch; scope: DocumentScope; actionId: string; metaEffects?: PreparedMetaWorkspaceEffects; inputDocuments: DocumentLink[]; outputDocuments: DocumentLink[];
  byKey: Record<string, DocumentLink>; workspaceState: WorkspaceFiles; validatedEffects: WorkspaceToolResult[];
}
/** Invalid candidates need a corrected response, whereas storage failures can retry locally. */
export class ActionArtifactValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ActionArtifactValidationError'; }
}
function current(session: WorkspaceSession | null) {
  if (session && (session.closed || !session.isCurrent())) throw new DOMException('行动已取消或归属发生变化', 'AbortError');
}
function selectEffects(input: { effectIds?: unknown; segments?: StorySegment[] }, session: WorkspaceSession | null) {
  const effectIds = [...new Set([...(Array.isArray(input.effectIds) ? input.effectIds : input.effectIds === undefined ? [] : [input.effectIds]), ...(input.segments ?? []).flatMap(segment => segment.workspaceEffects ?? [])])];
  if (effectIds.some(id => typeof id !== 'string') || effectIds.length > ACTION_TOOL_LIMITS.write) throw new Error('文件效果列表无效');
  const selected = session?.receipts.filter(receipt => effectIds.includes(receipt.operationId)) ?? [];
  if (selected.length !== effectIds.length || selected.some(receipt => receipt.status !== 'staged')) throw new Error('文件变更没有本轮成功暂存回执');
  const libraryWrites = selected.filter(receipt => receipt.actor?.kind === 'assistant' && receipt.path?.startsWith('library/'));
  const libraryEffects = libraryWrites.length ? libraryRevisionEffects(session!, libraryWrites) : [];
  const draftEffects = selected.filter(receipt => receipt.actor?.kind === 'assistant' && session && receipt.path && withinPath(receipt.path, session.draftRoot));
  const imageEffects = selected.filter(receipt => receipt.actor?.kind === 'assistant' && session && receipt.path && session.imageLibrary?.entries[receipt.path]);
  const roleIds = selected.filter(receipt => receipt.actor?.kind === 'character').map(receipt => receipt.operationId!);
  if (libraryEffects.length + draftEffects.length + imageEffects.length + roleIds.length !== selected.length) throw new Error('文件回执不属于本轮文档库、草稿、图像配置或角色通道');
  return { selected, libraryEffects, draftEffects, imageEffects, roleIds };
}
function documentAnchor(segments?: StorySegment[]) {
  const lastSegment = Math.max(0, (segments?.length ?? 1) - 1);
  const anchor = (key: string, explicit?: number) => {
    const linked = segments?.findIndex(segment => inlineDocumentTokens(segment.text).some(token => token.target === `document:${key}`));
    const index = explicit ?? (linked !== undefined && linked >= 0 ? linked : lastSegment);
    if (index > lastSegment || linked !== undefined && linked >= 0 && linked < index) throw new Error('文档对应段落不存在或正文提前引用了尚未出现的产物');
    return index;
  };
  return anchor;
}
async function stageLibraryRevisions({ prepared, session, effects, segments, anchor }: { prepared: PreparedActionArtifacts; session: WorkspaceSession | null; effects: WorkspaceToolResult[]; segments?: StorySegment[]; anchor: ReturnType<typeof documentAnchor> }) {
  for (const receipt of effects) {
    const doc = session!.documentByPath[receipt.path!];
    if (!doc || !session!.writableDocuments.has(`${doc.documentId}:${doc.revision}`) || !receipt.resource || !receipt.beforeVersion) throw new Error('文档写入未获授权');
    const base = session!.initialFiles[receipt.path!];
    const beforeRef = base.id === receipt.beforeVersion ? base : session!.receipts.find(item => item.afterVersion === receipt.beforeVersion && item.path === receipt.path)?.resource;
    if (!beforeRef) throw new Error('文档修改版本链缺少基础原件');
    const before = await readResource(beforeRef);
    receipt.changes = lineChanges(before.text ?? '', (await readResource(receipt.resource)).text ?? '');
    const link = await stageDocumentRevision(prepared.scope, { documentId: doc.documentId, revision: receipt.beforeVersion }, receipt.resource);
    current(session);
    if (!prepared.branch) throw new Error('文档修改需要播放分支');
    const index = segments!.findIndex(segment => segment.workspaceEffects?.includes(receipt.operationId!));
    const segmentIndex = index >= 0 ? index : anchor(doc.documentId);
    prepared.branch.documents.push({ link, resource: receipt.resource, beforeRevision: receipt.beforeVersion, segmentIndex, changes: receipt.changes });
    prepared.byKey[doc.documentId] = link;
  }
}
function bindBranchEffects({ prepared, session, roleIds, libraryEffects, draftEffects, segments }: { prepared: PreparedActionArtifacts; session: WorkspaceSession | null; roleIds: string[]; libraryEffects: WorkspaceToolResult[]; draftEffects: WorkspaceToolResult[]; segments?: StorySegment[] }) {
  const lastSegment = Math.max(0, (segments?.length ?? 1) - 1);
  if (session) {
    prepared.metaEffects = prepareMetaWorkspaceEffects(session, roleIds);
    prepared.validatedEffects = [...prepared.metaEffects.receipts, ...libraryEffects, ...draftEffects];
    if (prepared.branch) {
      prepared.validatedEffects = prepared.validatedEffects.map(receipt => ({ ...receipt, status: 'staged' }));
      const lastByPath = new Map<string, number>();
      prepared.branch.effects = prepared.validatedEffects.map(receipt => {
        const index = segments!.findIndex(segment => segment.workspaceEffects?.includes(receipt.operationId!));
        const document = prepared.branch!.documents.find(change => change.link.revision === receipt.afterVersion && session.documentByPath[receipt.path ?? '']?.documentId === change.link.documentId);
        const segmentIndex = index >= 0 ? index : document?.segmentIndex ?? lastSegment;
        if (segmentIndex < (lastByPath.get(receipt.path!) ?? -1)) throw new Error('同一文件的段落合并顺序与版本顺序冲突');
        lastByPath.set(receipt.path!, segmentIndex);
        return { ...receipt, segmentIndex };
      });
    }
  }
}
export async function prepareActionArtifacts(input: {
  scope: DocumentScope; actionId: string; session: WorkspaceSession | null; inputs: DocumentLink[]; documents?: unknown; effectIds?: unknown; segments?: StorySegment[];
}): Promise<PreparedActionArtifacts> {
  const session = input.session;
  current(session);
  const { docs, selected, libraryEffects, draftEffects, imageEffects, roleIds, metaEffects, positions } = validateCandidate(input);
  const workspaceState = Object.fromEntries(Object.entries(session?.initialFiles ?? {}).filter(([path]) => withinPath(path, 'outputs')));
  const prepared: PreparedActionArtifacts = { scope: input.scope, actionId: input.actionId, inputDocuments: structuredClone(input.inputs), outputDocuments: [], byKey: {}, workspaceState, metaEffects, validatedEffects: metaEffects?.receipts ?? [] };
  const anchor = documentAnchor(input.segments);
  const attempts = (session?.receipts ?? []).filter(r => r.status === 'failed' || r.status === 'denied').map(r => ({ ...r, segmentIndex: Math.min(r.segmentIndex ?? 0, Math.max(0, (input.segments?.length ?? 1) - 1)) }));
  if (input.segments && (docs.length || selected.length || attempts.length)) prepared.branch = { id: input.actionId, scope: input.scope, baseNodeId: session?.parentNodeId ?? null, documents: [], effects: [], outputs: [], attempts, mergedThrough: -1 };
  const resources = await Promise.all(docs.map(d => d.artifactRef ? Promise.resolve(session!.files[d.artifactRef.path])
    : storeResource({ name: `${d.key}.${d.format === 'markdown' ? 'md' : 'txt'}`, mimeType: d.format === 'markdown' ? 'text/markdown' : 'text/plain', text: d.content })));
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], resource = resources[i]; current(session);
    const text = (await readResource(resource)).text;
    if (!text?.trim()) throw new ActionArtifactValidationError('文档草稿正文为空');
    const link = await saveDocument(input.scope, { title: d.title, origin: 'generated', resource, format: d.format, sourceRefs: d.sourceRefs,
      idempotencyKey: `${input.actionId}:${d.key}`, originActionId: input.actionId, staged: true, branchManaged: Boolean(input.segments) });
    current(session);
    prepared.outputDocuments.push(link); prepared.byKey[d.key] = link;
    const path = `outputs/${input.actionId}/${d.key}.${d.format === 'markdown' ? 'md' : 'txt'}`;
    if (prepared.branch) {
      const segmentIndex = positions[i];
      prepared.branch.documents.push({ link, resource, beforeRevision: null, segmentIndex, changes: lineChanges('', text) });
      prepared.branch.outputs.push({ path, resource, segmentIndex });
    } else workspaceState[path] = resource;
  }
  current(session);
  await stageLibraryRevisions({ prepared, session, effects: libraryEffects, segments: input.segments, anchor });
  bindBranchEffects({ prepared, session, roleIds, libraryEffects, draftEffects, segments: input.segments });
  if (imageEffects.length) {
    if (!prepared.branch || !session) throw new Error('图像修改需要播放分支');
    const effects = imageEffects.map(receipt => ({ ...receipt, segmentIndex: input.segments!.findIndex(segment => segment.workspaceEffects?.includes(receipt.operationId!)) }));
    for (const effect of effects) if (effect.segmentIndex < 0) effect.segmentIndex = Math.max(0, input.segments!.length - 1);
    const lastImageSegment = new Map<string, number>();
    for (const effect of effects) {
      if (effect.segmentIndex < (lastImageSegment.get(effect.path!) ?? -1)) throw new Error('同一图像的段落顺序与修改顺序冲突');
      lastImageSegment.set(effect.path!, effect.segmentIndex);
    }
    effects.sort((a, b) => a.segmentIndex - b.segmentIndex);
    prepared.branch.images = await prepareImageChanges(session, effects);
    prepared.branch.effects.push(...effects);
    prepared.validatedEffects.push(...effects);
  }
  return prepared;
}
function validateCandidate(input: Parameters<typeof prepareActionArtifacts>[0]) {
  try {
    const docs = parseActionDocuments(input.documents), session = input.session;
    if (session && (session.actionId !== input.actionId || JSON.stringify(session.scope) !== JSON.stringify(input.scope))) throw new Error('文档工作区不属于本次行动');
    const effects = selectEffects(input, session);
    const metaEffects = session ? prepareMetaWorkspaceEffects(session, effects.roleIds) : undefined;
    const anchor = documentAnchor(input.segments);
    const positions = docs.map(d => {
      if (d.artifactRef && (!session || !withinPath(d.artifactRef.path, session.draftRoot) || session.files[d.artifactRef.path]?.id !== d.artifactRef.version)) throw new Error('文档草稿不属于本轮或版本已变化');
      if (d.artifactRef && (session!.files[d.artifactRef.path].size === 0 || session!.receipts.some(r => r.afterVersion === d.artifactRef!.version && r.emptyText))) throw new Error('文档草稿正文为空');
      for (const citation of d.sourceRefs ?? []) {
        const path = Object.entries(session?.documentByPath ?? {}).find(([, link]) => link.documentId === citation.documentId && link.revision === citation.revision)?.[0];
        if (!path || !session?.evidence.some(e => e.path === path && e.version === citation.revision && e.blockId === citation.blockId && e.start <= citation.start && e.end >= citation.end)) throw new Error('文档引用并非本轮实际读取的原文');
      }
      const receipt = effects.draftEffects.find(r => r.path === d.artifactRef?.path && r.afterVersion === d.artifactRef?.version);
      const index = receipt ? input.segments?.findIndex(segment => segment.workspaceEffects?.includes(receipt.operationId!)) : undefined;
      return input.segments ? anchor(d.key, d.segmentIndex ?? (index !== undefined && index >= 0 ? index : undefined)) : 0;
    });
    if (effects.draftEffects.some(receipt => !docs.some(d => d.artifactRef?.path === receipt.path && d.artifactRef?.version === receipt.afterVersion))) throw new Error('已选择的草稿尚未关联输出文档，请用 documents.artifactRef 指定本轮草稿版本。');
    return { docs, ...effects, metaEffects, positions };
  } catch (error) { throw new ActionArtifactValidationError(error instanceof Error ? error.message : '文件输出未通过校验'); }
}
/** Pure preflight for the model correction loop; no document or active head is saved. */
export function validateActionArtifactCandidate(input: Parameters<typeof prepareActionArtifacts>[0] & { availableActions?: string[] }): void {
  const { docs, libraryEffects } = validateCandidate(input);
  const known = Object.values(input.session?.documentByPath ?? {});
  const byKey: Record<string, DocumentLink> = Object.fromEntries(docs.map(d => [d.key, { documentId: `pending:${d.key}`, revision: 'material_0000000000000000', title: d.title }]));
  const anchor = documentAnchor(input.segments);
  const changes = libraryEffects.map(receipt => {
    const before = input.session!.documentByPath[receipt.path!];
    if (!before || !receipt.afterVersion) throw new ActionArtifactValidationError('文档写入未获授权');
    const link = { ...before, revision: receipt.afterVersion };
    byKey[before.documentId] = link;
    const index = input.segments?.findIndex(s => s.workspaceEffects?.includes(receipt.operationId!)) ?? -1;
    return { link, beforeRevision: receipt.beforeVersion ?? null, segmentIndex: index >= 0 ? index : anchor(before.documentId) };
  });
  const validate = (text: string, index: number) => {
    const real = [...known, ...changes.filter(c => c.segmentIndex <= index).map(c => c.link)];
    for (const token of inlineDocumentTokens(text)) if (token.ref && !real.some(ref => ref.documentId === token.ref!.documentId && ref.revision === token.ref!.revision)) throw new ActionArtifactValidationError('正文引用了不可用的文档版本');
    try { resolveBranchInlineDocuments(text, { byKey, branch: { documents: changes } }, known, index); }
    catch (error) { throw new ActionArtifactValidationError(error instanceof Error ? error.message : '文档链接不可用'); }
  };
  input.segments?.forEach((segment, index) => validate(segment.text, index));
  input.availableActions?.forEach(action => validate(action, Math.max(0, (input.segments?.length ?? 1) - 1)));
}
export async function finalizeActionArtifacts(prepared: PreparedActionArtifacts, node: WorldLineNode): Promise<void> {
  if (node.actionId !== prepared.actionId) throw new Error('文档关联的行动节点不匹配');
  if (prepared.outputDocuments.length) await linkDocumentNode(prepared.scope, prepared.outputDocuments, prepared.actionId, node.id, !prepared.branch);
}
export function resolveDocumentItems<T extends { documentKey?: string; documentRef?: unknown }>(items: T[], prepared: PreparedActionArtifacts): T[] {
  return items.map(item => {
    const { documentKey, ...rest } = item;
    if (documentKey === undefined) return { ...rest, documentRef: undefined } as T;
    const link = prepared.byKey[documentKey];
    if (!link) throw new Error('物品引用了本轮不存在的文档 key');
    return { ...rest, documentRef: { documentId: link.documentId, revision: link.revision } } as T;
  });
}
