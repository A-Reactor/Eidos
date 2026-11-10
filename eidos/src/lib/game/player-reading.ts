import type { WorldLineNode } from './types';

/** Literal ranges keep player names, punctuation and search syntax out of a regex. */
export function getTextMatches(text: string, query: string): Array<{ start: number; end: number }> {
  const haystack = text.toLocaleLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const term of new Set(query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))) {
    let from = 0;
    while (from < haystack.length) {
      const start = haystack.indexOf(term, from);
      if (start < 0) break;
      ranges.push({ start, end: start + term.length });
      from = start + term.length;
    }
  }
  const merged: typeof ranges = [];
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function getReadingSnippet(text: string, query: string): string {
  const match = getTextMatches(text, query)[0];
  const start = Math.max(0, (match?.start ?? 0) - 48);
  const end = Math.min(text.length, Math.max(start + 160, match?.end ?? 0));
  return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** Old interrupted records have no trustworthy boundary; do not guess from their summary. */
export function getPlayerVisibleText(node: WorldLineNode): string {
  if (typeof node.playerVisibleText === 'string') return node.playerVisibleText;
  return node.generationComplete === false ? '' : node.aiResponse || '';
}

/** A fact and the entity it describes must appear together in a player-facing passage. */
export function findPublicFactQuote(passages: readonly string[], name: string, value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && name ? passages.find(passage => passage.includes(name) && passage.includes(text)) : undefined;
}

export function getReadingPath(nodes: Record<string, WorldLineNode>, currentId: string | null): WorldLineNode[] {
  const path: WorldLineNode[] = [];
  const visited = new Set<string>();
  let cursor = currentId;
  while (cursor && nodes[cursor] && !visited.has(cursor)) {
    visited.add(cursor);
    const node = nodes[cursor];
    path.push(node);
    cursor = node.parentId;
  }
  return path.reverse();
}

export function searchReadingPath(nodes: Record<string, WorldLineNode>, currentId: string | null, query: string): WorldLineNode[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return getReadingPath(nodes, currentId).filter(node => {
    const text = `${node.playerInput}\n${node.sceneName}\n${getPlayerVisibleText(node)}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).reverse();
}

/** Archive what the active presentation exposes, including a partially typed line. */
export function getPresentedText(
  segments: { type: string; text: string; speaker?: string }[],
  index: number, showing: boolean, displayedText: string, fullCurrent: boolean,
): string {
  return (showing ? segments.slice(0, index + 1) : segments).map((segment, i) => {
    const partial = showing && i === index && !fullCurrent;
    const text = partial ? (segment.text.startsWith(displayedText) ? displayedText : '') : segment.text;
    if (!text) return '';
    if (segment.type !== 'dialogue') return text;
    return '「' + (segment.speaker ? segment.speaker + '：' : '') + text + (text === segment.text ? '」' : '');
  }).filter(Boolean).join('\n\n');
}
