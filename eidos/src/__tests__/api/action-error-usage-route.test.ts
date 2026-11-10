import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(options: { signal?: AbortSignal; introspection?: boolean } = {}) {
  const { world, snapshot } = buildRiftCityStartState();
  return new NextRequest('http://localhost/api/game/action', { method: 'POST', signal: options.signal,
    body: JSON.stringify({ playerInput: '观察', world, snapshot, introspection: options.introspection, _settings: { aliceApiKey: 'fake-key' } }) });
}
it('returns known paid usage with an empty completion failure without repeating the model request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 10, completion_tokens: 8000, total_tokens: 8010, completion_tokens_details: { reasoning_tokens: 8000 } } }));
  vi.stubGlobal('fetch', fetchMock);
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'output_limit', _tokenUsage: {
    totalTokens: 8010, reasoningTokens: 8000, outputChars: 0, finishReason: 'length', errorCode: 'output_limit', success: false } });
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(['{}', 'null', '{"segments":[]}', '{"segments":[{"type":"narration","text":"   "}]}'])('rejects narrative-free action JSON %s while retaining known usage', async content => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'empty_output', _tokenUsage: { totalTokens: 12, success: false, errorCode: 'empty_output' } });
});
it('rejects narrative-free introspection without inventing a successful reply', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })));
  const response = await POST(request({ introspection: true }));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'empty_output', _tokenUsage: { totalTokens: 12, success: false } });
});
it('propagates ordinary action cancellation to the model and does not retry it', async () => {
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal as AbortSignal;
    signal?.addEventListener('abort', () => reject(signal!.reason), { once: true });
  }));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const result = POST(request({ signal: controller.signal }));
  await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  controller.abort();
  expect(signal!.aborted).toBe(true);
  await result;
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(['json', 'sse'])('keeps partial action recovery when prose exists in %s', async mode => {
  const content = '{"segments":[{"type":"narration","text":"夕阳沉入河岸。"}],"timeSpent":{"day":0,"hour":4,"minute":0},"itemsGained":[';
  const usage = { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 };
  const reply = mode === 'json' ? Response.json({ choices: [{ message: { content }, finish_reason: 'length' }], usage })
    : new Response('data: '+JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'length' }], usage })+'\n\n');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply));
  const response = await (mode === 'json' ? POST : stream)(request());
  if (mode === 'json') {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ segments: [{ text: '夕阳沉入河岸。' }], _tokenUsage: { totalTokens: 110 } });
  } else {
    const events=(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
    expect(events.some(e=>e.type==='done')).toBe(true);
    expect(events.some(e=>e.type==='error')).toBe(false);
  }
});
it('sends failure billing then error for narrative-free stream JSON, without a successful done', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: '+JSON.stringify({
    choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  })+'\n\n')));
  const response = await stream(request());
  const events=(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  expect(events.some(e=>e.type==='done')).toBe(false);
  expect(events.filter(e=>e.type==='usage')).toHaveLength(1);
  expect(events.at(-2)).toMatchObject({type:'usage',usage:{totalTokens:12,success:false,errorCode:'empty_output'}});
  expect(events.at(-1)).toMatchObject({type:'error',code:'empty_output'});
});
