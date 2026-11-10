import type { DocumentRecord } from './types';

/** Old gallery descriptors already carry this identity; no destructive migration is needed. */
export function isAutomaticImageDocument(doc: DocumentRecord): boolean {
  return doc.libraryVisibility !== 'visible' && doc.origin !== 'authored' && Boolean(doc.idempotencyKey?.startsWith('eidos-image:'));
}

export function playerDocuments(docs: DocumentRecord[]): DocumentRecord[] {
  return docs.filter(doc => !isAutomaticImageDocument(doc));
}
