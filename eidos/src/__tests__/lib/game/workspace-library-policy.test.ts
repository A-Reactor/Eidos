// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments } from '@/lib/game/documents/repository';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { continueActionTools } from '@/lib/game/action-tool-continuation';

it.each([false, true])('lists unselected library documents independently of Meta, write grant=%s', async writable => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'library' };
  const doc = await saveLocalDocument(scope, { title: '未引用的报告', content: '原始正文', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: 'edit', parentNodeId: null, inputs: [], library: [doc], writableDocuments: writable ? [doc] : [] });
  const path = `library/${doc.documentId}/source.txt`;
  expect(workspacePromptContext(session).mounts).toContainEqual(expect.objectContaining({ path, name: '未引用的报告', writable }));
  expect((await runWorkspaceTool(session, { method: 'files.read', params: { path } })).text).toBe('原始正文');
  const changed = await runWorkspaceTool(session, { method: 'files.patch', params: { path, oldText: '原始', newText: '修改', expectedVersion: doc.revision } });
  expect(changed.status).toBe(writable ? 'staged' : 'denied');
  expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
});

it('rejects a terminal success after an unrecovered denied write, but allows an explicit failed outcome', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'policy' };
  const session = await createWorkspaceSession({ scope, actionId: 'denied', parentNodeId: null, inputs: [] });
  const run = (fileOutcome?: 'failed') => continueActionTools({ response: { workspaceRequest: { method: 'files.write', params: { path: 'library/unknown/source.txt', expectedVersion: null, text: '不能覆盖' } } },
    historySource: { allNodes: {}, currentNode: null }, session, context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true,
    onResponse() {}, invoke: async () => ({ segments: [{ type: 'narration', text: '文件修改成功。' }], fileOutcome }) });
  const exhausted = await run();
  expect(exhausted.fileOutcome).toBe('failed');
  expect(exhausted.segments?.some(s => s.text.includes('文件修改成功'))).toBe(false);
  await expect(run('failed')).resolves.toMatchObject({ fileOutcome: 'failed' });
});
it('keeps accepted pre-branch generated documents visible when old saves have no document heads', async () => {
  const { projectDocuments } = await import('@/lib/game/documents/repository');
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'legacy' };
  await saveLocalDocument(scope, { title: '旧节点报告', content: '旧格式完整正文' });
  const old = { ...(await loadDocuments(scope))[0], origin: 'generated' as const, originActionId: 'old-action', linkedNodeId: 'old-node' };
  expect(projectDocuments([old], [])).toHaveLength(1);
  expect(projectDocuments([{ ...old, branchManaged: true }], [])).toHaveLength(0);
});

it.each([undefined, false, true])('honors sandbox002 per-turn read-only overrides at the tool boundary, grant=%s', async allowWrite => {
  const { useGameStore } = await import('@/store/game-store');
  const { buildRiftCityStartState } = await import('@/lib/test/fixtures');
  const { currentDocumentScope } = await import('@/lib/game/model-documents');
  const { referenceText, actionDocumentReferences } = await import('@/lib/game/documents/composer');
  const { createActionWorkspace } = await import('@/lib/game/workspace/action-session');
  const { createStreamRequestScope } = await import('@/lib/game/stream-lifecycle');
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), sandboxMode: true, sandboxDossierId: '002' });
  const state = useGameStore.getState(), scope = currentDocumentScope(state)!;
  const doc = await saveLocalDocument(scope, { title: '沙箱原件', content: '保留原文', format: 'text' });
  const refs = await actionDocumentReferences(scope, referenceText(doc), [{ ...doc, allowWrite }]);
  const session = await createActionWorkspace(state, refs, createStreamRequestScope(state), () => true);
  const result = await runWorkspaceTool(session!, { method: 'files.patch', params: { path: `library/${doc.documentId}/source.txt`, oldText: '保留', newText: '修改', expectedVersion: doc.revision } });
  expect(result.status).toBe(allowWrite === false ? 'denied' : 'staged');
  expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
});

it('prioritizes the writable library entry when a selected document also has a pinned input alias', async()=>{
 const scope={worldId:crypto.randomUUID(),playthroughId:'aliases'};
 const doc=await saveLocalDocument(scope,{title:'已选原稿',content:'原文',format:'text'});
 const session=await createWorkspaceSession({scope,actionId:'alias',parentNodeId:null,inputs:[doc],library:[doc],writableDocuments:[doc]});
 expect(workspacePromptContext(session).mounts[0]).toMatchObject({path:`library/${doc.documentId}/source.txt`,selected:true,writable:true});
 const failed=await runWorkspaceTool(session,{method:'files.patch',params:{path:`inputs/${doc.documentId}/${doc.revision}/source.txt`,expectedVersion:doc.revision,oldText:'原文',newText:'新文'}});
 expect(failed.status).toBe('denied');
 expect(failed.error).toContain(`library/${doc.documentId}/source.txt`);
});
