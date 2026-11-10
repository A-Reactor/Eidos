import { afterEach, expect, it, vi } from 'vitest';
import { createDeepSeekNativeAdapter } from '@/lib/ai/providers/deepseek-native';
import type { AiChatRequest } from '@/lib/ai/providers/types';
import { createActionWebTools } from '@/lib/ai/action-web-tools';
import { createActionNativeTools } from '@/lib/ai/action-native-tools';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const answer = JSON.stringify({ segments: [{ type: 'narration', text: '来源：https://example.com/official' }] });
const tool = { id: 'search-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"official docs"}' } };
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 40 };
function input() {
  return { role: 'alice', systemPrompt: 'Return game JSON.', userMessage: 'Search official docs.', temperature: 0.2,
    maxTokens: 1000, jsonMode: true, timeoutMs: 1000, config: { providerId: 'deepseek', protocol: 'deepseek-native',
      model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'fixture-key', compatibilityMode: 'native', enableReasoning: true, reasoningEffort: 'high' },
    tools: { definitions: [{ type: 'function', function: { name: 'web_search', description: 'Search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }],
      maxCalls: 4, execute: async () => ({ status: 'completed', result: { results: [{ title: 'Official', url: 'https://example.com/official' }] } }) },
  } satisfies AiChatRequest;
}
function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

it('executes native tool calls and returns the tool result with original reasoning and call ID', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'private reasoning', tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage: { ...usage, prompt_tokens: 200, total_tokens: 210 } }));
  vi.stubGlobal('fetch', fetcher);
  const result = await createDeepSeekNativeAdapter().complete(input());
  expect(result.content).toBe(answer);
  const first = JSON.parse(fetcher.mock.calls[0][1].body), second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(first.tools[0].function.name).toBe('web_search');
  expect(second.messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'private reasoning', tool_calls: [tool] });
  expect(second.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'search-1' });
  expect(JSON.parse(second.messages[3].content).result.results[0].url).toBe('https://example.com/official');
  expect(result.usage).toMatchObject({ promptTokens: 300, completionTokens: 20, totalTokens: 320 });
  expect(result.usage.inputContext?.inputTokens).toBe(200);
});

it('collects split SSE tool arguments and keeps tools and reasoning out of visible game JSON', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse([
    { choices: [{ delta: { reasoning_content: 'private ' } }] },
    { choices: [{ delta: { reasoning_content: 'reasoning', tool_calls: [{ index: 0, id: 'search-1', type: 'function', function: { name: 'web_search', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"official docs"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage },
  ])).mockResolvedValueOnce(sse([{ choices: [{ delta: { content: answer.slice(0, 20) } }] },
    { choices: [{ delta: { content: answer.slice(20) }, finish_reason: 'stop' }] }, { choices: [], usage }]));
  vi.stubGlobal('fetch', fetcher);
  const chunks: string[] = [], phases: string[] = [], onDone = vi.fn(), onError = vi.fn();
  await createDeepSeekNativeAdapter().stream({ ...input(), onChunk: delta => chunks.push(delta), onDone, onError, onActivity: activity => phases.push(activity.phase) });
  expect(onError).not.toHaveBeenCalled();
  expect(chunks.join('')).toBe(answer);
  expect(chunks.length).toBeGreaterThan(1);
  expect(phases).toContain('search');
  expect(onDone).toHaveBeenCalledWith(answer, expect.objectContaining({ totalTokens: 220 }));
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(second.messages[2].reasoning_content).toBe('private reasoning');
  expect(second.messages[2].tool_calls[0]).toEqual(tool);
});

it('returns a failed tool receipt for invalid arguments instead of killing the model round', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [{ ...tool, function: { ...tool.function, arguments: '{bad' } }] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  expect((await createDeepSeekNativeAdapter().complete(input())).content).toBe(answer);
  const second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(JSON.parse(second.messages[3].content).status).toBe('failed');
});

it('does not hand off parallel file operations or undeclared native function names', async () => {
  const command = { method: 'files.read', params: { path: 'images/example.json' } };
  const call = (id: string, name: string) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(command) } });
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [call('one', 'workspaceRequest'), call('two', 'toolRequest')] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [call('three', 'files.read')] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  const result = await createDeepSeekNativeAdapter().complete({ ...input(), tools: createActionNativeTools({ aliceProviderId: 'deepseek', aliceApiKey: 'offline-only' })! });
  const messages = JSON.parse(fetcher.mock.calls[2][1].body).messages;
  const errors = messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => JSON.parse(message.content));
  expect(errors).toHaveLength(3);
  expect(errors.every((result: { status: string }) => result.status === 'failed')).toBe(true);
  expect(errors[0].error).toContain('单独请求一个');
  expect(errors[2].error).toContain('未声明的模型工具：files.read');
  expect(result.content).toBe(answer);
});

