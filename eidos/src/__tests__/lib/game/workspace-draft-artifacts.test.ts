// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { prepareActionArtifacts, validateActionArtifactCandidate } from '@/lib/game/documents/action-artifacts';
import { loadDocuments } from '@/lib/game/documents/repository';

async function draft() {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'draft-test' };
  const session = await createWorkspaceSession({ scope, actionId: 'write-report', parentNodeId: 'parent', inputs: [] });
  const path = `${session.draftRoot}/report.txt`;
  const receipt = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: null, text: '报告完整正文' } });
  return { scope, session, path, receipt };
}

it('publishes an ordinary draft with its real receipt without requiring a Meta role channel', async () => {
  const { scope, session, path, receipt } = await draft();
  const prepared = await prepareActionArtifacts({ scope, session, actionId: session.actionId, inputs: [],
    segments: [{ type: 'narration', text: '她走到书桌前。' }, { type: 'narration', text: '她写好报告。', workspaceEffects: [receipt.operationId!] }, { type: 'narration', text: '她转过身。' }],
    documents: [{ key: 'report', title: '报告', format: 'text', artifactRef: { path, version: receipt.afterVersion } }],
  });
  expect(prepared.outputDocuments).toHaveLength(1);
  expect(prepared.branch?.documents[0].segmentIndex).toBe(1);
  expect(prepared.branch?.effects[0]).toMatchObject({ actor: { kind: 'assistant' }, path, status: 'staged', segmentIndex: 1 });
  expect(prepared.metaEffects?.receipts).toEqual([]);
  expect(await loadDocuments(scope)).toEqual([]);
});

it('does not report an unpublished selected draft as a completed output', async () => {
  const { scope, session, receipt } = await draft();
  await expect(prepareActionArtifacts({ scope, session, actionId: session.actionId, inputs: [], effectIds: [receipt.operationId!], segments: [{ type: 'narration', text: '报告已完成。' }] })).rejects.toThrow(/草稿.*输出文档/);
  expect(await loadDocuments(scope)).toEqual([]);
});

it('rejects a draft receipt for an obsolete version before storing document metadata', async () => {
  const { scope, session, path, receipt } = await draft();
  await runWorkspaceTool(session, { method: 'files.patch', params: { path, expectedVersion: receipt.afterVersion, oldText: '完整', newText: '最新' } });
  await expect(prepareActionArtifacts({ scope, session, actionId: session.actionId, inputs: [], effectIds: [receipt.operationId!],
    segments: [{ type: 'narration', text: '写好报告。' }], documents: [{ key: 'report', title: '报告', format: 'text', artifactRef: { path, version: receipt.afterVersion } }],
  })).rejects.toThrow(/版本/);
  expect(await loadDocuments(scope)).toEqual([]);
});

it.each(['', '  \n'])('returns an empty draft to the correction loop before document storage, text=%j', async text => {
  const { scope, session, path, receipt } = await draft();
  const empty = await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: receipt.afterVersion, text } });
  expect(() => validateActionArtifactCandidate({ scope, session, actionId: session.actionId, inputs: [], segments: [{ type: 'narration', text: '文件仍需补完。' }],
    documents: [{ key: 'empty', title: '空稿', format: 'text', artifactRef: { path, version: empty.afterVersion } }] })).toThrow('正文为空');
  expect(await loadDocuments(scope)).toEqual([]);
});
