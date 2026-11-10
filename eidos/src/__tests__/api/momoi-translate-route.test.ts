import { beforeEach, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/client', () => ({ callAi: call }));
import { POST } from '@/app/api/momoi/translate/route';
const body = { text: '明天见。', speaker: '甲', emotion: 'happy', _settings: { aliceApiKey: 'test' } };
const send = (input: unknown, headers = {}) => POST(new Request('http://localhost/api/momoi/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) }));
beforeEach(() => { call.mockReset(); });
it('builds target-language-specific GPT-SoVITS dubbing instructions and rejects unsupported targets', async () => {
  call.mockResolvedValue({ content: 'See you tomorrow.', usage: {} });
  expect((await send({ ...body, targetLanguage: 'en' })).status).toBe(200);
  const prompt = call.mock.calls[0][0].systemPrompt;
  expect(prompt).toContain('英语');
  expect(prompt).toContain('GPT-SoVITS');
  expect(prompt).toContain('数字');
  expect(prompt).not.toContain('只返回日语');
  expect((await send({ ...body, targetLanguage: 'fr' })).status).toBe(400);
  expect(call).toHaveBeenCalledTimes(1);
});
it('translates through ALICE with cancellation, accounting and no automatic paid retries', async () => {
  call.mockResolvedValue({ content: 'また明日。', usage: { totalTokens: 12 } });
  const response = await send(body);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ text: 'また明日。', usage: { totalTokens: 12 } });
  expect(call.mock.calls[0][0]).toMatchObject({ role: 'alice', noRetry: true, callType: 'voice_japanese_translation', settingsOverride: { aliceApiKey: 'test' } });
  expect(call.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
});
it('rejects invalid bodies and cross-origin requests before any model call; reports upstream failures', async () => {
  expect((await send({ ...body, text: '' })).status).toBe(400);
  expect((await send({ ...body, _settings: { keiApiKey: 'wrong' } })).status).toBe(400);
  expect((await send(body, { origin: 'https://foreign.test' })).status).toBe(403);
  expect((await send(body, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect(call).not.toHaveBeenCalled();
  call.mockRejectedValue(new Error('模型不可用'));
  expect((await send(body)).status).toBe(502); expect(call).toHaveBeenCalledTimes(1);
});
it('caps concurrent translations and releases capacity after a failure', async () => {
  let finish!: (value: unknown) => void;
  const wait = new Promise(resolve => { finish = resolve; });
  call.mockImplementation(() => wait);
  const pending = Array.from({ length: 4 }, () => send(body));
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(4));
  expect((await send(body)).status).toBe(429);
  finish({ content: 'また明日。', usage: {} });
  expect((await Promise.all(pending)).every(r => r.status === 200)).toBe(true);
  expect((await send(body)).status).toBe(200);
});
