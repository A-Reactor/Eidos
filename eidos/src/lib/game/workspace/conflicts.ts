import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { StorySegment } from '@/lib/ai/types';
import type { DocumentLink } from '../documents/types';
import { loadDocumentRecords, readDocument, stageDocumentRevision } from '../documents/repository';
import { currentDocumentScope, documentScopeKey } from '../model-documents';
import { documentHref } from '../documents/inline-links';
import { hashAndStore, loadBlob } from '../cas-storage';
import { storeResource } from './resources';
import type { WorkspaceResolution } from './branch';
import { updateWorkspaceNode } from './branch-state';
import { lineChanges } from './line-changes';

export interface WorkspaceConflict {
  nodeId: string; branchId: string; changeIndex: number; segmentIndex: number; targetSegment: number;
  base: DocumentLink | null; current: DocumentLink | null; candidate: DocumentLink;
  baseText: string; currentText: string; candidateText: string; currentIsPending: boolean;
}
function owner(store: StoreApi<GameStore>, nodeId: string) {
  const live = store.getState(), node = live.allNodes[nodeId], branch = node?.workspaceBranch, scope = currentDocumentScope(live);
  if (!branch || live.currentNode?.id !== nodeId || !scope || documentScopeKey(scope) !== documentScopeKey(branch.scope)) throw new Error('播放节点已变化，请返回当前节点处理文件');
  return { live, node, branch };
}
/** Simulate the same ordered CAS batch as playback; a later edit may conflict with a manual candidate. */
export async function inspectWorkspaceConflicts(store: StoreApi<GameStore>, nodeId: string, targetSegment: number): Promise<WorkspaceConflict[]> {
  const { live, branch } = owner(store, nodeId), docs = await loadDocumentRecords(branch.scope);
  const initial = new Map(live.documentHeads.map(ref => [ref.documentId, ref.revision]));
  for (const doc of docs) if (!initial.has(doc.id) && !doc.staged) initial.set(doc.id, doc.baseRevision ?? doc.currentRevision);
  const revisions = new Map(initial), result: WorkspaceConflict[] = [], seen = new Set<string>();
  for (const [changeIndex, change] of branch.documents.entries()) {
    if (change.segmentIndex <= branch.mergedThrough || change.segmentIndex > targetSegment) continue;
    const actual = revisions.get(change.link.documentId) ?? null;
    if (actual !== change.beforeRevision && actual !== change.link.revision && !seen.has(change.link.documentId)) {
      const ref = (revision: string) => ({ documentId: change.link.documentId, revision });
      const [base, current, candidate] = await Promise.all([change.beforeRevision ? readDocument(branch.scope, ref(change.beforeRevision)) : null,
        actual ? readDocument(branch.scope, ref(actual)) : null, readDocument(branch.scope, change.link)]);
      result.push({ nodeId, branchId: branch.id, changeIndex, segmentIndex: change.segmentIndex, targetSegment,
        base: base ? { ...ref(change.beforeRevision!), title: base.record.title } : null,
        current: current ? { ...ref(actual!), title: current.record.title } : null, candidate: change.link,
        baseText: base?.resource.text ?? '', currentText: current?.resource.text ?? '', candidateText: candidate.resource.text ?? '',
        currentIsPending: actual !== (initial.get(change.link.documentId) ?? null) });
      seen.add(change.link.documentId);
    }
    revisions.set(change.link.documentId, change.link.revision);
  }
  if (owner(store, nodeId).branch !== branch || store.getState().documentHeads !== live.documentHeads) throw new Error('比较期间文件已变化，请重新载入');
  return result;
}
function sameConflict(left: WorkspaceConflict, right: WorkspaceConflict) {
  return left.branchId === right.branchId && left.changeIndex === right.changeIndex && left.candidate.revision === right.candidate.revision
    && left.base?.revision === right.base?.revision && left.current?.revision === right.current?.revision;
}
function replaceReference(text: string, before: DocumentLink, after: DocumentLink) {
  return text.split(documentHref(before)).join(documentHref(after));
}
/** Adjust the pending branch only. The unchanged playback gate still owns publication and permissions. */
export async function resolveWorkspaceConflict(store: StoreApi<GameStore>, conflict: WorkspaceConflict, choice: { kind: 'candidate' } | { kind: 'manual'; title: string; text: string }): Promise<void> {
  const fresh = (await inspectWorkspaceConflicts(store, conflict.nodeId, conflict.targetSegment)).find(item => item.changeIndex === conflict.changeIndex);
  if (!fresh || !sameConflict(fresh, conflict)) throw new Error('文件或候选版本已变化，请重新比较后处理');
  const { live, node, branch } = owner(store, conflict.nodeId), change = branch.documents[conflict.changeIndex];
  let link = change.link, resource = change.resource;
  if (choice.kind === 'manual') {
    if (!conflict.current || !choice.title.trim() || choice.title.length > 240 || /[/\\\x00-\x1f]/.test(choice.title) || !choice.text.trim()) throw new Error('合并结果需要有效名称和非空正文');
    resource = await storeResource({ name: 'merged-document', revisionName: choice.title.trim(), mimeType: resource.mimeType, text: choice.text });
    link = await stageDocumentRevision(branch.scope, conflict.current, resource);
  }
  const segments = await loadBlob(node.segmentHash) as StorySegment[] | null;
  if (!segments) throw new Error('行动原文缺失，无法更新文档引用');
  const updatedSegments = segments.map((segment, index) => index >= change.segmentIndex ? { ...segment, text: replaceReference(segment.text, change.link, link) } : segment);
  const segmentHash = await hashAndStore('segments', updatedSegments);
  const current = owner(store, node.id);
  if (current.branch !== branch || current.live.documentHeads !== live.documentHeads) throw new Error('处理期间文件已变化，请重新比较');
  const resolution: WorkspaceResolution = { id: crypto.randomUUID(), segmentIndex: change.segmentIndex, kind: choice.kind, createdAt: Date.now(), base: conflict.base, current: conflict.current, candidate: conflict.candidate, result: link };
  const changes = lineChanges(conflict.currentText, choice.kind === 'manual' ? choice.text : conflict.candidateText);
  const documents = branch.documents.map((item, index) => index === conflict.changeIndex ? { ...item, beforeRevision: conflict.current?.revision ?? null, link, resource, changes } : item);
  const effects = branch.effects.map(receipt => receipt.afterVersion === change.link.revision && receipt.path?.startsWith(`library/${link.documentId}/`)
    ? { ...receipt, beforeVersion: conflict.current?.revision ?? null, afterVersion: link.revision, version: link.revision, resource, changes } : receipt);
  const updated = { ...current.node, segmentHash, aiResponse: replaceReference(current.node.aiResponse, change.link, link), availableActions: (current.node.availableActions ?? []).map(text => replaceReference(text, change.link, link)),
    workspaceBranch: { ...branch, documents, effects, resolutions: [...branch.resolutions ?? [], resolution] } };
  updateWorkspaceNode(store, updated);
  store.setState({ availableActions: updated.availableActions });
  await store.getState().persistWorldLineData();
}
