// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { prepareActionArtifacts } from '@/lib/game/documents/action-artifacts';
import { mergeWorkspaceBranchAt } from '@/lib/game/workspace/branch';
import { inspectWorkspaceConflicts, resolveWorkspaceConflict } from '@/lib/game/workspace/conflicts';
import { collectDocumentBundle, restoreDocumentBundle, remapDocumentReferences } from '@/lib/game/documents/transfer';
import { documentHref } from '@/lib/game/documents/inline-links';
import { loadBlob } from '@/lib/game/cas-storage';
import { lineDiff } from '@/lib/game/documents/line-diff';

async function conflictFixture() {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID() });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, world.id);
  const scope = currentDocumentScope(useGameStore.getState())!;
  const old = await saveLocalDocument(scope, { title: '报告.txt', content: '共同正文\n原始签名', format: 'text' });
  const second = await saveLocalDocument(scope, { title: '清单.txt', content: '旧清单', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: crypto.randomUUID(), parentNodeId: useGameStore.getState().currentNode!.id, inputs: [], library: [old, second], writableDocuments: [old, second] });
  const a = await runWorkspaceTool(session, { method: 'files.write', params: { path: `library/${old.documentId}/source.txt`, text: '共同正文\n模型签名', expectedVersion: old.revision } });
  const b = await runWorkspaceTool(session, { method: 'files.write', params: { path: `library/${second.documentId}/source.txt`, text: '新清单', expectedVersion: second.revision } });
  const segments = [{ type: 'narration' as const, text: '打开书桌。' }, { type: 'narration' as const, text: '核对[报告](document:' + old.documentId + ')。', workspaceEffects: [a.operationId!, b.operationId!] }];
  const prepared = await prepareActionArtifacts({ scope, actionId: session.actionId, session, inputs: [], segments });
  const linked = { ...old, revision: a.afterVersion! };
  segments[1].text = `核对[报告](${documentHref(linked)})。`;
  const node = await useGameStore.getState().addActionNode({ id: session.actionId, summary: '核对资料', worldImpacts: [], availableActions: [segments[1].text], sceneId: state.currentSceneId, sceneName: '', timestamp: Date.now(), playerInput: '核对报告', aiResponse: segments[1].text, gameTime: state.gameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceBranch: prepared.branch } as never, useGameStore.getState().createSnapshot(), segments);
  await mergeWorkspaceBranchAt(useGameStore, node.id, 0);
  const concurrent = await saveLocalDocument(scope, { title: '玩家报告.txt', content: '共同正文\n玩家签名', previous: old, format: 'text' });
  await expect(mergeWorkspaceBranchAt(useGameStore, node.id, 1)).rejects.toThrow('冲突');
  return { scope, old, second, concurrent, node, a };
}

it('records failed merges without partial publication, merges manual text locally, and preserves all versions in recovery', async () => {
  const f = await conflictFixture(), beforeCount = Object.keys(useGameStore.getState().allNodes).length;
  expect((await loadDocuments(f.scope)).find(doc => doc.id === f.second.documentId)?.currentRevision).toBe(f.second.revision);
  expect(useGameStore.getState().currentNode?.workspaceBranch?.mergeFailure).toMatchObject({ segmentIndex: 1, phase: 'merge' });
  const [conflict] = await inspectWorkspaceConflicts(useGameStore, f.node.id, 1);
  expect(conflict).toMatchObject({ baseText: '共同正文\n原始签名', currentText: '共同正文\n玩家签名', candidateText: '共同正文\n模型签名' });
  await resolveWorkspaceConflict(useGameStore, conflict, { kind: 'manual', title: '合并报告.txt', text: '共同正文\n玩家签名与模型签名' });
  expect((await loadDocuments(f.scope)).find(doc => doc.id === f.old.documentId)?.currentRevision).toBe(f.concurrent.revision);
  await mergeWorkspaceBranchAt(useGameStore, f.node.id, 1);
  const updated = useGameStore.getState().currentNode!, resolution = updated.workspaceBranch!.resolutions![0];
  expect(updated.workspaceBranch?.mergeFailure).toBeUndefined();
  expect((await readDocument(f.scope, resolution.result)).resource.text).toBe('共同正文\n玩家签名与模型签名');
  expect((await readDocument(f.scope, resolution.current!)).resource.text).toContain('玩家签名');
  expect((await readDocument(f.scope, resolution.candidate)).resource.text).toBe('共同正文\n模型签名');
  expect(JSON.stringify(await loadBlob(updated.segmentHash))).toContain(documentHref(resolution.result));
  expect(Object.keys(useGameStore.getState().allNodes)).toHaveLength(beforeCount);
  const bundle = await collectDocumentBundle({ scopes: [f.scope], nodes: updated }), destination = { ...f.scope, playthroughId: crypto.randomUUID() };
  const mapping = await restoreDocumentBundle(bundle, new Map([[documentScopeKey(f.scope), destination]]));
  const restored = remapDocumentReferences(updated, f.scope, mapping, destination);
  expect((await readDocument(destination, restored.workspaceBranch!.resolutions![0].result)).resource.text).toContain('玩家签名与模型签名');
});

