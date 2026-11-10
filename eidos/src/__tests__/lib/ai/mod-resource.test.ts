import { afterEach, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleAdapter } from '@/lib/ai/providers/openai-compatible';
import { createDeepSeekNativeAdapter } from '@/lib/ai/providers/deepseek-native';
import { createAnthropicCompatibleAdapter } from '@/lib/ai/providers/anthropic-compatible';
import { createGeminiNativeAdapter } from '@/lib/ai/providers/gemini-native';
import type { AiChatRequest } from '@/lib/ai/providers/types';

afterEach(() => vi.unstubAllGlobals());
const request: AiChatRequest = { role: 'uzq', systemPrompt: 'stable', userMessage: 'describe actual bytes', temperature: 0.2, maxTokens: 20, jsonMode: false, timeoutMs: 2000,
  media: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }], config: { protocol: 'openai-compatible', providerId: 'custom', baseUrl: 'https://mock.test/v1', apiKey: 'test-key', model: 'test-model', enableReasoning: false, reasoningEffort: 'high', compatibilityMode: 'openai' } };
it('transmits real bytes in each protocol while preserving legacy string requests', async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: 'ok' } }], content: [{ type: 'text', text: 'ok' }], candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  }));
  await createOpenAiCompatibleAdapter().complete(request);
  await createAnthropicCompatibleAdapter().complete(request);
  await createGeminiNativeAdapter().complete(request);
  await createOpenAiCompatibleAdapter().complete({ ...request, media: undefined });
  expect((bodies[0].messages as never[])[1]).toEqual({ role: 'user', content: [{ type: 'text', text: request.userMessage }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] });
  expect(JSON.stringify(bodies[1])).toContain('"source":{"type":"base64","media_type":"image/png","data":"aGVsbG8="}');
  expect(JSON.stringify(bodies[2])).toContain('"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}');
  expect((bodies[3].messages as never[])[1]).toEqual({ role: 'user', content: request.userMessage });
});
it('refuses unsupported media before network and sends PDF through document-capable adapters', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ content: [{ type: 'text', text: 'document' }] })); vi.stubGlobal('fetch', fetch);
  await expect(createDeepSeekNativeAdapter().complete(request)).rejects.toThrow('不支持');
  expect(fetch).not.toHaveBeenCalled();
  await createAnthropicCompatibleAdapter().complete({ ...request, media: [{ type: 'document', mimeType: 'application/pdf', data: 'aGVsbG8=' }] });
  expect(JSON.parse(fetch.mock.calls[0][1].body as string).messages[0].content[0].type).toBe('document');
});
