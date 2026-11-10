import { afterEach, expect, it, vi } from 'vitest';
import { requestActionContinuation } from '@/lib/game/action-continuation-stream';
afterEach(() => vi.unstubAllGlobals());
const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
it('delivers provisional segments before done and reconstructs the final SSE response', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } })));
  const onSegments = vi.fn(), onActivity = vi.fn(); let settled = false;
  const task = requestActionContinuation({ body: { playerInput: '行动' }, streaming: true, onSegments, onActivity }).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(stream).toBeTruthy());
  stream.enqueue(event({ type: 'activity', phase: 'thinking', elapsedMs: 1, reasoningChars: 20 }));
  const bytes = event({ type: 'segments', segments: [{ type: 'narration', text: '她拿起纸张。' }], lastIsDraft: true });
  stream.enqueue(bytes.slice(0, 12)); stream.enqueue(bytes.slice(12));
  await vi.waitFor(() => expect(onSegments).toHaveBeenCalled()); expect(settled).toBe(false);
  stream.enqueue(event({ type: 'done', summary: '检查', timeSpent: { day: 0, hour: 0, minute: 0 } })); stream.close();
  const { response } = await task;
  expect(response.segments?.[0].text).toBe('她拿起纸张。'); expect(onActivity.mock.calls[0][0].phase).toBe('thinking');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/game/action/stream');
});
it('records an emitted usage once and identifies it on the completed response', async () => {
  const usage = { promptTokens: 10, completionTokens: 3, totalTokens: 13, elapsedMs: 20, model: 'alice' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(event({ type: 'usage', usage })); c.enqueue(event({ type: 'done', segments: [], _tokenUsage: usage })); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } })));
  const onUsage = vi.fn(); const result = await requestActionContinuation({ body: {}, streaming: true, onUsage });
  expect(result.usageRecorded).toBe(true); expect(onUsage).toHaveBeenCalledOnce();
});
it('accepts legacy JSON without an extra request and rejects incomplete SSE without retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ segments: [{ type: 'narration', text: '正文' }] })).mockResolvedValueOnce(new Response('data: {"type":"progress","charsReceived":1}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetcher);
  expect((await requestActionContinuation({ body: {}, streaming: false })).response.segments?.[0].text).toBe('正文');
  await expect(requestActionContinuation({ body: {}, streaming: true })).rejects.toThrow('完整'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps known billing when an abort occurs and never accepts an error as a terminal action', async () => {
  const abort = new AbortController(), onUsage = vi.fn(() => abort.abort());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(event({ type: 'usage', usage: { totalTokens: 13 } })); } }), { headers: { 'Content-Type': 'text/event-stream' } })));
  await expect(requestActionContinuation({ body: {}, streaming: true, signal: abort.signal, onUsage })).rejects.toMatchObject({ name: 'AbortError' }); expect(onUsage).toHaveBeenCalledOnce();
});

it('preserves billed usage on an HTTP error without retrying', async () => {
  const usage = { model: 'alice', totalTokens: 17, promptTokens: 10, completionTokens: 7 };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: '生成中断', _tokenUsage: usage }, { status: 500 })));
  const onUsage = vi.fn();
  await expect(requestActionContinuation({ body: {}, streaming: true, onUsage })).rejects.toThrow('生成中断');
  expect(onUsage).toHaveBeenCalledWith(usage); expect(fetch).toHaveBeenCalledOnce();
});
it('accounts known JSON usage before a late abort and does not pass already-recorded pending charges onward', async () => {
  const usage = { model: 'alice', totalTokens: 17 }, pending = { model: 'kei', totalTokens: 5 };
  const onUsage = vi.fn(), abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { const response = Response.json({ _tokenUsage: usage, _pendingKeyTokens: [pending] }); response.json = async () => { abort.abort(); return { _tokenUsage: usage, _pendingKeyTokens: [pending] }; }; return response; }));
  await expect(requestActionContinuation({ body: {}, streaming: false, signal: abort.signal, onUsage })).rejects.toMatchObject({ name: 'AbortError' });
  expect(onUsage).toHaveBeenCalledTimes(2);
});

it('preserves terminal usage when done arrives before an abort and the stream never reaches EOF', async () => {
  const usage = { model: 'alice', totalTokens: 17 }, abort = new AbortController();
  const onUsage = vi.fn(() => abort.abort());
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(event({ type: 'done', segments: [], _tokenUsage: usage })); } }), { headers: { 'Content-Type': 'text/event-stream' } })));
  await expect(requestActionContinuation({ body: {}, streaming: true, signal: abort.signal, onUsage })).rejects.toMatchObject({ name: 'AbortError' });
  expect(onUsage).toHaveBeenCalledWith(usage); expect(onUsage).toHaveBeenCalledOnce();
});
