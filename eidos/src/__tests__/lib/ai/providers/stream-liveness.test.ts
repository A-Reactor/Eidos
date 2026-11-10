import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';
import { createAnthropicCompatibleAdapter } from '@/lib/ai/providers/anthropic-compatible';
import { createGeminiNativeAdapter } from '@/lib/ai/providers/gemini-native';
import type { AiChatRequest, AiProviderAdapter } from '@/lib/ai/providers/types';

const base: AiChatRequest = { role: 'alice', systemPrompt: 'rules', userMessage: 'action', temperature: 0,
  maxTokens: 8000, timeoutMs: 100, jsonMode: true, config: { providerId: 'fixture', protocol: 'openai-compatible',
    model: 'fixture', baseUrl: 'https://example.invalid', apiKey: 'fake', compatibilityMode: 'native', enableReasoning: true, reasoningEffort: 'high' } };
beforeEach(() => {
  vi.useFakeTimers();
  // Make the old wall-clock signal deterministic too, so the regression catches it.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), ms);
    return controller.signal;
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function start(adapter = createOpenAiCompatibleAdapter(), options: Partial<AiChatRequest> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let signal!: AbortSignal;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Response(stream);
  }));
  const onDone = vi.fn(), onError = vi.fn(), onUsage = vi.fn(), onChunk = vi.fn(), onActivity = vi.fn();
  const done = adapter.stream({ ...base, ...options, onDone, onError, onUsage, onChunk, onActivity });
  await vi.advanceTimersByTimeAsync(0);
  return { done, onDone, onError, onUsage, onChunk, onActivity, signal,
    push: (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
    bytes: (text: string) => controller.enqueue(new TextEncoder().encode(text)), close: () => controller.close() };
}

describe('stream connection progress and cancellation', () => {
  it('allows continuing thought beyond the original timeout and then emits only body text', async () => {
    const s = await start();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(80);
      expect(s.signal.aborted).toBe(false);
      s.push({ choices: [{ delta: { reasoning_content: 'private thought' } }] });
      await vi.advanceTimersByTimeAsync(0);
    }
    s.push({ choices: [{ delta: { content: 'body' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    s.close(); await s.done;
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.onChunk.mock.calls).toEqual([['body']]);
    expect(s.onActivity.mock.calls.map(([a]) => a.phase)).toEqual(['waiting', 'thinking', 'generating']);
    expect(JSON.stringify(s.onActivity.mock.calls)).not.toContain('private thought');
    expect(s.onDone.mock.calls[0][1]).toMatchObject({ finishReason: 'stop', outputChars: 4, firstTokenMs: 320 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts heartbeat and partial SSE bytes as activity without pretending to think', async () => {
    const s = await start();
    await vi.advanceTimersByTimeAsync(80); s.bytes(': keepalive\n\n'); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(80); expect(s.signal.aborted).toBe(false);
    s.bytes('data: {"choices":'); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(80); expect(s.signal.aborted).toBe(false);
    s.bytes('[{"delta":{"content":"body"}}]}\n\n'); s.close(); await s.done;
    expect(s.onActivity.mock.calls.map(([a]) => a.phase)).toEqual(['waiting', 'generating']);
    expect(s.onDone.mock.calls[0][0]).toBe('body');
  });

  it('fails a truly stalled reader with an idle error and cleans its timers', async () => {
    const s = await start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.onError).toHaveBeenCalledOnce();
    expect(s.onError.mock.calls[0][0]).toMatchObject({ code: 'stream_idle' });
    await s.done;
    expect(s.onDone).not.toHaveBeenCalled(); expect(s.onUsage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces a ten-minute ceiling even with continuous keepalives', async () => {
    const s = await start(createOpenAiCompatibleAdapter(), { timeoutMs: 120000 });
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(60000); expect(s.signal.aborted).toBe(false);
      s.bytes(': keepalive\n\n'); await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.onError.mock.calls[0][0]).toMatchObject({ code: 'stream_deadline' });
    await s.done; expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending read immediately and never completes a story', async () => {
    const controller = new AbortController();
    const s = await start(createOpenAiCompatibleAdapter(), { signal: controller.signal });
    controller.abort(); await vi.advanceTimersByTimeAsync(0);
    expect(s.onError).toHaveBeenCalledOnce();
    expect(s.onError.mock.calls[0][0].name).toBe('AbortError');
    await s.done; expect(s.onDone).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

const protocols: [AiProviderAdapter, unknown, unknown, unknown][] = [
  [createOpenAiCompatibleAdapter(), { choices: [{ delta: { reasoning_content: 'secret' } }] },
    { choices: [{ delta: { content: 'body' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8004, completion_tokens_details: { reasoning_tokens: 8000 } } },
    { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 8000, completion_tokens_details: { reasoning_tokens: 8000 } } }],
  [createAnthropicCompatibleAdapter(), { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'secret' } },
    { type: 'content_block_delta', delta: { text: 'body' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { input_tokens: 10, output_tokens: 8000 } }],
  [createGeminiNativeAdapter(), { candidates: [{ content: { parts: [{ thought: true, text: 'secret' }] } }] },
    { candidates: [{ content: { parts: [{ text: 'body' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 8000 } },
    { candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, thoughtsTokenCount: 8000 } }],
];

it.each(protocols)('%s maps thinking separately from first body timing', async (adapter, thought, body) => {
  const s = await start(adapter, { timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(20); s.push(thought); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(80); s.push(body); s.close(); await s.done;
  expect(s.onActivity.mock.calls.map(([a]) => a.phase)).toEqual(['waiting', 'thinking', 'generating']);
  expect(s.onChunk.mock.calls).toEqual([['body']]);
  expect(s.onDone.mock.calls[0][1]).toMatchObject({ firstTokenMs: 100, outputChars: 4 });
  expect(JSON.stringify(s.onActivity.mock.calls)).not.toContain('secret');
});

it.each(protocols)('%s fails thought-only budget exhaustion while retaining billing once', async (adapter, thought, _body, end) => {
  const s = await start(adapter); s.push(thought); s.push(end); s.close(); await s.done;
  expect(s.onError).toHaveBeenCalledOnce();
  expect(s.onError.mock.calls[0][0]).toMatchObject({ code: 'output_limit' });
  expect(s.onDone).not.toHaveBeenCalled(); expect(s.onChunk).not.toHaveBeenCalled();
  expect(s.onUsage).toHaveBeenCalledOnce();
  expect(s.onUsage.mock.calls[0][0]).toMatchObject({ success: false, outputChars: 0, errorCode: 'output_limit' });
  expect(s.onUsage.mock.calls[0][0].firstTokenMs).toBeUndefined();
  if (adapter.id === 'gemini-native') expect(s.onUsage.mock.calls[0][0]).toMatchObject({ completionTokens: 8000, totalTokens: 8010, reasoningTokens: 8000 });
});
