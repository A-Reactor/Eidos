import { expect, it } from 'vitest';
import { resolveInlineDocuments, plainDocumentText, inlineDocumentTokens } from '@/lib/game/documents/inline-links';
it('resolves only real terminal document keys and mounted documents to pinned links', () => {
  const ref = { documentId: 'report-id', revision: 'material_1234567890abcdef', title: '调查报告' };
  const resolved = resolveInlineDocuments('她递来[调查报告](document:report)。', { report: ref }, []);
  expect(resolved).toBe('她递来[调查报告](document://report-id/material_1234567890abcdef)。');
  expect(plainDocumentText(resolved)).toBe('她递来调查报告。');
  expect(inlineDocumentTokens(resolved)[0].ref).toEqual({ documentId: ref.documentId, revision: ref.revision });
  expect(() => resolveInlineDocuments('[不存在](document:fake)', {}, [])).toThrow('引用');
});
it('remaps pinned prose links when an imported document business ID changes', async () => {
  const { remapDocumentReferences, documentTransferKey } = await import('@/lib/game/documents/transfer');
  const scope = { worldId: 'world', playthroughId: 'old' }, old = { documentId: 'old', revision: 'material_1234567890abcdef' };
  const map = new Map([[documentTransferKey(scope, old), { ...old, documentId: 'restored' }]]);
  expect(remapDocumentReferences({ text: '[报告](document://old/material_1234567890abcdef)' }, scope, map).text).toBe('[报告](document://restored/material_1234567890abcdef)');
});
it('pins an edited file to the version reached by the current paragraph', async () => {
  const { resolveBranchInlineDocuments } = await import('@/lib/game/documents/inline-links');
  const old = { documentId: 'file', revision: 'material_0000000000000000', title: '旧稿' };
  const first = { ...old, revision: 'material_1111111111111111' }, last = { ...old, revision: 'material_2222222222222222' };
  const prepared = { byKey: { file: last }, branch: { documents: [{ link: first, beforeRevision: old.revision, segmentIndex: 1 }, { link: last, beforeRevision: first.revision, segmentIndex: 2 }] } };
  expect(resolveBranchInlineDocuments('[旧稿](document:file)', prepared, [old], 0)).toContain(old.revision);
  expect(resolveBranchInlineDocuments('[旧稿](document:file)', prepared, [old], 1)).toContain(first.revision);
  expect(resolveBranchInlineDocuments('[旧稿](document:file)', prepared, [old], 2)).toContain(last.revision);
});
