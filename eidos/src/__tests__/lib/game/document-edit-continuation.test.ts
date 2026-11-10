// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { validateWorkspaceContext } from '@/lib/ai/workspace-tools';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { prepareActionArtifacts } from '@/lib/game/documents/action-artifacts';
import { mergeBranchDocuments, readDocument } from '@/lib/game/documents/repository';
import { continueActionTools } from '@/lib/game/action-tool-continuation';
import type { ActionOperationReceipt } from '@/lib/game/action-operations';
import type { WorkspaceToolResult } from '@/lib/game/workspace/types';
import { ACTION_TOOL_LIMITS } from '@/lib/game/action-tool-budget';
import { prepareMetaWorkspaceEffects } from '@/lib/meta-reality/workspace-bridge';

async function setup() {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'continuation' };
  const doc = await saveLocalDocument(scope, { title: '对各种大米的看法', content: '# 米\n原稿', format: 'markdown' });
  const session = await createWorkspaceSession({ scope, actionId: crypto.randomUUID(), parentNodeId: null, inputs: [], library: [doc], writableDocuments: [doc] });
  return { scope, doc, session, path: `library/${doc.documentId}/source.md` };
}

it('keeps the latest pending edit visible after reads evict its detailed receipt, then publishes it once', async () => {
  const f = await setup();
  const first = await runWorkspaceTool(f.session, { method: 'files.patch', params: { path: f.path, expectedVersion: f.doc.revision, oldText: '原稿', newText: '原稿\n粥宜用圆粒粳米。' } });
  const last = await runWorkspaceTool(f.session, { method: 'files.patch', params: { path: f.path, expectedVersion: first.afterVersion, oldText: '圆粒粳米', newText: '短圆的东北粳米' } });
  for (let i = 0; i < 10; i++) await runWorkspaceTool(f.session, { method: 'files.read', params: { path: f.path, offset: 0 } });
  const context = validateWorkspaceContext(JSON.parse(JSON.stringify(workspacePromptContext(f.session))))!;
  expect(context.results.every(result => result.method === 'files.read')).toBe(true);
  expect(context.pendingWrites).toEqual([{ path: f.path, name: '对各种大米的看法', version: last.afterVersion, kind: 'library', operationIds: [last.operationId] }]);
  expect(JSON.stringify(context.pendingWrites)).not.toContain('粥宜用');
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: f.session.actionId, session: f.session, inputs: [],
    segments: [{ type: 'narration', text: '附言写好了。', workspaceEffects: context.pendingWrites![0].operationIds }] });
  await mergeBranchDocuments(f.scope, prepared.branch!.documents, [f.doc]);
  const latest = { ...f.doc, revision: last.afterVersion! };
  expect((await readDocument(f.scope, latest)).resource.text).toBe('# 米\n原稿\n粥宜用短圆的东北粳米。');
  expect((await readDocument(f.scope, f.doc)).resource.text).toBe('# 米\n原稿');
});

it('accepts the write allowance through finalization instead of rejecting the ninth successful effect', async () => {
  const f = await setup(), writes: WorkspaceToolResult[] = [];
  for (let i = 1; i <= ACTION_TOOL_LIMITS.write; i++) {
    const result = await runWorkspaceTool(f.session, { method: 'files.write', params: { path: f.path, expectedVersion: f.session.files[f.path].id, text: `已修改 ${i} 次` } });
    expect(result.status).toBe('staged'); writes.push(result);
  }
  const ids = writes.map(result => result.operationId!);
  const prepared = await prepareActionArtifacts({ scope: f.scope, actionId: f.session.actionId, session: f.session, inputs: [],
    segments: [{ type: 'narration', text: '修改妥当。', workspaceEffects: ids }] });
  await mergeBranchDocuments(f.scope, prepared.branch!.documents, [f.doc]);
  expect((await readDocument(f.scope, { ...f.doc, revision: writes.at(-1)!.afterVersion! })).resource.text).toBe('已修改 16 次');
});

