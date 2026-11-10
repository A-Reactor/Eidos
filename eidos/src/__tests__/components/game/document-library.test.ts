// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentLibrary } from '@/components/game/DocumentLibrary';
import { DocumentPicker } from '@/components/game/DocumentPicker';
import { importDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, readDocument } from '@/lib/game/documents/repository';
import { _resetDB } from '@/lib/game/storage';

const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: 'library', archiveId: 'main' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); _resetDB(); localStorage.clear(); });

it('creates a local document, reads its complete text, and offers referencing without invoking a model', async () => {
  const s = scope(), onReference = vi.fn(), fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(React.createElement(DocumentLibrary, { scope: s, onReference }));
  await screen.findByText('还没有文档。');
  fireEvent.click(screen.getByRole('button', { name: '新建文档' }));
  fireEvent.change(screen.getByLabelText('文档标题'), { target: { value: '调查笔记' } });
  fireEvent.change(screen.getByLabelText('文档内容'), { target: { value: '# 证据\n\n完整末尾。' } });
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await screen.findByRole('heading', { name: '证据' });
  expect(screen.getByLabelText('文档正文').textContent).toContain('完整末尾。');
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '继续补充' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '引用到行动' }));
  const [saved] = await loadDocuments(s);
  expect(onReference).toHaveBeenCalledWith({ documentId: saved.id, revision: saved.currentRevision, title: '调查笔记' });
});

it('imports successful files even if another format is unsupported and waits for an explicit reference selection', async () => {
  const s = scope(), onChange = vi.fn();
  const library = render(React.createElement(DocumentLibrary, { scope: s }));
  fireEvent.change(screen.getByLabelText('导入文档'), { target: { files: [new File(['最后证据'], '信件.txt'), new File(['binary'], '报告.pdf')] } });
  expect((await screen.findByRole('alert')).textContent).toContain('报告.pdf');
  library.unmount();
  render(React.createElement(DocumentPicker, { scope: s, selected: [], onChange, onClose() {} }));
  const title = await screen.findByRole('button', { name: '信件.txt' });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(title);
  const [saved] = await loadDocuments(s);
  expect(onChange).toHaveBeenCalledWith([{ documentId: saved.id, revision: saved.currentRevision, title: '信件.txt', allowWrite: false }]);
});

it('edits locally into a new version while preserving the referenced original', async () => {
  const s = scope(), original = await importDocument(s, new File(['原始文本'], '信件.txt'));
  render(React.createElement(DocumentLibrary, { scope: s, initialId: original.documentId }));
  await screen.findByText('原始文本');
  fireEvent.click(screen.getByRole('button', { name: '编辑文档' }));
  fireEvent.change(screen.getByLabelText('文档内容'), { target: { value: '修改后的文本' } });
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await screen.findByText('修改后的文本');
  await act(async () => { expect((await readDocument(s, original)).resource.text).toBe('原始文本'); });
});
