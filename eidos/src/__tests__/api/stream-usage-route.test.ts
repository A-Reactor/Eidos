import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/game/action/stream/route';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
vi.mock('@/lib/ai/action-stream', () => ({ processPlayerActionStream: vi.fn() }));
beforeEach(() => { vi.mocked(processPlayerActionStream).mockReset(); });
function actionRequest(signal?: AbortSignal) {
  const { world, snapshot } = buildRiftCityStartState();
  return new NextRequest('http://localhost/api/game/action/stream', { method: 'POST', signal,
    body: JSON.stringify({ playerInput: '观察', world, snapshot }) });
}
it('forwards activity without thought text and preserves the quota error code', async () => {
  vi.mocked(processPlayerActionStream).mockImplementation(async options => {
    options.callbacks.onActivity?.({ phase: 'thinking', elapsedMs: 20, reasoningChars: 12 });
    options.callbacks.onError?.(Object.assign(new Error('额度已耗尽'), { code: 'output_limit' }));
  });
  const response = await POST(actionRequest());
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  expect(events).toEqual([{ type: 'activity', phase: 'thinking', elapsedMs: 20, reasoningChars: 12 },
    { type: 'error', code: 'output_limit', message: '额度已耗尽' }]);
});
it.each(['request', 'reader'])('cancels model generation when %s is cancelled', async origin => {
  let modelSignal: AbortSignal | undefined;
  vi.mocked(processPlayerActionStream).mockImplementation(async options => { modelSignal = options.signal; });
  const cancellation = new AbortController();
  const response = await POST(actionRequest(cancellation.signal));
  expect(modelSignal).toBeInstanceOf(AbortSignal);
  if (origin === 'request') cancellation.abort();
  else await response.body!.getReader().cancel();
  expect(modelSignal!.aborted).toBe(true);
});
it('sends received billing before the error event without a successful done', async () => {
  const usage = { model: 'alice' as const, promptTokens: 1000, completionTokens: 10, totalTokens: 1010, success: false };
  vi.mocked(processPlayerActionStream).mockImplementation(async options => { options.callbacks.onUsage?.(usage); options.callbacks.onError?.(new Error('disconnected')); });
  const { world, snapshot } = buildRiftCityStartState();
  const result = await POST(new NextRequest('http://localhost/api/game/action/stream', { method: 'POST', body: JSON.stringify({ playerInput: '观察', world, snapshot }) }));
  const events = (await result.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  expect(events.map(e => e.type)).toEqual(['usage', 'error']); expect(events[0].usage).toEqual(usage);
});
