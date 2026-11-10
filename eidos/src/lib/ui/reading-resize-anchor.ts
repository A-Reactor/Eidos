export interface ReadingResizeAnchor {
  range: Range;
  top: number;
}

/** A live character range follows line reflow without snapping a long paragraph back to its start. */
export function captureReadingResizeAnchor(viewport: HTMLElement): ReadingResizeAnchor | null {
  const top = viewport.getBoundingClientRect().top;
  const paragraph = Array.from(viewport.querySelectorAll<HTMLElement>(
    '.eidos-reading-paragraph, .eidos-reading-record h2, .eidos-reading-record-meta, blockquote',
  )).find(element => element.getBoundingClientRect().bottom > top + 1);
  if (!paragraph) return null;

  const range = document.createRange();
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  const leaves: Array<{ node: Text; start: number; end: number }> = [];
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.length) continue;
    leaves.push({ node, start: total, end: total + node.length });
    total += node.length;
  }
  if (!total) return null;
  const at = (index: number) => {
    const leaf = leaves.find(entry => index < entry.end)!;
    range.setStart(leaf.node, index - leaf.start);
    range.setEnd(leaf.node, index - leaf.start + 1);
    return range.getBoundingClientRect();
  };

  // Find the first visible character in logarithmic steps even inside a very long paragraph.
  let low = 0, high = total - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (at(middle).bottom <= top + 1) low = middle + 1;
    else high = middle;
  }
  return { range, top: at(low).top - top };
}

export function restoreReadingResizeAnchor(viewport: HTMLElement, anchor: ReadingResizeAnchor): void {
  if (!viewport.contains(anchor.range.startContainer)) return;
  const top = anchor.range.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  viewport.scrollTop += top - anchor.top;
}
