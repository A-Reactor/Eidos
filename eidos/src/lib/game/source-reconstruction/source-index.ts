import type { SourceCorpus } from '@/lib/ai/source-archive';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';
import type { SourceBlock, SourceRef } from './types';

/** Deterministic non-secret content fingerprint, not an authentication primitive. */
export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489909); }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}
export const sourceRevision = (corpus: SourceCorpus): string => stableHash(corpus.documents.map(d => [d.id, d.title, d.kind, d.content]));
export interface SourceIndexOptions { targetTokens?: number; estimate?: (text: string) => number }

export function indexSources(corpus: SourceCorpus, options: SourceIndexOptions = {}): SourceBlock[] {
  const target = Math.max(4, options.targetTokens ?? 6000), estimate = options.estimate ?? estimateTextTokens;
  const result: SourceBlock[] = [], corpusRevision = sourceRevision(corpus);
  for (const doc of corpus.documents) {
    const revision = stableHash([doc.id, doc.title, doc.kind, doc.content]);
    let start = 0;
    while (start < doc.content.length) {
      let low = start + 1, high = doc.content.length, end = low;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (estimate(doc.content.slice(start, middle)) <= target) { end = middle; low = middle + 1; } else high = middle - 1;
      }
      if (end < doc.content.length) {
        const newline = doc.content.lastIndexOf('\n', end - 1);
        if (newline > start + (end - start) / 2) end = newline + 1;
        if (/^[\uDC00-\uDFFF]$/.test(doc.content[end]) && /[\uD800-\uDBFF]/.test(doc.content[end - 1])) end--;
      }
      if (end <= start) end = start + (doc.content.codePointAt(start)! > 0xffff ? 2 : 1);
      const id = `${doc.id}:${revision}:${start}-${end}`;
      result.push({ id, blockId: id, documentId: doc.id, revision, sourceRevision: corpusRevision, title: doc.title, index: result.length, start, end, text: doc.content.slice(start, end) });
      start = end;
    }
  }
  return result;
}
export function blockRef(block: SourceBlock): SourceRef {
  return { documentId: block.documentId, revision: block.revision, blockId: block.id, start: block.start, end: block.end };
}
