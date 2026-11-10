import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { continueActionTools, type ActionToolResponse, type ActionToolContext } from '@/lib/game/action-tool-continuation';
import { createWorkspaceSession, runWorkspaceTool } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { readResource } from '@/lib/game/workspace/resources';

const source = { allNodes: {}, currentNode: null };
async function sessionForTest() { return createWorkspaceSession({ scope: { worldId: crypto.randomUUID(), playthroughId: 'recovery' }, actionId: 'test', parentNodeId: null, inputs: [] }); }

it('returns a malformed complete tool request to the model, then executes its corrected request', async () => {
  const session = await sessionForTest(), contexts: ActionToolContext[] = [];
  const final = await continueActionTools({ response: { workspaceRequest: { method: 'files.write', params: { path: 'drafts/test/a.txt', text: '完整正文' } } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      contexts.push(structuredClone(context));
      if (contexts.length === 1) return { workspaceRequest: { method: 'files.write', params: { path: 'drafts/test/a.txt', text: '完整正文', expectedVersion: null } } };
      return { segments: [{ type: 'narration', text: '她把草稿留在工作台。' }] };
    } });
  expect(actionEvidence(contexts[0])).toContain('expectedVersion');
  expect(session.receipts.map(receipt => receipt.status)).toEqual(['failed', 'staged']);
  expect((await readResource(session.files['drafts/test/a.txt'])).text).toBe('完整正文');
  expect(final.segments?.[0].text).toBe('她把草稿留在工作台。');
});

it('preserves ordinary prose when a real denied write is honestly reported as unfinished', async () => {
  const session = await sessionForTest();
  const final = await continueActionTools({ response: { segments: [{ type: 'narration', text: '她走到书桌前。' }], workspaceRequest: { method: 'files.write', params: { path: 'library/private/source.txt', text: '无权写入', expectedVersion: null } } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      expect(context.workspaceContext.results.at(-1)?.status).toBe('denied');
      return { fileOutcome: 'failed', segments: [{ type: 'narration', text: '资料没有改动，她需要先获得授权。' }] };
    } });
  expect(final.segments?.map(segment => segment.text)).toEqual(['她走到书桌前。', '资料没有改动，她需要先获得授权。']);
  expect(final.fileOutcome).toBe('failed');
  expect(session.files['library/private/source.txt']).toBeUndefined();
});

it('asks for a corrected final report instead of discarding prose after a false success', async () => {
  const session = await sessionForTest(); let calls = 0;
  const final = await continueActionTools({ response: { segments: [{ type: 'narration', text: '她打开目录。' }], workspaceRequest: { method: 'files.patch', params: { path: 'library/private/source.txt', expectedVersion: 'material_0000000000000000', oldText: '旧', newText: '新' } } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      calls++;
      if (calls === 1) return { segments: [{ type: 'narration', text: '伪造的完成声明。' }] };
      expect(actionEvidence(context)).toContain('不能接受成功叙述');
      return { fileOutcome: 'failed', segments: [{ type: 'narration', text: '修改未完成。' }] };
    } });
  expect(calls).toBe(2);
  expect(final.segments?.map(segment => segment.text)).toEqual(['她打开目录。', '修改未完成。']);
});

it('handles new structured history tools through the same narrative continuation', async () => {
  const session = await sessionForTest();
  const final = await continueActionTools({ response: { toolRequest: { method: 'history.read', params: { query: '' } }, segments: [{ type: 'narration', text: '她回想起往事。' }] } as ActionToolResponse, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      expect(actionEvidence(context)).toContain('history.read');
      return { segments: [{ type: 'narration', text: '目前没有可查的旧记录。' }] };
    } });
  expect(final.segments).toHaveLength(2);
  expect((final as Record<string, unknown>).toolRequest).toBeUndefined();
});

it('ends repeated failures within a finite budget with an honest node candidate', async () => {
  const session = await sessionForTest(); let calls = 0;
  const final = await continueActionTools({ response: { segments: [{ type: 'narration', text: '她开始检查。' }], workspaceRequest: { method: 'files.list', params: {} } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async () => { calls++; return { workspaceRequest: { method: 'files.list', params: {} } }; } });
  expect(calls).toBe(2);
  expect(final.fileOutcome).toBe('failed');
  expect(final.segments?.[0].text).toBe('她开始检查。');
  expect(final.workspaceEffects ?? []).toEqual([]);
});

it('does not allow a malformed write to become a false final success without a real write receipt', async () => {
  const session = await sessionForTest(); let calls = 0;
  const final = await continueActionTools({ response: { workspaceRequest: { method: 'files.write', params: { path: 'drafts/test/b.txt', text: '不会写入' } } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      calls++;
      if (calls === 1) return { segments: [{ type: 'narration', text: '伪造的写入成功。' }] };
      expect(actionEvidence(context)).toContain('未执行');
      return { fileOutcome: 'failed', segments: [{ type: 'narration', text: '写入未完成。' }] };
    } });
  expect(calls).toBe(2); expect(final.segments?.[0].text).toBe('写入未完成。');
  expect(session.files['drafts/test/b.txt']).toBeUndefined();
});

it('lets the model read the actual version and repair a failed patch in the same action', async () => {
  const session = await sessionForTest(), path = 'drafts/test/current.txt';
  await runWorkspaceTool(session, { method: 'files.write', params: { path, expectedVersion: null, text: '旧记录\n保留第二行' } });
  let calls = 0;
  const final = await continueActionTools({ response: { workspaceRequest: { method: 'files.patch', params: { path, expectedVersion: 'material_0000000000000000', oldText: '旧记录', newText: '新记录' } } }, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      calls++; const last = context.workspaceContext.results.at(-1)!;
      if (calls === 1) { expect(last.status).toBe('failed'); return { toolRequest: { method: 'files.read', params: { path } } }; }
      if (calls === 2) { expect(last.text).toBe('旧记录\n保留第二行'); return { toolRequest: { method: 'files.patch', params: { path, expectedVersion: last.version, oldText: '旧记录', newText: '新记录' } } }; }
      expect(last.status).toBe('staged'); return { segments: [{ type: 'narration', text: '草稿已修正，第二行得以保留。' }] };
    } });
  expect(calls).toBe(3); expect(final.fileOutcome).toBeUndefined();
  expect((await readResource(session.files[path])).text).toBe('新记录\n保留第二行');
});

it('returns a successful but unselected library write to the model instead of silently losing it', async () => {
 const {saveLocalDocument}=await import('@/lib/game/documents/ingest');
 const scope={worldId:crypto.randomUUID(),playthroughId:'selection'};
 const doc=await saveLocalDocument(scope,{title:'报告',content:'旧正文',format:'text'});
 const session=await createWorkspaceSession({scope,actionId:'selected',parentNodeId:null,inputs:[],library:[doc],writableDocuments:[doc]});
 const path=`library/${doc.documentId}/source.txt`;let calls=0;
 const final=await continueActionTools({response:{toolRequest:{method:'files.write',params:{path,expectedVersion:doc.revision,text:'新正文'}}},session,historySource:source,
  context:{longMemoryContext:'',workspaceContext:workspacePromptContext(session)},isCurrent:()=>true,onResponse(){},
  invoke:async context=>{calls++;if(calls===1)return {segments:[{type:'narration',text:'报告修改成功。'}]};
   expect(actionEvidence(context)).toContain('未选择');
   return {segments:[{type:'narration',text:'报告修改完成。',workspaceEffects:[context.workspaceContext.results[0].operationId!]}]};}
 });
 expect(calls).toBe(2);
 expect(final.segments?.[0].workspaceEffects).toHaveLength(1);
});
