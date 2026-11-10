// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureReadingResizeAnchor, restoreReadingResizeAnchor } from '@/lib/ui/reading-resize-anchor';

const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

it('keeps the visible character in a very long highlighted paragraph when line wrapping changes', () => {
  const viewport = document.createElement('main');
  const paragraph = document.createElement('p');
  paragraph.className = 'eidos-reading-paragraph';
  const highlight = document.createElement('mark');
  highlight.textContent = 'B'.repeat(4000);
  paragraph.append('A'.repeat(4000), highlight, 'C'.repeat(4000));
  viewport.append(paragraph); document.body.append(viewport);
  let columns = 40;
  viewport.scrollTop = 4000;
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 500, 600));
  vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100 - viewport.scrollTop, 500, Math.ceil(12000 / columns) * 20));
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: function(this: Range) {
    const textNodes: Node[] = [paragraph.firstChild!, highlight.firstChild!, paragraph.lastChild!];
    const offset = textNodes.indexOf(this.startContainer) * 4000 + this.startOffset;
    return new DOMRect(0, 100 + Math.floor(offset / columns) * 20 - viewport.scrollTop, 10, 20);
  } });

  const anchor = captureReadingResizeAnchor(viewport)!;
  expect(anchor.range.startContainer).toBe(paragraph.lastChild);
  expect(anchor.range.startOffset).toBe(0);
  columns = 20;
  restoreReadingResizeAnchor(viewport, anchor);
  expect(viewport.scrollTop).toBe(8000);
  expect(anchor.range.getBoundingClientRect().top).toBe(100);

  for (const nextColumns of [35, 16, 40, 60]) {
    columns = nextColumns;
    restoreReadingResizeAnchor(viewport, anchor);
    expect(anchor.range.getBoundingClientRect().top).toBe(100);
  }
  expect(viewport.scrollTop).toBe(2660);
  expect(paragraph.textContent).toHaveLength(12000);
});
