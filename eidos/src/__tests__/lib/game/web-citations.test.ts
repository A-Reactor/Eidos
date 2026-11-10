import { expect, it } from 'vitest';
import { inlineTextTokens, nextNarrativeCursor, plainWebReferences } from '@/lib/game/web-citations';
import { inlineDocumentTokens } from '@/lib/game/documents/inline-links';

it('skips hidden website syntax while typing labels and keeps pinned document references intact', () => {
  const text = '见[官网](https://example.com/a_(guide))和[报告](document://report/material_1234567890abcdef)。';
  const frames: string[] = [];
  for (let cursor = 0; cursor < text.length;) {
    const previous = cursor; cursor = nextNarrativeCursor(text, cursor);
    expect(cursor).toBeGreaterThan(previous);
    expect(cursor).toBeLessThanOrEqual(text.length);
    frames.push(text.slice(0, cursor));
  }
  expect(frames).not.toContain('见[官网](h');
  expect(frames).not.toContain('见[官网](https://example.com');
  expect(frames).toContain('见[官网](https://example.com/a_(guide))');
  expect(inlineTextTokens(text)[1].ref).toEqual({ documentId: 'report', revision: 'material_1234567890abcdef' });
  expect(inlineDocumentTokens(text)).toHaveLength(1);
});
it('does not count an address inside a document title as a separate web citation', () => {
  const text = '[https://example.com](document://report/material_1234567890abcdef)';
  expect(inlineTextTokens(text)).toHaveLength(1);
  expect(inlineTextTokens(text)[0].kind).toBe('document');
});
it('keeps parentheses in URLs and hides angle or URL-labelled autolinks', () => {
  expect(inlineTextTokens('[官方](https://example.com/a_(guide) "Site title")')[0]).toMatchObject({ label: '官方', target: 'https://example.com/a_(guide)', complete: true });
  expect(plainWebReferences('甲<https://example.com/docs>乙[https://example.org](https://example.org)丙')).toBe('甲乙丙');
});
it('keeps a truncated Markdown website inert while retaining its readable label', () => {
  expect(inlineTextTokens('见[官方](https://')[0]).toMatchObject({ label: '官方', complete: false, target: '' });
  expect(plainWebReferences('见[官方](https://')).toBe('见官方');
});
