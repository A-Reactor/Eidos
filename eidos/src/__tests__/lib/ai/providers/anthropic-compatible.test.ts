import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnthropicCompatibleAdapter } from "@/lib/ai/providers/anthropic-compatible";
import type { AiChatRequest } from "@/lib/ai/providers/types";

function makeRequest(): AiChatRequest {
  return {
    role: "kei",
    systemPrompt: "system rules",
    userMessage: "player input",
    temperature: 0.2,
    maxTokens: 1500,
    jsonMode: true,
    timeoutMs: 1000,
    callType: "anthropic_test",
    config: {
      providerId: "anthropic",
      protocol: "anthropic-compatible",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      model: "claude-3-5-sonnet-latest",
      compatibilityMode: "anthropic",
      enableReasoning: false,
      reasoningEffort: "high",
    },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("Anthropic-compatible adapter", () => {
  it("posts Messages API body with system and user content", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      content: [{ type: "text", text: "{\"ok\":true}" }],
      usage: { input_tokens: 12, output_tokens: 5 },
      stop_reason: "end_turn",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createAnthropicCompatibleAdapter().complete(makeRequest());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "claude-3-5-sonnet-latest",
      system: expect.stringContaining("system rules"),
      max_tokens: 1500,
      messages: [{ role: "user", content: expect.stringContaining("player input") }],
    });
    expect(result.content).toBe("{\"ok\":true}");
    expect(result.usage.totalTokens).toBe(17);
  });

  it("includes cached input in context occupancy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 12, cache_creation_input_tokens: 100, cache_read_input_tokens: 500, output_tokens: 5 },
      stop_reason: "end_turn",
    }), { status: 200 })));

    const result = await createAnthropicCompatibleAdapter().complete(makeRequest());

    expect(result.usage).toMatchObject({ promptTokens: 612, completionTokens: 5, totalTokens: 617, cachedTokens: 500 });
  });

  it("preserves initial input usage when stream deltas only report output", async () => {
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 12, cache_creation_input_tokens: 100, cache_read_input_tokens: 500, output_tokens: 1 } } },
      { type: "content_block_delta", delta: { text: "ok" } },
      { type: "message_delta", usage: { output_tokens: 3 } },
      { type: "message_delta", usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200 })));
    const onDone = vi.fn();
    const onError = vi.fn();

    await createAnthropicCompatibleAdapter().stream({ ...makeRequest(), onChunk: vi.fn(), onDone, onError });

    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith("ok", expect.objectContaining({ promptTokens: 612, completionTokens: 5, totalTokens: 617, cachedTokens: 500 }));
    expect(onDone.mock.calls[0][1].usageEstimated).toBeUndefined();
  });
});
