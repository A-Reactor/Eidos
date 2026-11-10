import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/world/plugins/review/route';
import { resourceWorld } from '../lib/game/gameplay-resource-fixtures';

const review = { summary: '检查完成，注意补给', findings: [{ pluginId: 'supplies', ruleId: 'eat', severity: 'suggestion', message: '需要补给路径', suggestion: '支持重复获取补给' }] };
const payload = () => ({ gameplayPlugins: resourceWorld().gameplayPlugins, _settings: { uzqApiKey: 'fake-key', uzqModel: 'uzq-only-model', reserveReasoningBudget: false } });
function request(body: unknown = payload(), headers = {}, signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/world/plugins/review', { method: 'POST', body: JSON.stringify(body), headers, signal });
}
const modelReply = (content = JSON.stringify(review)) => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('routes a standalone review through UZQ and returns genuine usage without modifying the manifest', async () => {
  const body = payload(), saved = JSON.stringify(body);
  const fetchModel = vi.fn(async (_url, init: RequestInit) => {
    const input = JSON.parse(String(init.body));
    expect(input.model).toBe('uzq-only-model');
    expect(input.messages[0].content).toContain('resourceChanges');
    return modelReply();
  });
  vi.stubGlobal('fetch', fetchModel);
  const response = await POST(request(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ review, usage: { model: 'uzq', callType: 'uzq_gameplay_design', totalTokens: 110, worldId: null, elapsedMs: expect.any(Number) } });
  expect(fetchModel).toHaveBeenCalledOnce();
  expect(JSON.stringify(body)).toBe(saved);
});
it.each(['{}', JSON.stringify({ summary: '坏引用', findings: [{ ...review.findings[0], ruleId: 'unknown' }] })])('preserves billed usage when design output is invalid: %s', async content => {
  vi.stubGlobal('fetch', vi.fn(async () => modelReply(content)));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ error: expect.any(String), usage: { model: 'uzq', totalTokens: 110, success: false, errorCode: 'invalid_response' } });
  expect(fetch).toHaveBeenCalledOnce();
});
it('retains known usage on thinking-only output failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => modelReply('')));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ usage: { totalTokens: 110, success: false, errorCode: 'empty_output' } });
});
it('rejects cross-site, empty, invalid plugins and non-object settings before any model call', async () => {
  vi.stubGlobal('fetch', vi.fn());
  expect((await POST(request(payload(), { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  for (const body of [{ gameplayPlugins: [] }, { gameplayPlugins: [{ script: 'run' }] }, { ...payload(), _settings: [] }, { ...payload(), _settings: { uzqApiKey: {} } }, { ...payload(), execute: true }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects a fifth concurrent review and releases capacity after cancellation', async () => {
  let started = 0;
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    started++; init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  })));
  const controls = Array.from({ length: 4 }, () => new AbortController());
  const pending = controls.map(c => POST(request(payload(), {}, c.signal)));
  await vi.waitFor(() => expect(started).toBe(4));
  expect((await POST(request())).status).toBe(429);
  controls.forEach(c => c.abort());
  expect((await Promise.all(pending)).every(response => response.status === 499)).toBe(true);
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()));
  expect((await POST(request())).status).toBe(200);
});
it('cancels the transport at the total deadline with no automatic retry', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init.signal as AbortSignal;
    signal.addEventListener('abort', () => reject(signal!.reason), { once: true });
  })));
  const pending = POST(request());
  await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
  await vi.advanceTimersByTimeAsync(120_000);
  expect((await pending).status).toBe(504);
  expect(signal!.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});

it('reviews a large imported presentation package without an HTTP body-size rejection', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => modelReply()));
  const body = payload(); body.gameplayPlugins![0].ui = { reading: 'replace', html: '<main>' + '界面'.repeat(200000) + '</main>' };
  expect((await POST(request(body))).status).toBe(200);
  expect(fetch).toHaveBeenCalledOnce();
});
