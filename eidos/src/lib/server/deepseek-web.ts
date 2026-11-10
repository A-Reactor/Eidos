import type { AiRoleConfig } from '@/lib/ai/providers/types';
import type { WebToolRequest } from '@/lib/game/web-tools';

export function deepseekSearchKey(config?: AiRoleConfig): string {
  // Search is a separate vendor API; never send another provider's key to it.
  if (config?.providerId === 'deepseek' && new URL(config.baseUrl).origin === 'https://api.deepseek.com') return config.apiKey;
  return process.env.DEEPSEEK_API_KEY ?? '';
}
async function providerJson(path: 'search' | 'fetch', body: Record<string, unknown>, key: string, parent?: AbortSignal): Promise<Record<string, unknown>> {
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
  const response = await fetch(`https://api.deepseek.com/v1/tools/${path}`, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('厂商联网工具结果超过读取上限');
  let data: Record<string, unknown>;
  try { data = JSON.parse(text); } catch { throw new Error(`DeepSeek ${path} 返回非JSON结果（HTTP ${response.status}）`); }
  if (!response.ok) {
    const detail = (data.error as { message?: unknown })?.message;
    const message = typeof detail === 'string' ? detail.replaceAll(key, '[redacted]').slice(0, 300) : response.statusText;
    throw new Error(`DeepSeek ${path} HTTP ${response.status}：${message}`);
  }
  return data;
}
function link(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export async function executeDeepSeekWeb(request: WebToolRequest, key: string, signal?: AbortSignal): Promise<unknown> {
  if (!key) throw new Error('DeepSeek联网搜索未配置凭据，请填写DeepSeek模型Key或DEEPSEEK_API_KEY');
  const retrievedAt = new Date().toISOString();
  if (request.method === 'web.search') {
    if ([...request.params.query].length > 128) throw new Error('DeepSeek搜索词上限128字符，请拆分为简短关键词后重试');
    const data = await providerJson('search', { query: request.params.query, count: request.params.count ?? 5, need_content: false }, key, signal);
    if (!Array.isArray(data.results)) throw new Error('DeepSeek搜索结果缺少results数组');
    const results = data.results.slice(0, request.params.count ?? 5).flatMap(raw => {
      const url = link(raw?.url);
      if (!url || typeof raw.title !== 'string' || typeof raw.snippet !== 'string') return [];
      return [{ title: raw.title.slice(0, 300), url, snippet: raw.snippet.slice(0, 1200),
        ...(typeof raw.summary === 'string' ? { summary: raw.summary.slice(0, 4000) } : {}),
        ...(typeof raw.date === 'string' ? { date: raw.date } : {}) }];
    });
    return { provider: 'deepseek', query: request.params.query, results, retrievedAt };
  }
  const data = await providerJson('fetch', { url: request.params.url }, key, signal);
  if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('DeepSeek网页读取未返回可用正文');
  const text = data.content.slice(0, 120000), offset = request.params.offset ?? 0;
  if (offset > text.length) throw new Error(`网页偏移超出正文范围（${text.length}字符）`);
  return { provider: 'deepseek', url: request.params.url, title: typeof data.title === 'string' ? data.title.slice(0, 300) : request.params.url,
    text: text.slice(offset, offset + 12000), offset, totalChars: text.length, nextOffset: offset + 12000 < text.length ? offset + 12000 : null,
    truncated: data.content.length > text.length, retrievedAt };
}
