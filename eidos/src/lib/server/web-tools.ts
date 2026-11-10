import { load } from 'cheerio';
import { requestPublicText } from './public-web';
import type { WebToolRequest } from '@/lib/game/web-tools';
import type { ActionOperationReceipt } from '@/lib/game/action-operations';
import type { AiRoleConfig } from '@/lib/ai/providers/types';
import { deepseekSearchKey, executeDeepSeekWeb } from './deepseek-web';

function httpLink(value: string): string | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const plain = (value: string) => load(value).text().replace(/\s+/g, ' ').trim();

async function search(query: string, count: number, signal?: AbortSignal) {
  const provider = process.env.WEB_SEARCH_PROVIDER === 'duckduckgo' ? 'duckduckgo' : 'bing';
  const url = new URL(provider === 'bing' ? 'https://cn.bing.com/search' : 'https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  if (provider === 'bing') url.searchParams.set('format', 'rss');
  const page = await requestPublicText(url.href, signal);
  const $ = load(page.text, { xml: provider === 'bing' });
  const results: { title: string; url: string; snippet: string }[] = [];
  if (provider === 'bing' && !$('rss').length || provider === 'duckduckgo' && ($('#challenge-form').length || /anomaly\.js/.test(page.text))) throw new Error('搜索服务返回验证页面，未取得搜索结果');
  $(provider === 'bing' ? 'item' : '.result').each((_index, element) => {
    const item = $(element), anchor = item.find('.result__a');
    let link = provider === 'bing' ? item.find('link').text() : anchor.attr('href') ?? '';
    if (provider === 'duckduckgo' && link) {
      const redirected = new URL(link, url);
      link = redirected.hostname === 'duckduckgo.com' ? redirected.searchParams.get('uddg') ?? redirected.href : redirected.href;
    }
    const target = httpLink(link);
    const title = plain(provider === 'bing' ? item.find('title').text() : anchor.text()).slice(0, 300);
    if (!target || !title || results.some(result => result.url === target) || results.length >= count) return;
    results.push({ title, url: target, snippet: plain(provider === 'bing' ? item.find('description').text() : item.find('.result__snippet').text()).slice(0, 1200) });
  });
  if (provider === 'duckduckgo' && !results.length && !$('.no-results').length && !/No results found/i.test(page.text)) throw new Error('搜索服务返回了无法识别的页面');
  return { provider, query, results, retrievedAt: new Date().toISOString() };
}
async function open(url: string, offset: number, signal?: AbortSignal) {
  const page = await requestPublicText(url, signal);
  let title = page.url, text = page.text;
  if (/html/i.test(page.contentType)) {
    const $ = load(text);
    title = $('title').first().text().trim().slice(0, 300) || title;
    $('script,style,noscript,template,svg,nav,header,footer,form,[hidden],[aria-hidden="true"]').remove();
    $('p,div,section,article,li,h1,h2,h3,h4,br,tr').append('\n');
    const main = $('main').first(), article = $('article').first();
    text = (main.length ? main : article.length ? article : $('body')).text();
  }
  text = text.replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = text.length > 120000;
  text = text.slice(0, 120000);
  if (offset > text.length) throw new Error(`网页偏移超出正文范围（${text.length}字符）`);
  return { url: page.url, title, text: text.slice(offset, offset + 12000), offset, totalChars: text.length,
    nextOffset: offset + 12000 < text.length ? offset + 12000 : null, truncated, retrievedAt: new Date().toISOString() };
}
export async function executeWebTool(request: WebToolRequest, signal?: AbortSignal, config?: AiRoleConfig): Promise<ActionOperationReceipt> {
  try {
    const provider = process.env.WEB_SEARCH_PROVIDER || 'auto';
    if (!['auto', 'deepseek', 'bing', 'duckduckgo'].includes(provider)) throw new Error('WEB_SEARCH_PROVIDER 须为 auto、deepseek、bing 或 duckduckgo');
    const key = deepseekSearchKey(config);
    const result = provider === 'deepseek' || provider === 'auto' && key ? await executeDeepSeekWeb(request, key, signal)
      : request.method === 'web.search' ? await search(request.params.query, request.params.count ?? 5, signal)
        : await open(request.params.url, request.params.offset ?? 0, signal);
    signal?.throwIfAborted();
    return { method: request.method, status: 'completed', result };
  } catch (error) {
    signal?.throwIfAborted();
    return { method: request.method, status: 'failed', error: error instanceof Error ? error.message : '联网读取失败' };
  }
}
