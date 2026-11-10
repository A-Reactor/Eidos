import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGeminiNativeAdapter } from "@/lib/ai/providers/gemini-native";
import type { AiChatRequest } from "@/lib/ai/providers/types";

function makeRequest(): AiChatRequest {
  return {
    role: "alice",
    systemPrompt: "system",
    userMessage: "user",
    temperature: 0.8,
    maxTokens: 900,
    jsonMode: true,
    timeoutMs: 1000,
    callType: "gemini_test",
    config: {
      providerId: "gemini",
      protocol: "gemini-native",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "gemini-key",
      model: "gemini-2.5-flash",
      compatibilityMode: "native",
      enableReasoning: false,
      reasoningEffort: "high",
    },
  };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Gemini native adapter", () => {
  it('accepts the official bare hostname and models/ prefixed model IDs', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    vi.stubGlobal('fetch', fetcher);
    const r = makeRequest(); r.config.baseUrl = 'https://generativelanguage.googleapis.com/'; r.config.model = 'models/gemini-2.5-flash';
    await createGeminiNativeAdapter().complete(r);
    expect(fetcher.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key');
  });
  it('preserves Google quota details instead of only showing a generic rate limit error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Free tier quota exceeded for this model, limit: 0' } }, { status: 429 })));
    await expect(createGeminiNativeAdapter().complete(makeRequest())).rejects.toThrow(/limit: 0/);
  });
  it.each(['headers', 'body'])('reports a safe transport cause when %s fails', async phase => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('internal URL with gemini-key'), { code: 'ECONNRESET' }) });
    vi.stubGlobal('fetch', phase === 'headers' ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({ ok: true, json: async () => { throw error; } }));
    await expect(createGeminiNativeAdapter().complete(makeRequest())).rejects.toThrow(/ECONNRESET/);
    await expect(createGeminiNativeAdapter().complete(makeRequest())).rejects.not.toThrow(/gemini-key/);
  });
  it('keeps custom versioned endpoints intact', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    vi.stubGlobal('fetch', fetcher);
    const r = makeRequest(); r.config.baseUrl = 'https://gateway.example/gemini/v1/';
    await createGeminiNativeAdapter().complete(r);
    expect(fetcher.mock.calls[0][0]).toBe('https://gateway.example/gemini/v1/models/gemini-2.5-flash:generateContent?key=gemini-key');
  });
  it.each([undefined, 8014])('includes separately reported thinking in completion tokens while preserving total=%s', async total => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: 'body' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 8000, totalTokenCount: total } })));
    const result = await createGeminiNativeAdapter().complete(makeRequest());
    expect(result.usage).toMatchObject({ promptTokens: 10, completionTokens: 8004, reasoningTokens: 8000, totalTokens: 8014 });
  });
  it("posts generateContent request with generationConfig JSON mime type", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createGeminiNativeAdapter().complete(makeRequest());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      systemInstruction: { parts: [{ text: "system" }] },
      contents: [{ role: "user", parts: [{ text: "user" }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 900,
        responseMimeType: "application/json",
      },
    });
    expect(result.content).toBe("{\"ok\":true}");
    expect(result.usage.totalTokens).toBe(13);
  });
});
