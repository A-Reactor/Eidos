import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleAdapter } from "@/lib/ai/providers/openai-compatible";
import type { AiChatRequest } from "@/lib/ai/providers/types";

function makeRequest(overrides: Partial<AiChatRequest> = {}): AiChatRequest {
  return {
    role: "alice",
    systemPrompt: "system",
    userMessage: "user",
    temperature: 0.7,
    maxTokens: 1200,
    jsonMode: true,
    timeoutMs: 1000,
    callType: "test_call",
    config: {
      providerId: "custom-openai-compatible",
      protocol: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      model: "test-model",
      compatibilityMode: "openai",
      enableReasoning: false,
      reasoningEffort: "high",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAI-compatible adapter", () => {
  it("keeps OpenAI native protocol metadata distinct from generic compatible adapters", () => {
    expect(createOpenAiCompatibleAdapter("openai-native").protocol).toBe("openai-native");
    expect(createOpenAiCompatibleAdapter().protocol).toBe("openai-compatible");
  });

  it("posts chat completions with JSON mode when supported", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createOpenAiCompatibleAdapter().complete(makeRequest());

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.example/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "test-model",
      temperature: 0.7,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    });
    expect(result.content).toBe("{\"ok\":true}");
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 4, totalTokens: 14, model: "alice" });
  });

  it("normalizes provider HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("bad key", { status: 401, statusText: "Unauthorized" })));

    await expect(createOpenAiCompatibleAdapter().complete(makeRequest())).rejects.toMatchObject({
      code: "auth_failed",
    });
  });
});
