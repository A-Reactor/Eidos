import { documentHref, inlineDocumentTokens, plainDocumentText } from './inline-links';
import { loadDocuments } from './repository';
import type { DocumentLink, DocumentRef, DocumentScope } from './types';

export function referenceText(link: DocumentLink): string {
  return `[${link.title.replace(/[\[\]\n\r]/g, ' ')}](${documentHref(link)})`;
}
/** Map the native textarea's visible caret to the serialized, pinned reference. */
export function sourceOffset(source: string, visible: number): number {
  let hidden = 0;
  for (const token of inlineDocumentTokens(source)) {
    const start = token.start - hidden;
    if (visible <= start) break;
    if (visible < start + token.label.length) return token.start;
    hidden += token.end - token.start - token.label.length;
  }
  return visible + hidden;
}
export function editVisibleText(source: string, next: string): string {
  const previous = plainDocumentText(source);
  let start = 0, end = previous.length, nextEnd = next.length;
  while (start < end && start < nextEnd && previous[start] === next[start]) start++;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  let hidden = 0;
  for (const token of inlineDocumentTokens(source)) {
    const left = token.start - hidden, right = left + token.label.length;
    // Editing a label turns it into ordinary text, rather than silently pointing a changed label at a file.
    if (start < right && end > left || start === end && start > left && start < right) {
      return editVisibleText(source.slice(0, token.start) + token.label + source.slice(token.end), next);
    }
    hidden += token.end - token.start - token.label.length;
  }
  return source.slice(0, sourceOffset(source, start)) + next.slice(start, nextEnd) + source.slice(sourceOffset(source, end));
}
export function selectComposerDocuments(source: string, previous: DocumentLink[], next: DocumentLink[], cursor: number): { text: string; cursor: number } {
  for (const token of inlineDocumentTokens(source).reverse()) if (token.ref && previous.some(link => link.documentId === token.ref!.documentId) && !next.some(link => link.documentId === token.ref!.documentId)) {
    source = source.slice(0, token.start) + source.slice(token.end);
  }
  const tokens = inlineDocumentTokens(source);
  const added = next.filter(link => !tokens.some(token => token.ref?.documentId === link.documentId && token.ref.revision === link.revision));
  const visible = plainDocumentText(source), at = Math.min(cursor, visible.length), offset = sourceOffset(source, at);
  const inserted = added.map(referenceText).join(' ');
  return { text: source.slice(0, offset) + inserted + source.slice(offset), cursor: at + plainDocumentText(inserted).length };
}
export async function actionDocumentReferences(scope: DocumentScope, text: string, grants: readonly (DocumentRef & { allowWrite?: boolean })[] = []): Promise<DocumentLink[]> {
  const refs = inlineDocumentTokens(text).map(token => token.ref);
  if (!refs.length) return [...grants] as DocumentLink[];
  if (refs.some(ref => !ref)) throw new Error('行动包含无法识别的文档引用，请重新选择');
  const docs = await loadDocuments(scope), result = new Map<string, DocumentLink>();
  for (const ref of [...grants, ...refs as DocumentRef[]]) {
    const doc = docs.find(doc => doc.id === ref.documentId);
    if (!doc?.versions[ref.revision]) throw new Error('行动引用的文档在当前周目中不可用，请重新选择');
    const grant = grants.find(link => link.documentId === ref.documentId && link.revision === ref.revision) as DocumentLink | undefined;
    result.set(`${ref.documentId}:${ref.revision}`, { ...ref, title: doc.versions[ref.revision].title ?? doc.title, ...(typeof grant?.allowWrite === 'boolean' ? { allowWrite: grant.allowWrite } : {}) });
  }
  return [...result.values()];
}
