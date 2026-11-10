import { afterEach, expect, it, vi } from 'vitest';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { parseActionImages } from '@/lib/ai/action-images';
import { createDeepSeekNativeAdapter } from '@/lib/ai/providers/deepseek-native';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJmUAAAAASUVORK5CYII=';
const image = { path: 'inputs/picture/first/source.md', version: 'material_1234567890abcdef', name: '地图首版', mimeType: 'image/png', data: png };
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('carries actual image pixels through action generation to the DeepSeek provider, streaming=%s', async streaming => {
  const response = { segments: [{ type: 'narration', text: '图上标出了河岸。' }], summary: '查看图像' };
  const content = JSON.stringify(response), usage = { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 };
  const network = vi.fn(async () => streaming ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }));
  vi.stubGlobal('fetch', network);
  const { world, snapshot } = buildRiftCityStartState();
  const opts = { playerInput: '查看这张图片', world, snapshot, imageInputs: [image], clientSettings: { ...DEFAULT_SETTINGS, aliceApiKey: 'test', aliceEnableReasoning: false } as unknown as Record<string, string> };
  if (streaming) {
    const done = vi.fn(), error = vi.fn();
    await processPlayerActionStream({ ...opts, callbacks: { onDone: done, onError: error } });
    expect(error).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledOnce();
  } else expect((await processPlayerAction(opts)).segments[0].text).toBe(response.segments[0].text);
  expect(network).toHaveBeenCalledOnce();
  const body = JSON.parse((network.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);
  expect(body.messages[1].content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('地图首版') }), { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }]);
  expect(body.messages[0].content).not.toContain(png);
});
it.each([['image/svg+xml', png], ['image/png', 'aHR0cHM6Ly9leGFtcGxlLmNvbQ=='], ['image/png', 'https://example.com/a.png']])('rejects unsupported or fake image bytes before provider work: %s', (mimeType, data) => {
  expect(() => parseActionImages([{ ...image, mimeType, data }])).toThrow();
});
it('rejects Pro image inputs before the network instead of silently treating them as text', async () => {
  const network = vi.fn(); vi.stubGlobal('fetch', network);
  await expect(createDeepSeekNativeAdapter().complete({ role: 'alice', systemPrompt: 'rules', userMessage: 'read', media: [{ type: 'image', mimeType: 'image/png', data: png }], temperature: 0, maxTokens: 100, jsonMode: true, timeoutMs: 1000,
    config: { providerId: 'deepseek', protocol: 'deepseek-native', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test', model: 'deepseek-v4-pro', compatibilityMode: 'native', enableReasoning: false, reasoningEffort: 'high' } })).rejects.toThrow('识图');
  expect(network).not.toHaveBeenCalled();
});
