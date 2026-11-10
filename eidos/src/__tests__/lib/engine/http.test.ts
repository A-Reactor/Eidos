import { expect, it } from 'vitest';
import { buildEngineContext, createHttpNarrator } from '@/lib/engine';
import { courtyardWorld } from './fixtures';

const input = () => ({ context: buildEngineContext({ id: 'client', revision: 2, world: courtyardWorld(), turns: [], receipts: [] }), input: { text: '看门' } });
const proposal = { segments: [{ type: 'narration', text: '门还锁着。' }] };
it('sends the portable context and validates the returned session and revision', async () => {
  const client = createHttpNarrator({ url: 'http://localhost/api/engine/v1/narrate', token: 'game-token', fetch: async (_url, init) => {
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer game-token');
    expect(JSON.parse(String(init?.body))).toMatchObject({ version: 1, context: { sessionId: 'client', revision: 2 }, input: { text: '看门' } });
    return Response.json({ version: 1, sessionId: 'client', revision: 2, proposal, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
  } });
  expect(await client.generate(input())).toMatchObject({ ...proposal, usage: { totalTokens: 14 } });
});
it.each([{ sessionId: 'another', revision: 2 }, { sessionId: 'client', revision: 3 }, { sessionId: 'client', revision: 2, version: 2 }])('rejects mismatched narrative envelopes: %j', async override => {
  const client = createHttpNarrator({ url: 'http://localhost/narrate', fetch: async () => Response.json(Object.assign({ version: 1, sessionId: 'client', revision: 2, proposal }, override)) });
  await expect(client.generate(input())).rejects.toMatchObject({ code: 'invalid_response' });
});
it('retains structured error and actual usage without retrying a billed request', async () => {
  let calls = 0;
  const client = createHttpNarrator({ url: 'http://localhost/narrate', fetch: async () => {
    calls++; return Response.json({ error: { code: 'invalid_proposal', message: 'Invalid model output' }, usage: { inputTokens: 100, outputTokens: 2, totalTokens: 102 } }, { status: 502 });
  } });
  await expect(client.generate(input())).rejects.toMatchObject({ code: 'invalid_proposal', status: 502, usage: { totalTokens: 102 } });
  expect(calls).toBe(1);
});
it('does not dispatch an already canceled request', async () => {
  let calls = 0; const control = new AbortController(); control.abort();
  const client = createHttpNarrator({ url: 'http://localhost/narrate', fetch: async () => { calls++; return Response.json({}); } });
  await expect(client.generate(input(), { signal: control.signal })).rejects.toMatchObject({ code: 'aborted' });
  expect(calls).toBe(0);
});
it('normalizes non-contract server errors as HTTP errors', async () => {
  const client = createHttpNarrator({ url: 'http://localhost/narrate', fetch: async () => Response.json({ error: 'upstream unavailable' }, { status: 502 }) });
  await expect(client.generate(input())).rejects.toMatchObject({ code: 'invalid_response', status: 502 });
});
it.each([200, 502])('retains HTTP metadata when remote usage is malformed (HTTP %s)', async status => {
  const client = createHttpNarrator({ url: 'http://localhost/narrate', fetch: async () => Response.json({ version: 1, sessionId: 'client', revision: 2, proposal,
    error: { code: 'provider_error', message: 'bad usage' }, usage: { inputTokens: -1, outputTokens: 1, totalTokens: 0 } }, { status }) });
  await expect(client.generate(input())).rejects.toMatchObject({ code: 'invalid_response', status });
});
