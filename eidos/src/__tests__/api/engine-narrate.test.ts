import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/engine/v1/narrate/route';
import { buildEngineContext } from '@/lib/engine';
import { courtyardWorld } from '../lib/engine/fixtures';

const payload = () => ({ version: 1, context: buildEngineContext({ id: 'native-game', revision: 0, world: courtyardWorld(), turns: [], receipts: [] }), input: { text: '用钥匙开门' } });
function request(body: unknown = payload(), token = 'engine-test', signal?: AbortSignal, headers = {}) {
  return new Request('http://localhost/api/engine/v1/narrate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body), signal });
}
const reply = (content = JSON.stringify({ segments: [], commands: [{ commandId: 'unlock', args: { key: 'brass' } }] })) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
beforeEach(() => {
  vi.stubEnv('EIDOS_ENGINE_TOKEN', 'engine-test'); vi.stubEnv('EIDOS_ENGINE_API_KEY', 'server-key');
  vi.stubEnv('EIDOS_ENGINE_PROVIDER', 'custom-openai-compatible'); vi.stubEnv('EIDOS_ENGINE_MODEL', 'developer-model');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it('returns a correlated versioned proposal without executing game logic', async () => {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body)).model).toBe('developer-model');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-key');
    return reply();
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ version: 1, sessionId: 'native-game', revision: 0, proposal: { commands: [{ commandId: 'unlock' }] }, usage: { totalTokens: 120 } });
  expect(payload().context.world.state.keys).toBe(1);
});
it('requires explicit server configuration and bearer authentication', async () => {
  expect((await POST(request(payload(), 'wrong'))).status).toBe(401);
  vi.stubEnv('EIDOS_ENGINE_TOKEN', '');
  expect((await POST(request())).status).toBe(503);
});
it('rejects client-side credential overrides and invalid game references', async () => {
  const invalid = payload(); invalid.context.scene.id = 'missing';
  for (const body of [{ ...payload(), _settings: { aliceApiKey: 'client-key' } }, { ...payload(), version: 2 }, invalid]) {
    const response = await POST(request(body)); expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: expect.any(String), message: expect.any(String) } });
  }
  expect((await POST(request(payload(), 'engine-test', undefined, { 'content-length': String(3 * 1024 * 1024) }))).status).toBe(413);
});
it('preserves actual usage for invalid model output and never retries it', async () => {
  let calls = 0; vi.stubGlobal('fetch', async () => { calls++; return reply('{}'); });
  const response = await POST(request()); expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: { code: 'invalid_proposal' }, usage: { totalTokens: 120 } });
  expect(calls).toBe(1);
});
it('limits active requests and frees capacity after cancellation', async () => {
  let started = 0;
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    started++; init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  const controls = Array.from({ length: 4 }, () => new AbortController());
  const pending = controls.map(c => POST(request(payload(), 'engine-test', c.signal)));
  await vi.waitFor(() => expect(started).toBe(4));
  expect((await POST(request())).status).toBe(429);
  controls.forEach(c => c.abort());
  expect((await Promise.all(pending)).map(r => r.status)).toEqual([499, 499, 499, 499]);
  vi.stubGlobal('fetch', async () => reply()); expect((await POST(request())).status).toBe(200);
});
it('cancels a request at the total deadline', async () => {
  vi.useFakeTimers(); let started = false;
  vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    started = true; init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  const pending = POST(request());
  await vi.waitFor(() => expect(started).toBe(true));
  await vi.advanceTimersByTimeAsync(90_000);
  expect((await pending).status).toBe(504);
});
it('includes a stalled request body in the total deadline and cancels its reader', async () => {
  vi.useFakeTimers(); let canceled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
  const slow = new Request('http://localhost/api/engine/v1/narrate', { method: 'POST', headers: { Authorization: 'Bearer engine-test' }, body, duplex: 'half' } as RequestInit);
  const pending = POST(slow);
  await vi.advanceTimersByTimeAsync(90_000);
  const response = await Promise.race([pending, Promise.resolve(null)]);
  expect(response?.status).toBe(504);
  expect(canceled).toBe(true);
});
