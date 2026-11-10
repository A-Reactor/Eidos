import { afterEach, expect, it, vi } from 'vitest';
import { buildEngineContext } from '@/lib/engine';
import { createProviderNarrator } from '@/lib/ai/engine-narrator';
import type { AiRoleConfig } from '@/lib/ai/providers/types';
import { courtyardWorld } from './fixtures';

const config: AiRoleConfig = { providerId: 'custom', protocol: 'openai-compatible', baseUrl: 'https://model.invalid/v1', apiKey: 'private-model-key', model: 'game-model', compatibilityMode: 'openai', enableReasoning: false, reasoningEffort: 'low' };
const input = () => ({ context: buildEngineContext({ id: 'game', revision: 2, world: courtyardWorld(), turns: [], receipts: [{ id: 'r', source: 'door', status: 'failed', message: '钥匙断了', output: { broken: true } }] }), input: { text: '描述实际结果' } });
const reply = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
afterEach(() => vi.unstubAllGlobals());

it('uses existing provider adapters with real host results and request-local usage', async () => {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('game-model');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer private-model-key');
    expect(body.messages[0].content).toContain('钥匙断了');
    expect(body.messages[0].content).not.toContain('private-model-key');
    return reply(JSON.stringify({ segments: [{ type: 'dialogue', speakerId: 'guide', text: '钥匙断了，门仍锁着。' }] }));
  });
  const result = await createProviderNarrator({ config }).generate(input());
  expect(result).toMatchObject({ segments: [{ speakerId: 'guide' }], usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, model: 'game-model' } });
});

it.each(['{}', JSON.stringify({ segments: [{ type: 'narration', text: '成功' }], state: { keys: 0 } }), JSON.stringify({ segments: [], commands: [{ commandId: 'travel' }] })])('retains paid usage when rejecting unauthorized or invalid model output: %s', async content => {
  let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return reply(content); });
  await expect(createProviderNarrator({ config }).generate(input())).rejects.toMatchObject({ code: 'invalid_proposal', usage: { totalTokens: 110 } });
  expect(calls).toBe(1);
});
