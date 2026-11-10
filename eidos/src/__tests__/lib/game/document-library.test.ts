// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import * as storage from '@/lib/game/storage';
import { loadDocuments, readDocument, saveDocument, documentLibraryKey } from '@/lib/game/documents/repository';
import { importDocument } from '@/lib/game/documents/ingest';
import { readResource, storeResource } from '@/lib/game/workspace/resources';
import { saveModelDocument } from '@/lib/game/model-documents';

const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: 'one', archiveId: 'main' });
afterEach(() => { vi.restoreAllMocks(); storage._resetDB(); localStorage.clear(); });

it('imports a complete text version and preserves the original bytes separately from metadata', async () => {
  const s = scope(), content = '\ufeff第一行\r\n最后🙂' + '完整资料'.repeat(400);
  const link = await importDocument(s, new File([content], '旧港调查.md', { type: 'text/markdown' }));
  const { record, resource } = await readDocument(s, link);
  expect(resource.text).toBe(content.slice(1));
  expect(resource.text?.endsWith('完整资料')).toBe(true);
  const original = await readResource(record.versions[link.revision].originalResource!);
  expect(atob(original.base64!)).toBe(Array.from(new TextEncoder().encode(content), n => String.fromCharCode(n)).join(''));
  const metadata = await storage.loadMeta(documentLibraryKey(s));
  expect(JSON.stringify(metadata)).not.toContain('第一行');
  expect(record.title).toBe('旧港调查.md');
});

it('keeps distinct same-name imports and isolates their scope', async () => {
  const s = scope();
  const a = await importDocument(s, new File(['甲'], '同名.txt'));
  const b = await importDocument(s, new File(['乙'], '同名.txt'));
  expect(a.documentId).not.toBe(b.documentId);
  expect(await loadDocuments(s)).toHaveLength(2);
  await expect(readDocument({ ...s, playthroughId: 'other' }, a)).rejects.toThrow('不存在');
  await expect(readDocument({ ...s, archiveId: 'sandbox:002' }, a)).rejects.toThrow('不存在');
});

it('preserves older versions and rejects stale edits instead of changing historical references', async () => {
  const s = scope();
  const first = await importDocument(s, new File(['原始正文'], '版本.txt'));
  const resource = await storeResource({ name: 'edited.txt', mimeType: 'text/plain', text: '修改正文' });
  const next = await saveDocument(s, { title: '版本.txt', origin: 'authored', resource, previous: first });
  expect(next.documentId).toBe(first.documentId);
  expect((await readDocument(s, first)).resource.text).toBe('原始正文');
  expect((await readDocument(s, next)).resource.text).toBe('修改正文');
  await expect(saveDocument(s, { title: '旧编辑', origin: 'authored', resource, previous: first })).rejects.toThrow('版本');
});

it('saves one artifact for an action retry and preserves concurrent imports', async () => {
  const s = scope(), resource = await storeResource({ name: 'report.md', mimeType: 'text/markdown', text: '# 完整报告' });
  const [a, b] = await Promise.all([1, 2].map(() => saveDocument(s, { title: '报告', origin: 'generated', resource, idempotencyKey: 'action:key' })));
  expect(a).toEqual(b);
  await Promise.all(['甲', '乙'].map(text => importDocument(s, new File([text], `${text}.txt`))));
  expect(await loadDocuments(s)).toHaveLength(3);
});

it('rejects unsupported files, invalid UTF-8 and over-limit input without truncating or adding a library record', async () => {
  const s = scope();
  await expect(importDocument(s, new File(['%PDF-1'], 'report.pdf', { type: 'application/pdf' }))).rejects.toThrow('文本');
  await expect(importDocument(s, new File([new Uint8Array([0xff, 0xfe, 0x00])], 'invalid.txt'))).rejects.toThrow('UTF-8');
  await expect(importDocument(s, new File(['x'.repeat(4194305)], 'large.txt'))).rejects.toThrow('4');
  expect(await loadDocuments(s)).toEqual([]);
});

it('accepts exactly 4 MiB and never loses the final byte', async () => {
  const s = scope(), text = 'x'.repeat(4194303) + 'Z';
  const link = await importDocument(s, new File([text], 'boundary.txt'));
  const { resource } = await readDocument(s, link);
  expect(resource.size).toBe(4194304);
  expect(resource.text?.length).toBe(4194304);
  expect(resource.text?.at(-1)).toBe('Z');
});

it('does not report a successful import if the resource cannot be persisted', async () => {
  const s = scope();
  vi.spyOn(storage, 'saveMeta').mockRejectedValueOnce(new Error('存储失败'));
  await expect(importDocument(s, new File(['重要正文'], 'failure.txt'))).rejects.toThrow('存储失败');
  expect(await loadDocuments(s)).toEqual([]);
});

it('adapts legacy documents without losing their originals or creating actions', async () => {
  const s = scope(), content = '旧文档\n' + '证据'.repeat(500) + '最后一行';
  const old = await saveModelDocument(s, { title: '旧报告', format: 'markdown', content, rawOutput: '完整原始响应' }, '整理');
  const docs = await loadDocuments(s), saved = docs.find(d => d.id === old.id)!;
  expect((await readDocument(s, { documentId: saved.id, revision: saved.currentRevision })).resource.text).toBe(content);
  const raw = await readResource(saved.versions[saved.currentRevision].responseResource!);
  expect(raw.text).toContain('完整原始响应');
  expect(await storage.loadFromDB(`model-documents:${JSON.stringify([s.worldId, s.playthroughId, s.archiveId])}`)).not.toBeNull();
});