it('keeps the complete required chain in pending role-file writes and accepts the shared write allowance', async () => {
  const actor = { kind: 'character' as const, npcId: '铃音', channelId: 'letters' };
  const f = await setup();
  const session = await createWorkspaceSession({ scope: f.scope, actionId: 'role', parentNodeId: null, inputs: [], metaMounts: [{ id: 'desk', files: {} }],
    manifest: { id: 'm', title: '书信', tone: 'mysterious', forbiddenMoves: [], channels: [{ id: 'letters', kind: 'text', promptToPlayer: '', worldInterpretation: '', consequenceTemplate: '', refusalFallback: '', allowedConsumers: ['铃音'], workspaceGrants: [{ mountId: 'desk', pathPrefix: 'letters', npcIds: ['铃音'], operations: ['read', 'write'] }] }] } });
  const path = 'meta/desk/letters/letter.txt', ids: string[] = [];
  for (let i = 1; i <= ACTION_TOOL_LIMITS.write; i++) {
    const result = await runWorkspaceTool(session, { actor, method: 'files.write', params: { path, expectedVersion: session.files[path]?.id ?? null, text: `信件 ${i}` } });
    expect(result.status).toBe('staged'); ids.push(result.operationId!);
  }
  const pending = validateWorkspaceContext(workspacePromptContext(session))!.pendingWrites;
  expect(pending?.[0].operationIds).toEqual(ids);
  const effects = prepareMetaWorkspaceEffects(session, ids);
  expect(effects.files.desk['letters/letter.txt'].id).toBe(session.files[path].id);
});

it('returns the current text length and version on an out-of-range read without changing the file', async () => {
  const f = await setup();
  const result = await runWorkspaceTool(f.session, { method: 'files.read', params: { path: f.path, offset: 999 } });
  expect(result.status).toBe('failed');
  expect(result.error).toContain('6');
  expect(result.error).toContain(f.doc.revision);
  expect(result.error).toContain('offset:0');
  expect(f.session.files[f.path].id).toBe(f.doc.revision);
});

it('exports actual write versions and line changes without copying document bodies into diagnostics', async () => {
  const f = await setup(), operations: ActionOperationReceipt[] = [];
  await continueActionTools({ response: { toolRequest: { method: 'files.patch', params: { path: f.path, expectedVersion: f.doc.revision, oldText: '原稿', newText: '原稿\n新增附言' } } },
    session: f.session, historySource: { allNodes: {}, currentNode: null }, isCurrent: () => true, onResponse() {}, onOperation: receipt => operations.push(receipt),
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(f.session) },
    invoke: async context => ({ segments: [{ type: 'narration', text: '已补上附言。', workspaceEffects: [context.workspaceContext.results.at(-1)!.operationId!] }] }) });
  expect(operations[0].result).toMatchObject({ beforeVersion: f.doc.revision, afterVersion: f.session.files[f.path].id, changes: { added: 1, removed: 0 }, request: { path: f.path, expectedVersion: f.doc.revision } });
  expect(JSON.stringify(operations)).not.toContain('新增附言');
});

it('keeps retrieval memory stable and feeds failures and file evidence through the execution tail', async () => {
 const f=await setup(); const baseMemory='此前检索的真实线索';
 let calls=0;
 const result=await continueActionTools({response:{toolRequest:{method:'files.patch',params:{path:f.path,expectedVersion:f.doc.revision,oldText:'不存在',newText:'新增'}}},
  session:f.session,historySource:{allNodes:{},currentNode:null},isCurrent:()=>true,onResponse(){},context:{longMemoryContext:baseMemory,workspaceContext:workspacePromptContext(f.session)},
  invoke:async context=>{calls++;expect(context.longMemoryContext).toBe(baseMemory);expect(context.workspaceContext.execution?.records.length).toBeGreaterThan(0);
   return {fileOutcome:'failed',segments:[{type:'narration',text:'修改未完成。'}]};}
 });
 expect(calls).toBe(1);expect(result.fileOutcome).toBe('failed');
});
