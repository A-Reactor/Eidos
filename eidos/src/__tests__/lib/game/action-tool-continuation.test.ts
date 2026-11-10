import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { continueActionTools, type ActionToolResponse, type ActionToolContext } from '@/lib/game/action-tool-continuation';
import { createWorkspaceSession } from '@/lib/game/workspace/session';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { ACTION_TOOL_LIMITS } from '@/lib/game/action-tool-budget';
import { workspacePromptContext } from '@/lib/game/workspace/context';

async function setup() {
  return createWorkspaceSession({ scope: { worldId: crypto.randomUUID(), playthroughId: 'tools' }, actionId: 'tools', parentNodeId: 'node', inputs: [] });
}
const historySource = { allNodes: {}, currentNode: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shares context between history and file tools without turning tools into actions', async () => {
  const session = await setup(), contexts: ActionToolContext[] = [], billed: ActionToolResponse[] = [];
  const next: ActionToolResponse[] = [{ historyRequest: { query: '' } }, { segments: [{ type: 'narration', text: '查阅完毕。' }] }];
  const final = await continueActionTools({ response: { workspaceRequest: { method: 'files.list', params: {} } }, historySource, session,
    context: { longMemoryContext: '已有记忆', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true,
    onResponse: response => billed.push(response), invoke: async context => { contexts.push(structuredClone(context)); return next.shift()!; } });
  expect(final.segments?.[0].text).toBe('查阅完毕。');
  expect(contexts).toHaveLength(2);
  expect(actionEvidence(contexts[1])).toContain('history');
  expect(contexts[1].workspaceContext.results).toHaveLength(1);
  expect(billed).toHaveLength(2);
});

it('retains native web evidence when the same action continues into a file tool round', async () => {
  const session = await setup(); let evidence = '';
  const receipt = { method: 'web.search', status: 'completed' as const, result: { provider: 'deepseek', results: [{ title: 'Official', url: 'https://example.com/research', summary: 'A verified finding' }] } };
  const final = await continueActionTools({ response: { workspaceRequest: { method: 'files.list', params: {} }, _webToolReceipts: [receipt] }, historySource, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => { evidence = actionEvidence(context); return { segments: [{ type: 'narration', text: '已按查询结果整理资料。' }] }; } });
  expect(evidence).toContain('https://example.com/research');
  expect(evidence).toContain('A verified finding');
  expect(final._webToolReceipts?.[0].result).toMatchObject({ collapsed: true, summary: 'A verified finding', sources: [{ label: 'Official', url: 'https://example.com/research' }] });
});

it('folds already consumed native web bodies before file/history continuation without waiting for time to pass', async () => {
  const session = await setup(), raw = '网页旧正文' + '长'.repeat(5000), contexts: string[] = [];
  const response: ActionToolResponse = { workspaceRequest: { method: 'files.list', params: {} }, _webToolReceipts: [{ method: 'web.open', status: 'completed',
    result: { title: '网页', url: 'https://example.com/research', text: raw } }] };
  await continueActionTools({ response, historySource, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      contexts.push(actionEvidence(context));
      if (contexts.length === 1) return { historyRequest: { query: '' } };
      return { segments: [{ type: 'narration', text: '整理完毕。' }] };
    } });
  expect(contexts[0]).not.toContain(raw);
  expect(contexts[1]).not.toContain(raw);
  expect(contexts[1]).toContain('https://example.com/research');
  expect(contexts[1]).toContain('"collapsed":true');
});

