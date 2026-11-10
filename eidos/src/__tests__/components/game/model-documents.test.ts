// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentLibrary } from '@/components/game/DocumentLibrary';
import { downloadFile } from '@/lib/game/export-records';
import * as repository from '@/lib/game/documents/repository';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { _resetDB } from '@/lib/game/storage';
vi.mock('@/lib/game/export-records', async original => ({ ...await original<object>(), downloadFile: vi.fn() }));
const scope = () => ({ worldId: crypto.randomUUID(), playthroughId: 'recovery', archiveId: 'main' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); _resetDB(); localStorage.clear(); });

it('retains a recovered document and retries local persistence without a model call', async () => {
  const s = scope(), content = '完整正文。'.repeat(300) + '末尾证据';
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(repository, 'saveDocument').mockRejectedValueOnce(new Error('磁盘写入失败'));
  render(React.createElement(DocumentLibrary, { scope: s, initial: { document: { title: '恢复报告', format: 'markdown', content }, request: '分析' } }));
  expect((await screen.findByLabelText('文档正文')).textContent).toBe(content);
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await screen.findByText('磁盘写入失败');
  expect(screen.getByLabelText('文档正文').textContent).toBe(content);
  fireEvent.click(screen.getByRole('button', { name: '保存文档' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存文档' })).toBeNull());
  expect(fetch).not.toHaveBeenCalled();
  expect((await repository.loadDocuments(s))).toHaveLength(1);
});

it('reports export failure while retaining the complete Markdown in the reader', async () => {
  const s = scope(), content = '# 原标题\n\n**原证据**';
  const doc = await saveLocalDocument(s, { title: '报告', content });
  vi.mocked(downloadFile).mockRejectedValueOnce(new Error('保存位置不可写'));
  render(React.createElement(DocumentLibrary, { scope: s, initialId: doc.documentId }));
  fireEvent.click(await screen.findByRole('button', { name: '导出文档' }));
  expect((await screen.findByRole('alert')).textContent).toBe('保存位置不可写');
  expect(screen.getByLabelText('文档正文').textContent).toContain('原证据');
  expect(downloadFile).toHaveBeenLastCalledWith(content, '报告.md', 'text/markdown');
});
