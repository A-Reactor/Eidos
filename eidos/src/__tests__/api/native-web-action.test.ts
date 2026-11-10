import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { POST as web } from '@/app/api/game/web/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
const { world, snapshot } = buildRiftCityStartState();
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const settings = { aliceProviderId: 'deepseek', aliceApiKey: 'request-key', aliceEndpoint: 'https://api.deepseek.com/v1', aliceEnableReasoning: true };
const request = () => new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerInput: '联网查找官方文档并使用结果作答', world, snapshot, recentHistory: [], _settings: settings }) });
const tool = { id: 'web-call', type: 'function', function: { name: 'web_search', arguments: '{"query":"TypeScript documentation"}' } };
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const final = { segments: [{ type: 'narration', text: '官方文档见[来源](https://www.typescriptlang.org/docs/)。' }], timeSpent: { day: 0, hour: 0, minute: 0 }, summary: '查阅官方资料' };
function sse(events: unknown[]) { return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); }

it.each([['JSON', action], ['SSE', stream]] as const)('finishes native search server-side through the real %s action entry point', async (name, handler) => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'auto');
  const fetcher = vi.fn().mockResolvedValueOnce(name === 'JSON'
    ? Response.json({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'private', tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage })
    : sse([{ choices: [{ delta: { reasoning_content: 'private', tool_calls: [{ index: 0, ...tool }] }, finish_reason: 'tool_calls' }] }, { usage, choices: [] }]))
    .mockResolvedValueOnce(Response.json({ results: [{ title: 'TypeScript Docs', url: 'https://www.typescriptlang.org/docs/', snippet: 'Official docs', summary: 'Model-readable official documentation' }, { title: 'Handbook', url: 'https://www.typescriptlang.org/docs/handbook/', snippet: 'Handbook' }] }))
    .mockResolvedValueOnce(name === 'JSON' ? Response.json({ choices: [{ message: { content: JSON.stringify(final) }, finish_reason: 'stop' }], usage })
      : sse([{ choices: [{ delta: { content: JSON.stringify(final) }, finish_reason: 'stop' }] }, { usage, choices: [] }]));
  vi.stubGlobal('fetch', fetcher);
  const response = await handler(request());
  expect(response.status).toBe(200);
  const events = name === 'JSON' ? [await response.json()] : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const result = name === 'JSON' ? events[0] : events.find(event => event.type === 'done');
  const segments = name === 'JSON' ? result.segments : events.filter(event => event.type === 'segments').at(-1).segments;
  expect(segments[0].text).toContain('https://www.typescriptlang.org/docs/');
  expect(segments[0].searchSources).toEqual([{ label: 'TypeScript Docs', url: 'https://www.typescriptlang.org/docs/' }, { label: 'Handbook', url: 'https://www.typescriptlang.org/docs/handbook/' }]);
  expect(result.toolRequest).toBeUndefined();
  expect(result._webToolReceipts[0].result).toMatchObject({ collapsed: true, sources: [{ label: 'TypeScript Docs', url: 'https://www.typescriptlang.org/docs/' }, { label: 'Handbook', url: 'https://www.typescriptlang.org/docs/handbook/' }] });
  expect(result._webToolReceipts[0].result).not.toHaveProperty('results');
  expect(result._tokenUsage.totalTokens).toBe(220);
  expect(result._tokenUsage.inputContext.inputTokens).toBe(100);
  expect(fetcher.mock.calls[1][0]).toBe('https://api.deepseek.com/v1/tools/search');
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer request-key');
  const outgoing = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(outgoing.messages[2].reasoning_content).toBe('private');
  expect(outgoing.messages[3].tool_call_id).toBe('web-call');
  expect(outgoing.messages[3].content).toContain('Model-readable official documentation');
  expect(events.some(event => event.type === 'error')).toBe(false);
});

it('passes browser-configured credentials to the official API on the legacy web route', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'auto');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] })); vi.stubGlobal('fetch', fetcher);
  const response = await web(new Request('http://localhost/api/game/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    method: 'web.search', params: { query: 'docs' }, _settings: { aliceProviderId: 'deepseek', aliceApiKey: 'browser-key', aliceEndpoint: 'https://api.deepseek.com/v1' },
  }) }));
  expect((await response.json()).status).toBe('completed');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer browser-key');
});

it.each([
  ['JSON', action, 'toolRequest'], ['SSE', stream, 'toolRequest'],
  ['JSON', action, 'workspaceRequest'], ['SSE', stream, 'workspaceRequest'],
] as const)('hands native file requests to the existing action continuation, %s case %#', async (name, handler, gateway) => {
  const command = { method: 'files.read', params: { path: 'images/b66aa6cc97fcbcf0.json' } };
  const call = { id: 'file-call', type: 'function', function: { name: gateway, arguments: JSON.stringify(command) } };
  const fetcher = vi.fn().mockResolvedValueOnce(name === 'JSON'
    ? Response.json({ choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage })
    : sse([{ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] }, { usage, choices: [] }]))
    .mockResolvedValueOnce(name === 'JSON'
      ? Response.json({ choices: [{ message: { content: JSON.stringify(final) }, finish_reason: 'stop' }], usage })
      : sse([{ choices: [{ delta: { content: JSON.stringify(final) }, finish_reason: 'stop' }] }, { usage, choices: [] }]));
  vi.stubGlobal('fetch', fetcher);
  const response = await handler(request());
  const events = name === 'JSON' ? [await response.json()] : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const result = name === 'JSON' ? events[0] : events.find(event => event.type === 'done');
  expect(result.toolRequest ?? result.workspaceRequest).toEqual(command);
  expect(result.document).toBeUndefined();
  expect(result.segments).toEqual([]);
  expect(result._tokenUsage.totalTokens).toBe(110);
  // The browser owns the file session and must execute this request before another model call.
  expect(fetcher).toHaveBeenCalledOnce();
  const outgoing = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(outgoing.tools.map((entry: { function: { name: string } }) => entry.function.name)).toEqual(expect.arrayContaining(['web_search', 'web_open', 'toolRequest', 'workspaceRequest']));
  expect(events.some(event => event.type === 'error' || event.type === 'segments')).toBe(false);
});

it.each([['JSON', action], ['SSE', stream]] as const)('sends invalid native writes through the existing failed-command guard on %s', async (name, handler) => {
  const call = { id: 'invalid-file', type: 'function', function: { name: 'toolRequest', arguments: JSON.stringify({ method: 'files.write', params: { path: 'images/test.json', text: '{}' } }) } };
  const fetcher = vi.fn().mockResolvedValueOnce(name === 'JSON'
    ? Response.json({ choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage })
    : sse([{ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] }, { usage, choices: [] }]))
    .mockResolvedValueOnce(name === 'JSON'
      ? Response.json({ choices: [{ message: { content: JSON.stringify(final) }, finish_reason: 'stop' }], usage })
      : sse([{ choices: [{ delta: { content: JSON.stringify(final) }, finish_reason: 'stop' }] }, { usage, choices: [] }]));
  vi.stubGlobal('fetch', fetcher);
  const response = await handler(request());
  const events = name === 'JSON' ? [await response.json()] : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const result = name === 'JSON' ? events[0] : events.find(event => event.type === 'done');
  expect(result.toolError).toMatchObject({ method: 'files.write', path: 'images/test.json', message: expect.stringContaining('expectedVersion') });
  expect(result.document).toBeUndefined();
  expect(fetcher).toHaveBeenCalledOnce();
});