it('rejects stale comparison and switched node requests, and lets an explicit candidate choice retry once', async () => {
  const f = await conflictFixture();
  const [old] = await inspectWorkspaceConflicts(useGameStore, f.node.id, 1);
  const latest = await saveLocalDocument(f.scope, { title: '更新的报告', content: '再次并发编辑', previous: f.concurrent });
  await expect(resolveWorkspaceConflict(useGameStore, old, { kind: 'candidate' })).rejects.toThrow('变化');
  expect((await loadDocuments(f.scope)).find(doc => doc.id === latest.documentId)?.currentRevision).toBe(latest.revision);
  const [fresh] = await inspectWorkspaceConflicts(useGameStore, f.node.id, 1);
  const saved = useGameStore.getState().currentNode;
  useGameStore.setState({ currentNode: null });
  await expect(resolveWorkspaceConflict(useGameStore, fresh, { kind: 'candidate' })).rejects.toThrow('节点已变化');
  useGameStore.setState({ currentNode: saved });
  await resolveWorkspaceConflict(useGameStore, fresh, { kind: 'candidate' });
  await mergeWorkspaceBranchAt(useGameStore, f.node.id, 1);
  expect((await loadDocuments(f.scope)).find(doc => doc.id === latest.documentId)?.currentRevision).toBe(f.a.afterVersion);
  await mergeWorkspaceBranchAt(useGameStore, f.node.id, 1);
  expect(useGameStore.getState().currentNode?.workspaceBranch?.resolutions).toHaveLength(1);
});

it('keeps committed status when only durable node storage fails and clears it on a local retry', async () => {
  const f = await conflictFixture();
  const [conflict] = await inspectWorkspaceConflicts(useGameStore, f.node.id, 1);
  await resolveWorkspaceConflict(useGameStore, conflict, { kind: 'candidate' });
  const original = useGameStore.getState().persistWorldLineData;
  useGameStore.setState({ persistWorldLineData: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockImplementation(original) });
  await expect(mergeWorkspaceBranchAt(useGameStore, f.node.id, 1)).rejects.toThrow('disk full');
  expect(useGameStore.getState().currentNode?.workspaceBranch?.mergeFailure?.phase).toBe('save');
  expect(useGameStore.getState().currentNode?.workspaceEffects?.every(receipt => receipt.status === 'committed')).toBe(true);
  await mergeWorkspaceBranchAt(useGameStore, f.node.id, 1);
  expect(useGameStore.getState().currentNode?.workspaceBranch?.mergeFailure).toBeUndefined();
  useGameStore.setState({ persistWorldLineData: original });
});

it('bounds very large text differences and distinguishes matching content', () => {
  expect(lineDiff('相同', '相同').identical).toBe(true);
  const diff = lineDiff('行\n'.repeat(10000), '新\n'.repeat(10000));
  expect(diff.rows.length).toBeLessThanOrEqual(166); expect(diff.omitted).toBeGreaterThan(19000);
});

it('stops a later paragraph from silently replacing a manual merge based on an older candidate', async () => {
  const f = await conflictFixture();
  const { storeResource } = await import('@/lib/game/workspace/resources');
  const { stageDocumentRevision } = await import('@/lib/game/documents/repository');
  const resource = await storeResource({ name: 'later.txt', mimeType: 'text/plain', text: '模型后续整份改稿' });
  const link = await stageDocumentRevision(f.scope, { documentId: f.old.documentId, revision: f.a.afterVersion! }, resource);
  const node = useGameStore.getState().currentNode!, branch = node.workspaceBranch!;
  const updated = { ...node, workspaceBranch: { ...branch, documents: [...branch.documents, { link, resource, beforeRevision: f.a.afterVersion!, segmentIndex: 2 }] } };
  useGameStore.setState({ currentNode: updated, allNodes: { ...useGameStore.getState().allNodes, [node.id]: updated } });
  const [conflict] = await inspectWorkspaceConflicts(useGameStore, node.id, 1);
  await resolveWorkspaceConflict(useGameStore, conflict, { kind: 'manual', title: '人工合并', text: '必须保留的人工内容' });
  await mergeWorkspaceBranchAt(useGameStore, node.id, 1);
  await expect(mergeWorkspaceBranchAt(useGameStore, node.id, 2)).rejects.toThrow('冲突');
  const [later] = await inspectWorkspaceConflicts(useGameStore, node.id, 2);
  expect(later.currentText).toBe('必须保留的人工内容'); expect(later.candidateText).toBe('模型后续整份改稿');
  expect((await loadDocuments(f.scope)).find(doc => doc.id === f.old.documentId)?.currentRevision).toBe(later.current?.revision);
});
