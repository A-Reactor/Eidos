import { inlineDocumentTokens, nextDocumentCursor, type InlineDocumentToken } from './documents/inline-links';

export interface InlineTextToken extends InlineDocumentToken {
  kind: 'document' | 'web'; labelStart: number; complete: boolean;
}
function safeWebUrl(value: string): string | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

/** Keep source offsets intact: effects, history and the typewriter still refer to the original text. */
export function inlineTextTokens(text: string, webSources = true): InlineTextToken[] {
  const tokens: InlineTextToken[] = inlineDocumentTokens(text).map(token => ({ ...token, kind: 'document', labelStart: token.start + 1, complete: true }));
  if (!webSources) return tokens;
  const occupied = (start: number) => tokens.some(token => start >= token.start && start < token.end);
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\(\s*(https?:\/\/)/gi)) {
    if (occupied(match.index!)) continue;
    const urlStart = match.index! + match[0].length - match[2].length;
    let end = urlStart, depth = 0;
    for (; end < text.length; end++) {
      if (/\s/u.test(text[end])) break;
      if (text[end] === '(') depth++;
      if (text[end] === ')' && depth-- === 0) break;
    }
    const suffix = text.slice(end).match(/^(?:\s+"[^"\n]*")?\s*\)/)?.[0];
    const target = safeWebUrl(text.slice(urlStart, end));
    const label = /^https?:\/\//i.test(match[1]) ? '' : match[1];
    tokens.push({ start: match.index!, end: end + (suffix?.length ?? 0), label, labelStart: match.index! + 1,
      target: target ?? '', kind: 'web', complete: Boolean(suffix && target) });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\[\]，。！？；、（）「」『』【】]+/gi)) {
    if (occupied(match.index!)) continue;
    let raw = match[0].replace(/[.,;:!?]+$/u, '');
    while (raw.endsWith(')') && (raw.match(/\)/g)?.length ?? 0) > (raw.match(/\(/g)?.length ?? 0)) raw = raw.slice(0, -1);
    const target = safeWebUrl(raw);
    if (!target) continue;
    const angle = text[match.index! - 1] === '<' && text[match.index! + raw.length] === '>';
    tokens.push({ start: match.index! - Number(angle), end: match.index! + raw.length + Number(angle), label: '', labelStart: match.index!, target, kind: 'web', complete: true });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

/** Speech keeps meaningful link labels but never reads out website addresses. */
export function plainWebReferences(text: string): string {
  let result = '', end = 0;
  for (const token of inlineTextTokens(text).filter(token => token.kind === 'web')) {
    result += text.slice(end, token.start) + token.label; end = token.end;
  }
  return result + text.slice(end);
}

export function nextNarrativeCursor(source: string, current: number): number {
  let next = nextDocumentCursor(source, current);
  for (const token of inlineTextTokens(source).filter(token => token.kind === 'web')) {
    if (next <= token.start || next >= token.end) continue;
    if (!token.label || next >= token.labelStart + token.label.length) return token.end;
    if (next <= token.labelStart) next = token.labelStart + 1;
  }
  return next;
}
