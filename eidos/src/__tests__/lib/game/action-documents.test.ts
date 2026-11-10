// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { parseActionDocuments } from '@/lib/ai/document-response';
import { prepareActionArtifacts, finalizeActionArtifacts, resolveDocumentItems } from '@/lib/game/documents/action-artifacts';
import { loadDocuments, readDocument, reconcileAcceptedDocuments } from '@/lib/game/documents/repository';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { snapshotForModel } from '@/lib/game/plugins/model-manifest';
import type { WorldLineNode } from '@/lib/game/types';

const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: 'artifacts' });
it('strictly parses document keys, full text and resource refs without ambiguous content', () => {
  const content = '{"segments":[{"text":"这是文档示例"}]}\n末尾';
  expect(parseActionDocuments([{ key: 'report', title: 'JSON', format: 'text', content }])[0]).toMatchObject({ content });
  for (const docs of [[{ key: 'a', title: 'x', format: 'text', content: '' }], [{ key: 'a', title: 'x', format: 'text', content: 'a', artifactRef: { path: 'drafts/a/x', version: 'x' } }],
    [{ key: 'a', title: 'x', format: 'text', content: 'a' }, { key: 'a', title: 'y', format: 'text', content: 'b' }]]) expect(() => parseActionDocuments(docs)).toThrow();
});
it('publishes full inline and staged documents idempotently, then links the accepted node', async () => {
  const s = scope(), session = await createWorkspaceSession({ scope: s, actionId: 'one', parentNodeId: 'parent', inputs: [] });
  const draft = await runWorkspaceTool(session, { method: 'files.write', params: { path: 'drafts/one/export.csv', text: '名称,值\n结尾,42\n', expectedVersion: null } });
  const args = { scope: s, actionId: 'one', session, inputs: [], documents: [
    { key: 'json', title: 'JSON 原文', format: 'text' as const, content: '{"k":"末尾"}' },
    { key: 'csv', title: 'CSV', format: 'text' as const, artifactRef: { path: draft.path!, version: draft.afterVersion! } }], effectIds: [] };
  const prepared = await prepareActionArtifacts(args), retried = await prepareActionArtifacts(args);
  expect(prepared.outputDocuments).toEqual(retried.outputDocuments);
  expect(await loadDocuments(s)).toHaveLength(0);
  expect((await readDocument(s, prepared.outputDocuments[1])).resource.text).toBe('名称,值\n结尾,42\n');
  expect(Object.keys(prepared.workspaceState)).toHaveLength(2);
  await finalizeActionArtifacts(prepared, { id: 'accepted', actionId: 'one' } as WorldLineNode);
  expect(await loadDocuments(s)).toHaveLength(2);
  expect((await loadDocuments(s)).every(d => d.linkedNodeId === 'accepted')).toBe(true);
  expect(resolveDocumentItems([{ name: '信件', description: '一封信', documentKey: 'json' }], prepared)[0]).toMatchObject({ description: '一封信', documentRef: { documentId: prepared.outputDocuments[0].documentId, revision: prepared.outputDocuments[0].revision } });
  expect(() => resolveDocumentItems([{ documentKey: 'unknown' }], prepared)).toThrow();
});
it('rejects unowned drafts, stale versions, unverified citations and unaccepted effects before publishing', async () => {
  const s = scope(), session = await createWorkspaceSession({ scope: s, actionId: 'own', parentNodeId: null, inputs: [] });
  for (const artifactRef of [{ path: 'drafts/other/stolen.txt', version: 'material_0000000000000000' }, { path: 'drafts/own/missing.txt', version: 'material_0000000000000000' }]) {
    await expect(prepareActionArtifacts({ scope: s, actionId: 'own', session, inputs: [], documents: [{ key: 'x', title: 'x', format: 'text', artifactRef }], effectIds: [] })).rejects.toThrow();
  }
  await expect(prepareActionArtifacts({ scope: s, actionId: 'own', session, inputs: [], documents: [], effectIds: ['fake'] })).rejects.toThrow();
  await expect(prepareActionArtifacts({ scope: s, actionId: 'own', session, inputs: [], documents: [{ key: 'x', title: 'x', format: 'text', content: 'body', sourceRefs: [{ documentId: 'fake', revision: 'fake', blockId: 'fake', start: 0, end: 1 }] }], effectIds: [] })).rejects.toThrow();
  expect(await loadDocuments(s)).toEqual([]);
});
it('excludes workspace mappings from the model snapshot', () => {
  expect(snapshotForModel({ worldId: 'x', workspaceState: { 'outputs/secret': { id: 'secret' } } })).toEqual({ worldId: 'x' });
});

it('recovers staged outputs from exact accepted action links after interrupted node association', async () => {
  const s = scope(), session = await createWorkspaceSession({ scope: s, actionId: 'recover', parentNodeId: null, inputs: [] });
  const prepared = await prepareActionArtifacts({ scope: s, actionId: 'recover', session, inputs: [], documents: [{ key: 'report', title: '待提交报告', format: 'text', content: '完整正文' }] });
  expect(await loadDocuments(s)).toEqual([]);
  const link = prepared.outputDocuments[0];
  await reconcileAcceptedDocuments(s, [{ id: 'wrong', outputDocuments: [link] }, { id: 'recover', outputDocuments: [{ ...link, revision: 'wrong-version' }] }]);
  expect(await loadDocuments(s)).toEqual([]);
  await reconcileAcceptedDocuments(s, { nodes: [{ id: 'node', actionId: 'recover', outputDocuments: [link] }] });
  expect(await loadDocuments(s)).toHaveLength(1);
  expect((await loadDocuments(s))[0].linkedNodeId).toBe('node');
});

it('treats an explicit null document placeholder as no artifacts and still rejects non-list data',()=>{
 expect(parseActionDocuments(null)).toEqual([]);
 expect(()=>parseActionDocuments({key:'bad'})).toThrow('列表');
});
