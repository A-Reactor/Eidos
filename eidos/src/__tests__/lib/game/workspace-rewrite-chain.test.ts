// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { mergeBranchDocuments, readDocument } from '@/lib/game/documents/repository';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { prepareActionArtifacts, validateActionArtifactCandidate } from '@/lib/game/documents/action-artifacts';

it.each([false, true])('publishes the final rewrite with skipped intermediate edits, first selected=%s', async selectFirst => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'rewrite' };
  const doc = await saveLocalDocument(scope, { title: '调查笔记', content: '第一行\n第二行\n第三行', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: 'rewrite', parentNodeId: null, inputs: [doc], library: [doc], writableDocuments: [doc] });
  const path = `library/${doc.documentId}/source.txt`;
  const first = await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: doc.revision, oldText: '第一行', newText: '一' } });
  const middle = await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: first.afterVersion, oldText: '第二行', newText: '二' } });
  const last = await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: middle.afterVersion, oldText: '第三行', newText: '三' } });
  expect(last.status).toBe('staged');
  const segments = [...(selectFirst ? [{ type: 'narration' as const, text: '先改第一行。', workspaceEffects: [first.operationId!] }] : []),
    { type: 'narration' as const, text: '修改完成。', workspaceEffects: [last.operationId!] }];
  const input = { scope, actionId: session.actionId, session, inputs: [doc], segments };
  validateActionArtifactCandidate(input);
  const prepared = await prepareActionArtifacts(input);
  let heads = [{ documentId: doc.documentId, revision: doc.revision }];
  for (let index = 0; index < segments.length; index++) heads = await mergeBranchDocuments(scope, prepared.branch!.documents.filter(change => change.segmentIndex === index), heads);
  expect((await readDocument(scope, heads[0])).resource.text).toBe('一\n二\n三');
  expect((await readDocument(scope, doc)).resource.text).toBe('第一行\n第二行\n第三行');
  expect(prepared.branch!.documents.at(-1)?.beforeRevision).toBe(selectFirst ? first.afterVersion : doc.revision);
  expect(prepared.branch!.documents.at(-1)?.changes).toEqual(selectFirst ? { added: 2, removed: 2 } : { added: 3, removed: 3 });
});