it('lets the model use a new legacy web result once, then folds it on the next continuation and at node completion', async () => {
  const raw = '旧协议网页正文' + '长'.repeat(5000), contexts: string[] = [];
  const fetcher = vi.fn().mockResolvedValue(Response.json({ method: 'web.open', status: 'completed', result: { title: '网页', url: 'https://example.com/research', text: raw } }));
  vi.stubGlobal('fetch', fetcher);
  const final = await continueActionTools({ response: { toolRequest: { method: 'web.open', params: { url: 'https://example.com/research' } } }, historySource, session: null,
    context: { longMemoryContext: '', workspaceContext: { draftRoot: 'draft', mounts: [], nextOffset: null, results: [] } }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      contexts.push(actionEvidence(context));
      return contexts.length === 1 ? { historyRequest: { query: '' } } : { segments: [{ type: 'narration', text: '已读完资料。' }] };
    } });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(contexts[0]).toContain(raw);
  expect(contexts[1]).not.toContain(raw);
  expect(final._webToolReceipts?.[0].result).toMatchObject({ collapsed: true });
  expect(final.segments?.[0].searchSources).toEqual([{ label: '网页', url: 'https://example.com/research' }]);
});

it('caps tool execution and returns an honest candidate when repeated requests exhaust continuation', async () => {
  const session = await setup(); let calls = 0;
  const capped = await continueActionTools({ response: { historyRequest: { query: 'first' } }, historySource, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async () => { calls++; return calls % 2 ? { workspaceRequest: { method: 'files.list', params: { offset: calls } } }
      : { historyRequest: { query: `history-${calls}` } }; } });
  expect(capped.fileOutcome).toBe('failed');
  expect(calls).toBeLessThanOrEqual(ACTION_TOOL_LIMITS.continuations); expect(session.receipts.filter(receipt => receipt.status === 'committed').length).toBeLessThanOrEqual(ACTION_TOOL_LIMITS.read);
  const another = await setup();
  const repeated = await continueActionTools({ response: { workspaceRequest: { method: 'files.list', params: {} } }, historySource, session: another,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(another) }, isCurrent: () => true, onResponse() {},
    invoke: async () => ({ workspaceRequest: { method: 'files.list', params: {} } }) });
  expect(repeated.fileOutcome).toBe('failed'); expect(another.receipts).toHaveLength(1);
});

it('accounts for a late provider response before refusing to continue a cancelled action', async () => {
  const session = await setup(); let current = true; const billed: ActionToolResponse[] = [];
  await expect(continueActionTools({ response: { workspaceRequest: { method: 'files.list', params: {} } }, historySource, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => current,
    onResponse: value => billed.push(value), invoke: async () => { current = false; return { summary: 'late' }; } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(billed.map(value => value.summary)).toContain('late');
});

it('can read more than eight pages before a real rewrite without consuming the write allowance', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'long-rewrite' };
  const doc = await saveLocalDocument(scope, { title: '长篇原稿', content: '原'.repeat(12000 * 9) + '\n要改写的结尾', format: 'text' });
  const session = await createWorkspaceSession({ scope, actionId: 'long-rewrite', parentNodeId: null, inputs: [], library: [doc], writableDocuments: [doc] });
  const path = `library/${doc.documentId}/source.txt`;
  const read = (offset: number): ActionToolResponse => ({ workspaceRequest: { method: 'files.read', params: { path, offset } } });
  const final = await continueActionTools({ response: read(0), historySource, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async context => {
      const last = context.workspaceContext.results.at(-1)!;
      if (last.status === 'failed' || last.status === 'denied') return { fileOutcome: 'failed', segments: [{ type: 'narration', text: '未完成。' }] };
      if (last.method === 'files.read' && last.nextOffset !== null) return read(last.nextOffset!);
      if (last.method === 'files.read') return { workspaceRequest: { method: 'files.patch', params: { path, expectedVersion: last.version, oldText: '要改写的结尾', newText: '改写完成的结尾' } } };
      expect(context.workspaceContext.execution?.current.remaining.write).toBeGreaterThan(0);
      return { segments: [{ type: 'narration', text: '改写完成。', workspaceEffects: [last.operationId!] }] };
    } });
  expect(session.receipts.filter(item => item.method === 'files.read')).toHaveLength(10);
  expect(session.receipts.at(-1)?.status).toBe('staged');
  expect(final.fileOutcome).toBeUndefined();
  expect(final.segments?.[0].text).toBe('改写完成。');
});
