import type { DocumentLink, DocumentRef } from './types';
export interface InlineDocumentToken { start: number; end: number; label: string; target: string; ref?: DocumentRef }
export function inlineDocumentTokens(text: string): InlineDocumentToken[] {
  return [...text.matchAll(/\[([^\]\n]+)\]\((document:(?:\/\/)?[^\s)]+)\)/g)].map(match => {
    const target = match[2]; let ref: DocumentRef | undefined;
    const pinned = /^document:\/\/([^/]+)\/(material_[a-f0-9]{16}|legacy_[^/]+)$/.exec(target);
    if (pinned) { try { ref = { documentId: decodeURIComponent(pinned[1]), revision: decodeURIComponent(pinned[2]) }; } catch { /* An incomplete streamed link stays inert. */ } }
    return { start: match.index!, end: match.index! + match[0].length, label: match[1], target, ref };
  });
}
export const documentHref = (ref: DocumentRef) => `document://${encodeURIComponent(ref.documentId)}/${encodeURIComponent(ref.revision)}`;
export function resolveInlineDocuments(text: string, byKey: Record<string, DocumentLink>, known: DocumentLink[]): string {
  let result = '', end = 0;
  for (const token of inlineDocumentTokens(text)) {
    const key = token.target.slice('document:'.length);
    const ref = token.ref ? [...Object.values(byKey), ...known].find(r => r.documentId === token.ref!.documentId && r.revision === token.ref!.revision)
      : byKey[key] ?? known.find(r => r.documentId === key);
    if (!ref) throw new Error(`正文引用了不可用的文档：${key}`);
    result += text.slice(end, token.start) + `[${token.label}](${documentHref(ref)})`; end = token.end;
  }
  return result + text.slice(end);
}
export function plainDocumentText(text: string): string {
  let result = '', end = 0;
  for (const token of inlineDocumentTokens(text)) { result += text.slice(end, token.start) + token.label; end = token.end; }
  return result + text.slice(end);
}

/** The typewriter counts visible letters; skip the hidden URI as soon as its label is complete. */
export function nextDocumentCursor(source: string, current: number): number {
  let next = current + 1;
  for (const token of inlineDocumentTokens(source)) {
    if (next === token.start + 1) next++;
    if (next >= token.start + token.label.length + 1 && next < token.end) return token.end;
  }
  return next;
}
export function resolveBranchInlineDocuments(text: string, prepared: { byKey: Record<string, DocumentLink>; branch?: { documents: Array<{ link: DocumentLink; beforeRevision: string | null; segmentIndex: number }> } }, known: DocumentLink[], segmentIndex: number): string {
  const keys = { ...prepared.byKey }, changes = prepared.branch?.documents.filter(change => change.beforeRevision !== null) ?? [];
  for (const change of changes) delete keys[change.link.documentId];
  for (const change of changes) if (change.segmentIndex <= segmentIndex) keys[change.link.documentId] = change.link;
  return resolveInlineDocuments(text, keys, known);
}
