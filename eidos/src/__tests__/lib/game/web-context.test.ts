import { expect, it } from 'vitest';
import { compactWebReceipt, webSourcesFromReceipts, attachSearchSources } from '@/lib/game/web-context';
import type { ActionOperationReceipt } from '@/lib/game/action-operations';
const receipt: ActionOperationReceipt = { method: 'web.open', status: 'completed',
  result: { title: '原网页', url: 'https://example.com/docs', text: '重要内容。' + '网页全文'.repeat(1000) } };

it('projects a consumed web result into a bounded summary without mutating the receipt', () => {
  const folded = compactWebReceipt(receipt);
  expect(folded.result).toMatchObject({ collapsed: true, title: '原网页', sources: [{ label: '原网页', url: 'https://example.com/docs' }] });
  expect(folded.result).not.toHaveProperty('text');
  expect(JSON.stringify(folded).length).toBeLessThan(1000);
  expect(receipt.result).toHaveProperty('text');
  expect(compactWebReceipt(folded)).toBe(folded);
});
it('counts unique successful pages and gives the model no way to invent a search count', () => {
  const found: ActionOperationReceipt = { method: 'web.search', status: 'completed', result: { results: [
    { title: '文档', url: 'https://example.com/docs#top' }, { title: '同页', url: 'https://example.com/docs#other' }, { title: '手册', url: 'https://example.com/handbook' },
  ] } };
  const failed: ActionOperationReceipt = { ...receipt, status: 'failed', result: { url: 'https://unavailable.example/' } };
  const sources = webSourcesFromReceipts([found, receipt, failed]);
  expect(sources).toEqual([{ label: '文档', url: 'https://example.com/docs' }, { label: '手册', url: 'https://example.com/handbook' }]);
  const segments = [{ type: 'narration' as const, text: '说明。', searchSources: [{ label: '伪造', url: 'https://invented.example/' }] }];
  expect(attachSearchSources(segments, [found])[0].searchSources).toEqual(sources);
  expect(attachSearchSources(segments, [])[0]).not.toHaveProperty('searchSources');
});
it('keeps failure evidence and non-web tools untouched when folding older web content', () => {
  const failed = { ...receipt, status: 'failed' as const, error: 'HTTP 503' };
  const file = { ...receipt, method: 'files.read' };
  expect(compactWebReceipt(failed)).toBe(failed);
  expect(compactWebReceipt(file)).toBe(file);
  expect(webSourcesFromReceipts([compactWebReceipt(receipt)])).toEqual([{ label: '原网页', url: 'https://example.com/docs' }]);
});
