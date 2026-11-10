import { afterEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/game/web/route';
import { requestPublicText } from '@/lib/server/public-web';
vi.mock('@/lib/server/public-web', () => ({ requestPublicText: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const request = (method: string, params: unknown, origin?: string) => new Request('http://localhost/api/game/web', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ method, params }),
});
it('returns real search titles, links and snippets without requiring a model key', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'bing');
  vi.mocked(requestPublicText).mockResolvedValue({ url: 'https://cn.bing.com/search', contentType: 'text/xml', text:
    '<rss><channel><item><title>TypeScript &amp; JavaScript</title><link>https://www.typescriptlang.org/</link><description>Official &lt;b&gt;documentation&lt;/b&gt;</description></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>' });
  const result = await (await POST(request('web.search', { query: 'TypeScript 官方文档', count: 1 }))).json();
  expect(result.status).toBe('completed');
  expect(result.result.results).toEqual([{ title: 'TypeScript & JavaScript', url: 'https://www.typescriptlang.org/', snippet: 'Official documentation' }]);
  const url = new URL(vi.mocked(requestPublicText).mock.calls[0][0]);
  expect(url.searchParams.get('q')).toBe('TypeScript 官方文档');
});
it('supports DuckDuckGo result links and identifies a challenge as failure', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'duckduckgo');
  vi.mocked(requestPublicText).mockResolvedValue({ url: 'https://html.duckduckgo.com/html/', contentType: 'text/html', text:
    '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Docs</a><div class="result__snippet">A result</div></div>' });
  let result = await (await POST(request('web.search', { query: 'docs' }))).json();
  expect(result.result.results[0].url).toBe('https://example.com/docs');
  vi.mocked(requestPublicText).mockResolvedValue({ url: 'https://html.duckduckgo.com/html/', contentType: 'text/html', text: '<form id="challenge-form">Bot challenge</form>' });
  result = await (await POST(request('web.search', { query: 'docs' }))).json();
  expect(result.status).toBe('failed');
  expect(result.error).toContain('验证');
});
it('extracts visible article text and paginates it without scripts or navigation', async () => {
  vi.mocked(requestPublicText).mockResolvedValue({ url: 'https://example.com/final', contentType: 'text/html', text:
    `<html><head><title>Document</title><style>hidden-style</style></head><body><nav>hidden-menu</nav><main><script>hidden-script</script><p>${'正'.repeat(12005)}</p><p>结尾</p></main></body></html>` });
  const first = await (await POST(request('web.open', { url: 'https://example.com/' }))).json();
  expect(first.result).toMatchObject({ title: 'Document', url: 'https://example.com/final', nextOffset: 12000 });
  expect(first.result.text).toBe('正'.repeat(12000));
  const next = await (await POST(request('web.open', { url: 'https://example.com/final', offset: 12000 }))).json();
  expect(next.result.text).toContain('结尾');
  expect(next.result.nextOffset).toBeNull();
});
it('does not call the network for cross-origin requests or non-web methods', async () => {
  expect((await POST(request('web.search', { query: 'docs' }, 'https://untrusted.example'))).status).toBe(403);
  expect((await POST(request('files.read', { path: 'x' }))).status).toBe(400);
  expect(requestPublicText).not.toHaveBeenCalled();
});
it('returns upstream failure as a failed receipt rather than a completed empty search', async () => {
  vi.mocked(requestPublicText).mockRejectedValue(new Error('网页请求失败：ECONNRESET'));
  const result = await (await POST(request('web.search', { query: 'docs' }))).json();
  expect(result).toMatchObject({ method: 'web.search', status: 'failed', error: expect.stringContaining('ECONNRESET') });
});
