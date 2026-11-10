import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/game/settings", () => ({
  loadSettings: vi.fn(),
}));

import { loadSettings } from "@/lib/game/settings";
import { DEFAULT_SETTINGS } from "@/lib/game/types";
import { callAi, callAiStream, callDeepSeek, subscribeTokenUsage } from "@/lib/ai/client";

const mockedLoadSettings = loadSettings as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockedLoadSettings.mockReturnValue({
    ...DEFAULT_SETTINGS,
    aliceApiKey: "key",
  });
});

describe("unified AI client", () => {
  it('blocks full request overflow without a network call and preserves exact provider output reserve', async () => {
    mockedLoadSettings.mockReturnValue({ ...DEFAULT_SETTINGS, aliceApiKey: 'key', aliceContextWindowTokens: 1000 });
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    await expect(callAi({ role: 'alice', systemPrompt: '完整世界与卡片', userMessage: '行动', temperature: 0, maxTokens: 8000, jsonMode: true, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'context_budget_exceeded' });
    expect(network).not.toHaveBeenCalled();
    const error = vi.fn();
    await expect(callAiStream({ role: 'alice', systemPrompt: '完整世界与卡片', userMessage: '行动', temperature: 0, maxTokens: 8000, timeoutMs: 1000, onChunk: vi.fn(), onDone: vi.fn(), onError: error })).rejects.toMatchObject({ code: 'context_budget_exceeded' });
    expect(network).not.toHaveBeenCalled();
  });
  it('records empty length-limited completion billing then rejects without resending', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '', reasoning_content: 'hidden' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 8000, total_tokens: 8010, completion_tokens_details: { reasoning_tokens: 8000 } } }));
    vi.stubGlobal('fetch', fetchMock);
    const received = vi.fn(), off = subscribeTokenUsage(received);
    try {
      await expect(callAi({ role: 'alice', systemPrompt: 'rules', userMessage: 'action', temperature: 0, maxTokens: 8000, jsonMode: true, timeoutMs: 1000 }))
        .rejects.toMatchObject({ code: 'output_limit' });
      expect(fetchMock).toHaveBeenCalledOnce(); expect(received).toHaveBeenCalledOnce();
      expect(received.mock.calls[0][0]).toMatchObject({ success: false, outputChars: 0, reasoningTokens: 8000, finishReason: 'length', errorCode: 'output_limit', totalTokens: 8010 });
    } finally { off(); }
  });
  it("routes callAi through configured provider and tracks usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }), { status: 200 })));

    const result = await callAi({
      role: "alice",
      systemPrompt: "system",
      userMessage: "user",
      temperature: 0.1,
      maxTokens: 200,
      jsonMode: true,
      timeoutMs: 1000,
      callType: "client_test",
    });

    expect(result.content).toBe("{\"ok\":true}");
    expect(result.usage.totalTokens).toBe(8);
    expect(result.usage.inputContext).toMatchObject({ modelId: DEFAULT_SETTINGS.aliceModel, providerId: 'deepseek', inputTokens: 5, windowTokens: 1_000_000, estimated: false });
  });

  it("keeps callDeepSeek as a compatibility wrapper", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"legacy\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }), { status: 200 })));

    const result = await callDeepSeek("system", "user", 0.2, 300, true, 1000, false, null, undefined, "legacy_test");

    expect(result.content).toBe("{\"legacy\":true}");
  });
});

it('passes model context metadata through streaming completion', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":9000,"completion_tokens":2,"total_tokens":9002}}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } })));
  const onDone = vi.fn();
  await callAiStream({ role: 'alice', systemPrompt: 's', userMessage: 'u', temperature: 0, maxTokens: 10, timeoutMs: 1000,
    onChunk: vi.fn(), onDone, onError: vi.fn() });
  expect(onDone.mock.calls[0][1].inputContext).toMatchObject({ inputTokens: 9000, modelId: DEFAULT_SETTINGS.aliceModel, estimated: false });
});

it('marks approximate counts when the provider omits usage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'ok' } }] })));
  const result = await callAi({ role: 'alice', systemPrompt: '12345', userMessage: '12345', temperature: 0, maxTokens: 10, jsonMode: true, timeoutMs: 1000 });
  expect(result.usage.inputContext).toMatchObject({ inputTokens: 4, estimated: true });
});

it('cancels in-flight speculation at the fetch boundary without retrying', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    requestSignal = init.signal as AbortSignal;
    requestSignal.addEventListener('abort', () => reject(requestSignal!.reason), { once: true });
  }));
  vi.stubGlobal('fetch', fetchMock);
  const pending = callAi({role:'alice',systemPrompt:'system',userMessage:'user',temperature:0,maxTokens:10,jsonMode:true,timeoutMs:1000,signal:controller.signal});
  controller.abort();
  await expect(pending).rejects.toBeInstanceOf(Error);
  expect(requestSignal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('rejects inconsistent prompt sections before any network call', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  const options = { role: 'alice' as const, systemPrompt: 'wrong', promptSections: { stablePrefix: 'fixed', dynamicSuffix: 'state' }, userMessage: 'u', temperature: 0, maxTokens: 10, jsonMode: true, timeoutMs: 1000 };
  await expect(callAi(options)).rejects.toThrow('promptSections');
  await expect(callAiStream({ ...options, onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() })).rejects.toThrow('promptSections');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('records failed stream usage exactly once with actual model metadata', async () => {
  let reads = 0;
  const reader = { read: async () => { if (reads++ === 0) return { done: false, value: new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":20,"total_tokens":1020,"prompt_cache_hit_tokens":700,"prompt_cache_miss_tokens":300}}\n') }; throw new Error('disconnected'); }, cancel: async () => {}, releaseLock: () => {} };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
  const subscriber = vi.fn(), onUsage = vi.fn(), onDone = vi.fn(), onError = vi.fn();
  const off = subscribeTokenUsage(subscriber);
  try {
    await callAiStream({ role: 'alice', systemPrompt: 'rules', userMessage: 'material', temperature: 0, maxTokens: 100, timeoutMs: 1000, onChunk: vi.fn(), onDone, onError, onUsage });
    expect(subscriber).toHaveBeenCalledOnce(); expect(onUsage).toHaveBeenCalledOnce();
    expect(subscriber.mock.calls[0][0]).toMatchObject({ success: false, providerId: 'deepseek', modelId: DEFAULT_SETTINGS.aliceModel, totalTokens: 1020, cachedTokens: 700 });
    expect(onDone).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce();
  } finally { off(); }
});
