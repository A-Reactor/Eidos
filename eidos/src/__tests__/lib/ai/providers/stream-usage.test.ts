import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';
import { createAnthropicCompatibleAdapter } from '@/lib/ai/providers/anthropic-compatible';
import { createGeminiNativeAdapter } from '@/lib/ai/providers/gemini-native';
import type { AiChatRequest, AiProviderAdapter } from '@/lib/ai/providers/types';
const request: AiChatRequest = { role: 'kei', systemPrompt: 'rules', userMessage: 'material', temperature: 0.8, maxTokens: 100, jsonMode: true, timeoutMs: 1000, config: { providerId: 'fixture', protocol: 'openai-compatible', model: 'fixture', baseUrl: 'https://example.invalid', apiKey: 'fake', compatibilityMode: 'openai', enableReasoning: false, reasoningEffort: 'high' } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function run(adapter: AiProviderAdapter, events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map(e => 'data: ' + JSON.stringify(e)).join('\n'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } }))));
  const onDone = vi.fn(), onError = vi.fn();
  await adapter.stream({ ...request, onChunk: vi.fn(), onDone, onError });
  expect(onError).not.toHaveBeenCalled(); expect(onDone).toHaveBeenCalledOnce();
  expect(onDone.mock.calls[0][0]).toBe('世界');
  expect(onDone.mock.calls[0][1]).toMatchObject({ promptTokens: 1000, cachedTokens: 700, cacheUsageReported: true, firstTokenMs: expect.any(Number) });
  return onDone.mock.calls[0][1];
}
describe('stream usage-only EOF and split UTF8', () => {
  it('keeps an OpenAI usage-only final line', async () => { await run(createOpenAiCompatibleAdapter(), [{ choices: [{ delta: { reasoning_content: 'thinking' } }] }, { choices: [{ delta: { content: '世界' } }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, prompt_tokens_details: { cached_tokens: 700 } } }]); });
  it('merges Anthropic input and final output without summing cumulative deltas', async () => {
    const usage = await run(createAnthropicCompatibleAdapter(), [{ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200 } } }, { type: 'content_block_delta', delta: { text: '世界' } }, { type: 'message_delta', usage: { output_tokens: 10 } }, { type: 'message_delta', usage: { output_tokens: 20 } }]);
    expect(usage).toMatchObject({ completionTokens: 20, cacheWriteTokens: 200, uncachedPromptTokens: 100 });
  });
  it('uses final Gemini metadata', async () => {
    const usage = await run(createGeminiNativeAdapter(), [{ candidates: [{ content: { parts: [{ text: '世界' }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1, cachedContentTokenCount: 700 } }, { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, totalTokenCount: 1020, cachedContentTokenCount: 700 } }]);
    expect(usage.completionTokens).toBe(20); expect(usage.usageEstimated).toBeUndefined();
  });
});

it('keeps Gemini thought parts out of body text and first body timing', async () => {
  let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const events = [
    { at: 20, event: { candidates: [{ content: { parts: [{ thought: true, text: 'internal reasoning' }] } }] } },
    { at: 100, event: { candidates: [{ content: { parts: [{ text: 'body' }] } }] } },
    { at: 120, event: { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, totalTokenCount: 1020, cachedContentTokenCount: 700 } } },
  ];
  let index = 0;
  const reader = { read: async () => { const item = events[index++]; if (!item) return { done: true, value: undefined }; now = item.at; return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(item.event)}\n`) }; }, cancel: async () => {}, releaseLock: () => {} };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
  const onDone = vi.fn(), onChunk = vi.fn(), onError = vi.fn();
  await createGeminiNativeAdapter().stream({ ...request, onChunk, onDone, onError });
  expect(onError).not.toHaveBeenCalled();
  expect(onChunk).toHaveBeenCalledOnce(); expect(onChunk).toHaveBeenCalledWith('body');
  expect(onDone).toHaveBeenCalledWith('body', expect.objectContaining({ firstTokenMs: 100, elapsedMs: 120 }));
});

it.each([
  [createOpenAiCompatibleAdapter(), { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, prompt_tokens_details: { cached_tokens: 700 } } }],
  [createAnthropicCompatibleAdapter(), { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200, output_tokens: 20 } } }],
  [createGeminiNativeAdapter(), { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 20, totalTokenCount: 1020, cachedContentTokenCount: 700 } }],
] as const)('retains known billing on %s stream failure without completing the story', async (adapter, event) => {
  let reads = 0;
  const reader = { read: async () => { if (reads++ === 0) return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n`) }; throw new Error('stream disconnected'); }, cancel: async () => {}, releaseLock: () => {} };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
  const onUsage = vi.fn(), onDone = vi.fn(), onError = vi.fn();
  await adapter.stream({ ...request, onUsage, onDone, onChunk: vi.fn(), onError });
  expect(onUsage).toHaveBeenCalledOnce();
  expect(onUsage.mock.calls[0][0]).toMatchObject({ promptTokens: 1000, cachedTokens: 700, success: false });
  expect(onDone).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  expect(onUsage.mock.invocationCallOrder[0]).toBeLessThan(onError.mock.invocationCallOrder[0]);
});

it('filters mixed Gemini thinking and body parts', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'body' }] } }] })));
  const result = await createGeminiNativeAdapter().complete(request);
  expect(result.content).toBe('body');
});