it('keeps billing from an earlier native tool round if the next model request fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, ...tool }] }, finish_reason: 'tool_calls' }] }, { choices: [], usage }]))
    .mockRejectedValueOnce(new Error('disconnected'));
  vi.stubGlobal('fetch', fetcher);
  const onUsage = vi.fn(), onDone = vi.fn(), onError = vi.fn();
  await createDeepSeekNativeAdapter().stream({ ...input(), onChunk() {}, onUsage, onDone, onError });
  expect(onDone).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0][0].message).toContain('disconnected');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 110, success: false }));
});

it('keeps an aborted tool round from requesting another paid completion', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  const base = input();
  await expect(createDeepSeekNativeAdapter().complete({ ...base, signal: controller.signal,
    tools: { ...base.tools, execute: async () => { controller.abort(); throw controller.signal.reason; } } })).rejects.toMatchObject({ usage: { totalTokens: 110, success: false } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('stops executing tools at the harness budget and asks for a final response', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  const base = input();
  await createDeepSeekNativeAdapter().complete({ ...base, tools: { ...base.tools, maxCalls: 1 } });
  expect(JSON.parse(fetcher.mock.calls[1][1].body).tool_choice).toBe('none');
});

it('checks the expanded tool transcript before paying for a request that exceeds the context window', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  const base = input();
  await expect(createDeepSeekNativeAdapter().complete({ ...base, maxTokens: 1000, generationMaxTokens: 1000,
    config: { ...base.config, contextWindowTokens: 2000, reserveReasoningBudget: false }, tools: { ...base.tools, execute: async () => ({ text: 'x'.repeat(8000) }) } }))
    .rejects.toMatchObject({ usage: { totalTokens: 110 } });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('uses the history compression thresholds and folds the oldest web body first in the native transcript', async () => {
  const raw = '网页正文独有标记' + 'a'.repeat(7000), fresh = '本轮新读取' + 'b'.repeat(16000);
  const receipts = [raw, fresh];
  const settings = { aliceProviderId: 'deepseek', aliceApiKey: 'key', contextCompressionLowerPercent: 55, contextCompressionUpperPercent: 60 };
  const base = createActionWebTools(settings as unknown as Record<string, string>, async () => ({ method: 'web.open', status: 'completed', result: { url: 'https://example.com/official', title: '官方页', text: receipts.shift() } }))!;
  const opening = { ...tool, function: { name: 'web_open', arguments: '{"url":"https://example.com/official"}' } };
  const searchAgain = { ...tool, id: 'search-2' };
  const fetcher = vi.fn().mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: null, tool_calls: [opening] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [searchAgain] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  const request = input();
  await createDeepSeekNativeAdapter().complete({ ...request, tools: base, config: { ...request.config, contextWindowTokens: 20000, reserveReasoningBudget: false } });
  const before = JSON.parse(fetcher.mock.calls[1][1].body).messages[3], after = JSON.parse(fetcher.mock.calls[2][1].body).messages[3];
  expect(before.content).toContain(raw);
  expect(after.tool_call_id).toBe('search-1');
  expect(after.content).not.toContain(raw);
  expect(after.content).toContain('https://example.com/official');
  expect(JSON.parse(after.content).result.collapsed).toBe(true);
  expect(after.content.length).toBeLessThan(1200);
  expect(JSON.parse(fetcher.mock.calls[2][1].body).messages[5].content).toContain(fresh);
});

it('compacts an oversized webpage before the hard budget check instead of discarding game context', async () => {
  const raw = 'x'.repeat(20000), request = input();
  const tools = createActionWebTools({ aliceProviderId: 'deepseek', aliceApiKey: 'key' }, async () => ({ method: 'web.open', status: 'completed', result: { url: 'https://example.com/official', text: raw } }))!;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: null, tool_calls: [tool] }, finish_reason: 'tool_calls' }], usage }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', fetcher);
  expect((await createDeepSeekNativeAdapter().complete({ ...request, tools, config: { ...request.config, contextWindowTokens: 7000, reserveReasoningBudget: false } })).content).toBe(answer);
  const sent = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(sent.messages[0].content).toContain(request.systemPrompt);
  expect(JSON.parse(sent.messages[3].content).result).toMatchObject({ collapsed: true, sources: [{ label: 'example.com', url: 'https://example.com/official' }] });
  expect(sent.messages[3].content).not.toContain(raw);
});
