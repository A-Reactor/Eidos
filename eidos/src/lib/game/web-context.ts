import type { StorySegment } from '@/lib/ai/types';
import type { ActionOperationReceipt } from './action-operations';
import { inlineTextTokens } from './web-citations';

export interface WebSource { label: string; url: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Fragments identify positions on one page, rather than additional searched pages. */
export function uniqueWebSources(values: WebSource[]): WebSource[] {
  const sources = new Map<string, WebSource>();
  for (const source of values) {
    try {
      if (typeof source?.url !== 'string') continue;
      const url = new URL(source.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      url.hash = '';
      if (!sources.has(url.href)) sources.set(url.href, { label: typeof source.label === 'string' && source.label.slice(0, 300) || url.hostname, url: url.href });
    } catch { /* Invalid model-authored links cannot become search metadata. */ }
  }
  return [...sources.values()];
}
export function webSourcesFromReceipts(receipts: readonly ActionOperationReceipt[]): WebSource[] {
  return uniqueWebSources(receipts.flatMap(receipt => {
    if (receipt.status !== 'completed' || !['web.search', 'web.open'].includes(receipt.method)) return [];
    const result = object(receipt.result);
    const entries = [...Array.isArray(result.results) ? result.results : [], ...Array.isArray(result.sources) ? result.sources : [], ...(result.url ? [result] : [])];
    return entries.flatMap(entry => {
      const value = object(entry);
      return typeof value.url === 'string' ? [{ url: value.url, label: typeof value.title === 'string' ? value.title : typeof value.label === 'string' ? value.label : '' }] : [];
    });
  }));
}

/** Call only after consumption or under context pressure; sources survive without carrying page bodies. */
export function compactWebReceipt(receipt: ActionOperationReceipt): ActionOperationReceipt {
  if (!['web.search', 'web.open'].includes(receipt.method) || receipt.status !== 'completed') return receipt;
  const result = object(receipt.result);
  if (result.collapsed === true) return receipt;
  const text = typeof result.text === 'string' ? result.text : '';
  const items = Array.isArray(result.results) ? result.results : [];
  const summary = text || items.map(item => { const value = object(item); return value.summary ?? value.snippet ?? ''; }).join(' ');
  return { ...receipt, result: { provider: result.provider, query: result.query, url: result.url, title: result.title,
    collapsed: true, summary: summary.replace(/\s+/gu, ' ').slice(0, 320), originalChars: text.length || JSON.stringify(result).length,
    sources: webSourcesFromReceipts([receipt]), note: '网页内容已折叠为摘录；需要原文时重新调用web_open。' } };
}

/** Host provenance, never a model-written count. No full webpage content is stored on a story paragraph. */
export function attachSearchSources(segments: StorySegment[], receipts: readonly ActionOperationReceipt[]): StorySegment[] {
  const sources = webSourcesFromReceipts(receipts);
  const referenced = segments.some(segment => inlineTextTokens(segment.text).some(token => token.kind === 'web'));
  return segments.map(({ searchSources: _untrusted, ...segment }, index) => sources.length &&
    (inlineTextTokens(segment.text).some(token => token.kind === 'web') || !referenced && index === segments.length - 1)
    ? { ...segment, searchSources: sources } : segment);
}
