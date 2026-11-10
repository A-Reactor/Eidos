// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { editVisibleText, referenceText, selectComposerDocuments, actionDocumentReferences } from '@/lib/game/documents/composer';
import { plainDocumentText } from '@/lib/game/documents/inline-links';
import { saveLocalDocument } from '@/lib/game/documents/ingest';

it('inserts pinned references at the visible caret, preserves text around them, and detaches edited labels', () => {
  const link = { documentId: 'report', revision: 'material_1234567890abcdef', title: '报告' };
  const selected = selectComposerDocuments('核对然后离开', [], [link], 2);
  expect(selected.text).toBe(`核对${referenceText(link)}然后离开`);
  expect(selected.cursor).toBe(4);
  expect(plainDocumentText(selected.text)).toBe('核对报告然后离开');
  expect(editVisibleText(selected.text, '请核对报告然后离开')).toContain(referenceText(link));
  expect(editVisibleText(selected.text, '核对报然后离开')).toBe('核对报然后离开');
  expect(editVisibleText(selected.text, '核对然后离开')).toBe('核对然后离开');
});

it('uses the same pinned identity for recommended actions without manufacturing write grants', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'suggested' };
  const doc = await saveLocalDocument(scope, { title: '核对原件', content: '原文' });
  const action = `更改${referenceText(doc)}的标题`;
  expect(await actionDocumentReferences(scope, action)).toEqual([doc]);
  expect(await actionDocumentReferences(scope, action, [{ ...doc, allowWrite: true }])).toEqual([{ ...doc, allowWrite: true }]);
  expect(await actionDocumentReferences(scope, action, [{ ...doc, allowWrite: false }])).toEqual([{ ...doc, allowWrite: false }]);
  await expect(actionDocumentReferences({ ...scope, playthroughId: 'other' }, action)).rejects.toThrow('当前周目');
});

it('distinguishes an explicit sandbox read-only choice from the default when matching cached actions and restoring archives', async () => {
  const { actionInputIdentity } = await import('@/lib/game/documents/action-draft');
  const { remapDocumentReferences, documentTransferKey } = await import('@/lib/game/documents/transfer');
  const scope = { worldId: 'world', playthroughId: 'before' };
  const doc = { documentId: 'report', revision: 'material_1234567890abcdef', title: '报告' };
  const readonly = { ...doc, allowWrite: false };
  const identity = actionInputIdentity('查看', [readonly]);
  expect(identity).not.toBe(actionInputIdentity('查看', [doc]));
  expect(identity).not.toBe(actionInputIdentity('查看', [{ ...doc, allowWrite: true } as typeof readonly]));
  const next = { documentId: 'imported', revision: 'material_abcdef1234567890' };
  const remapped = remapDocumentReferences({ inputIdentity: identity, inputDocuments: [readonly] }, scope, new Map([[documentTransferKey(scope, doc), next]]));
  expect(remapped.inputIdentity).toBe(actionInputIdentity('查看', [{ ...next, allowWrite: false } as typeof readonly]));
  expect(remapped.inputDocuments[0].allowWrite).toBe(false);
});
