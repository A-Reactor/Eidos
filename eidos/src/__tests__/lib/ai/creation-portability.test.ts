import { afterEach, expect, it, vi } from 'vitest';
import { streamCreationJSON, streamCreationTurn } from '@/lib/ai/creation-stream';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { recordCreationUsage } from '@/lib/ai/client';

afterEach(() => vi.unstubAllGlobals());
const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'create' }, { role: 'assistant', content: 'old draft' }, { role: 'user', content: 'repair it' }];
it('creates through Claude Messages while preserving the full author transcript and real usage', async () => {
  const cfg = resolveAiRoleConfig('kei', { ...DEFAULT_SETTINGS, keiProviderId: 'anthropic', keiModel: 'claude-3-5-sonnet-latest', keiEndpoint: 'https://api.anthropic.com/v1', keiApiKey: 'fixture' });
  const fetcher = vi.fn(async () => new Response([
    { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 40 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"world":true}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')));
  vi.stubGlobal('fetch', fetcher); const onUsage = vi.fn();
  const result = await streamCreationTurn(cfg, { messages, temperature: 0.9, max_tokens: 393216, thinking: { type: 'enabled' } }, vi.fn(), { onUsage });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(JSON.parse(String(init.body))).toMatchObject({ system: 'rules', messages: messages.slice(1), max_tokens: 8192 });
  expect(result.text).toBe('{"world":true}');
  expect(onUsage.mock.calls[0][1].providerUsage).toMatchObject({ promptTokens: 50, completionTokens: 6, cachedTokens: 40 });
});
it('continues a truncated Gemini document using Gemini roles and stop reasons', async () => {
  const cfg = resolveAiRoleConfig('kei', { ...DEFAULT_SETTINGS, keiProviderId: 'gemini', keiModel: 'gemini-2.5-flash', keiEndpoint: 'https://generativelanguage.googleapis.com/v1beta', keiApiKey: 'fixture', keiEnableReasoning: false });
  const replies = [ { candidates: [{ content: { parts: [{ text: '{"name":' }] }, finishReason: 'MAX_TOKENS' }] }, { candidates: [{ content: { parts: [{ text: '"city"}' }] }, finishReason: 'STOP' }] } ];
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(`data: ${JSON.stringify(replies.shift())}\n\n`); }));
  expect(await streamCreationJSON(cfg, { messages: messages.slice(0, 2), max_tokens: 16000 }, vi.fn())).toBe('{"name":"city"}');
  expect(bodies[1].contents).toEqual([{ role: 'user', parts: [{ text: 'create' }] }, { role: 'model', parts: [{ text: '{"name":' }] }, { role: 'user', parts: [{ text: expect.stringContaining('剩余 JSON') }] }]);
});
it('preserves reported creation usage as actual rather than an estimate', () => {
  const cfg = resolveAiRoleConfig('kei');
  const usage = recordCreationUsage(cfg, 'kei', 'world_create', undefined, {
    elapsedMs: 20, promptChars: 999, completionChars: 3,
    providerUsage: { promptTokens: 50, completionTokens: 6, totalTokens: 56, cachedTokens: 40, cacheUsageReported: true, model: 'kei' },
  });
  expect(usage).toMatchObject({ promptTokens: 50, completionTokens: 6, totalTokens: 56, cachedTokens: 40, cacheUsageReported: true });
  expect(usage.usageEstimated).not.toBe(true);
});
