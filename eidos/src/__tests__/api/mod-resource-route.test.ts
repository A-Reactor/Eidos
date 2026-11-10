import { beforeEach, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/client', () => ({ callAi: call }));
import { POST } from '@/app/api/game/mod-resource/route';
const body = { resource: { name: 'evidence.png', mimeType: 'image/png', base64: 'aGVsbG8=' }, task: '描述直接可见事实', _settings: { uzqProviderId: 'openai', uzqApiKey: 'test' } };
beforeEach(() => { call.mockReset(); });
const send = (input: unknown) => POST(new Request('http://localhost/api/game/mod-resource', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
it('uses independent UZQ with actual media, cancellation, and no automatic paid retry', async () => {
  call.mockResolvedValue({ content: '材料中有一条线。', usage: { totalTokens: 12 } });
  const response = await send(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ content: '材料中有一条线。', usage: { totalTokens: 12 } });
  expect(call.mock.calls[0][0]).toMatchObject({ role: 'uzq', noRetry: true, media: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }], callType: 'uzq_mod_resource' });
  expect(call.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
});
it('returns input errors before calling a model and reports failed tasks explicitly', async () => {
  expect((await send({ ...body, resource: { ...body.resource, base64: 'not base64' } })).status).toBe(400);
  expect((await send({ ...body, resource: { name: 'sound.mp3', mimeType: 'audio/mpeg', base64: 'aGVsbG8=' } })).status).toBe(400);
  expect((await send({ ...body, _settings: { aliceApiKey: 'foreign-role' } })).status).toBe(400);
  expect(call).not.toHaveBeenCalled();
  call.mockRejectedValue(new Error('unsupported model input'));
  const failure = await send(body);
  expect(failure.status).toBe(502); expect((await failure.json()).error).toBe('unsupported model input');
});

it('accepts the UZQ numeric window setting while rejecting invalid values', async () => {
  call.mockResolvedValue({ content: '内容', usage: {} });
  expect((await send({ ...body, _settings: { ...body._settings, uzqContextWindowTokens: 0 } })).status).toBe(200);
  expect((await send({ ...body, _settings: { uzqContextWindowTokens: -1 } })).status).toBe(400);
});
