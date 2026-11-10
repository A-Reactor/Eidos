import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeepSeekNativeAdapter } from "@/lib/ai/providers/deepseek-native";
import type { AiChatRequest } from "@/lib/ai/providers/types";

function requestWithReasoning(): AiChatRequest {
  return {
    role: "kei",
    systemPrompt: "system",
    userMessage: "user",
    temperature: 0.2,
    maxTokens: 4000,
    jsonMode: true,
    timeoutMs: 1000,
    callType: "kei_review",
    config: {
      providerId: "deepseek",
      protocol: "deepseek-native",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "deepseek-key",
      model: "deepseek-v4-pro",
      compatibilityMode: "native",
      enableReasoning: true,
      reasoningEffort: "high",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek native adapter", () => {
  it.each(['high', 'max'] as const)('keeps the requested total budget when the reserve is off at effort=%s', async effort => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const request = requestWithReasoning();
    await createDeepSeekNativeAdapter().complete({ ...request, maxTokens: 8000,
      config: { ...request.config, reserveReasoningBudget: false, reasoningEffort: effort } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.max_tokens).toBe(8000);
    expect(body.reserveReasoningBudget).toBeUndefined();
  });
  it.each([
    [true, 'high', 8000, 65536],
    [true, 'max', 8000, 131072],
    [true, 'high', 393216, 393216],
    [false, 'high', 4000, 4000],
  ] as const)('honors reasoning=%s effort=%s with caller budget=%s', async (enabled, effort, callerBudget, expectedBudget) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const request = requestWithReasoning();
    await createDeepSeekNativeAdapter().complete({ ...request, maxTokens: callerBudget,
      config: { ...request.config, enableReasoning: enabled, reasoningEffort: effort } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: enabled ? 'enabled' : 'disabled' });
    expect(body.max_tokens).toBe(expectedBudget);
    if (!enabled) expect(body.response_format).toEqual({ type: 'json_object' });
  });
  it("adds reasoning fields and omits response_format when reasoning is enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"review\":true}" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 8,
        total_tokens: 28,
        prompt_cache_hit_tokens: 12,
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createDeepSeekNativeAdapter().complete(requestWithReasoning());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.response_format).toBeUndefined();
    expect(result.usage.cachedTokens).toBe(12);
  });
});
