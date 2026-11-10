import { afterEach, expect, it, vi } from 'vitest';
import { executeWebTool } from '@/lib/server/web-tools';
import { requestPublicText } from '@/lib/server/public-web';
import type { AiRoleConfig } from '@/lib/ai/providers/types';
vi.mock('@/lib/server/public-web', () => ({ requestPublicText: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
const config: AiRoleConfig = { providerId: 'deepseek', protocol: 'deepseek-native', model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'request-scoped-key', compatibilityMode: 'native', enableReasoning: true, reasoningEffort: 'high' };

it('uses the active DeepSeek credential and official search endpoint with model-readable summaries', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'auto');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ title: 'Official', url: 'https://example.com/',
    snippet: 'Short', summary: 'Detailed explanation for the model', content: '', date: '2026-11-02T00:00:00Z' }] }));
  vi.stubGlobal('fetch', fetcher);
  const receipt = await executeWebTool({ method: 'web.search', params: { query: 'official docs', count: 3 } }, undefined, config);
  expect(receipt.status).toBe('completed');
  expect(receipt.result).toMatchObject({ provider: 'deepseek', results: [{ summary: 'Detailed explanation for the model' }] });
  expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/search');
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer request-scoped-key');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ query: 'official docs', count: 3, need_content: false });
  expect(requestPublicText).not.toHaveBeenCalled();
});
it('reads provider-returned Markdown and paginates it without local site scraping', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'auto');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ title: 'Official page', content: '# Heading\n' + '正文'.repeat(7000) }));
  vi.stubGlobal('fetch', fetcher);
  const receipt = await executeWebTool({ method: 'web.open', params: { url: 'https://example.com/page', offset: 12000 } }, undefined, config);
  expect(receipt.status).toBe('completed');
  expect(receipt.result).toMatchObject({ provider: 'deepseek', title: 'Official page', nextOffset: null, totalChars: 14010 });
  expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/tools/fetch');
  expect(requestPublicText).not.toHaveBeenCalled();
});
it('returns provider authentication failure without silently retrying or scraping another service', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'auto');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }));
  vi.stubGlobal('fetch', fetcher);
  const receipt = await executeWebTool({ method: 'web.search', params: { query: 'docs' } }, undefined, config);
  expect(receipt).toMatchObject({ status: 'failed', error: expect.stringContaining('401') });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(requestPublicText).not.toHaveBeenCalled();
});
it('never forwards another vendor key to the DeepSeek search endpoint', async () => {
  vi.stubEnv('WEB_SEARCH_PROVIDER', 'deepseek'); vi.stubEnv('DEEPSEEK_API_KEY', '');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const receipt = await executeWebTool({ method: 'web.search', params: { query: 'docs' } }, undefined,
    { ...config, providerId: 'openai', protocol: 'openai-native', baseUrl: 'https://api.openai.com/v1', apiKey: 'different-vendor-key' });
  expect(receipt.status).toBe('failed');
  expect(fetcher).not.toHaveBeenCalled();
});
