import { actionEvidence } from '@/lib/test/action-context';
import { afterEach, expect, it, vi } from 'vitest';
import { parseActionToolRequest, workspacePromptAddition } from '@/lib/ai/workspace-tools';
import { actionToolCategory } from '@/lib/game/action-tool-budget';
import { continueActionTools, type ActionToolContext, type ActionToolResponse } from '@/lib/game/action-tool-continuation';

afterEach(() => vi.unstubAllGlobals());
it('accepts public search and page reads in the shared action protocol and read budget', () => {
  for (const raw of [{ method: 'web.search', params: { query: 'TypeScript 官方文档', count: 3 } },
    { method: 'web.open', params: { url: 'https://www.typescriptlang.org/docs/', offset: 12000 } }]) {
    const request = parseActionToolRequest(raw);
    expect(request).toEqual(raw);
    expect(actionToolCategory(request)).toBe('read');
  }
  expect(workspacePromptAddition()).toContain('web.search');
});
it.each([{ query: '' }, { query: 'test', count: 0 }, { query: 'test', count: 11 }])('rejects invalid search arguments: %j', params => {
  expect(() => parseActionToolRequest({ method: 'web.search', params })).toThrow();
});
it('returns real web evidence through the continuation without needing a file session or write grants', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ method: 'web.search', status: 'completed', result: {
    query: 'TypeScript', results: [{ title: 'TypeScript Documentation', url: 'https://www.typescriptlang.org/docs/', snippet: 'Official documentation' }], retrievedAt: '2026-11-02T00:00:00Z',
  } }));
  vi.stubGlobal('fetch', fetcher);
  const contexts: ActionToolContext[] = [], phases: string[] = [];
  const response = { toolRequest: { method: 'web.search', params: { query: 'TypeScript' } } } as ActionToolResponse;
  const final = await continueActionTools({ response, session: null, historySource: { allNodes: {}, currentNode: null },
    context: { longMemoryContext: '', workspaceContext: { draftRoot: 'drafts/test', mounts: [], results: [], nextOffset: null } },
    isCurrent: () => true, onResponse() {}, onActivity: phase => phases.push(phase),
    invoke: async context => { contexts.push(context); return { segments: [{ type: 'narration', text: '查到了官方文档。' }] }; } });
  expect(final.operationOutcome).toBeUndefined();
  expect(actionEvidence(contexts[0])).toContain('https://www.typescriptlang.org/docs/');
  expect(actionEvidence(contexts[0])).toContain('completed');
  expect(phases).toContain('search');
  expect(fetcher.mock.calls[0][0]).toBe('/api/game/web');
});
it('reports a disconnected search route as failure rather than inventing search results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
  let evidence = '';
  const final = await continueActionTools({ response: { toolRequest: { method: 'web.search', params: { query: 'TypeScript' } } } as ActionToolResponse,
    session: null, historySource: { allNodes: {}, currentNode: null },
    context: { longMemoryContext: '', workspaceContext: { draftRoot: 'drafts/test', mounts: [], results: [], nextOffset: null } },
    isCurrent: () => true, onResponse() {}, invoke: async context => { evidence = actionEvidence(context); return { operationOutcome: 'failed', segments: [] }; } });
  expect(evidence).toContain('fetch failed');
  expect(final.operationOutcome).toBe('failed');
});

it('rejects a successful final claim after an upstream search failure and lets the model report the failure', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ method: 'web.search', status: 'failed', error: '搜索服务返回 HTTP 503' }));
  vi.stubGlobal('fetch', fetcher);
  let calls = 0;
  const final = await continueActionTools({ response: { toolRequest: { method: 'web.search', params: { query: 'docs' } } },
    session: null, historySource: { allNodes: {}, currentNode: null },
    context: { longMemoryContext: '', workspaceContext: { draftRoot: 'drafts/test', mounts: [], results: [], nextOffset: null } },
    isCurrent: () => true, onResponse() {}, invoke: async context => {
      expect(actionEvidence(context)).toContain('HTTP 503');
      return ++calls === 1 ? { segments: [{ type: 'narration', text: '已经查完。' }] } : { operationOutcome: 'failed', segments: [] };
    } });
  expect(final.operationOutcome).toBe('failed');
  expect(calls).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
