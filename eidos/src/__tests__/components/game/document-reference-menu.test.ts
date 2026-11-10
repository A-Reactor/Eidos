// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentPicker } from '@/components/game/DocumentPicker';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import type { DocumentLink } from '@/lib/game/documents/types';

afterEach(cleanup);
it.each([false, true])('references with one click and an independently toggled permission, sandbox002=%s', async defaultAllowWrite => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'menu' };
  const doc = await saveLocalDocument(scope, { title: '调查报告', content: '只有预览才显示的正文' });
  const onChange = vi.fn(), onClose = vi.fn();
  render(React.createElement(DocumentPicker, { scope, selected: [], defaultAllowWrite, onChange, onClose }));
  const title = await screen.findByRole('button', { name: '调查报告' });
  const pencil = screen.getByRole('button', { name: '允许本次修改 调查报告' });
  expect(pencil.getAttribute('aria-pressed')).toBe(String(defaultAllowWrite));
  expect(title.textContent).toBe('调查报告');
  expect(screen.queryByText('只有预览才显示的正文')).toBeNull();
  expect(screen.queryByRole('button', { name: '选择文件导入' })).toBeNull();
  expect(screen.queryByLabelText('导入文档')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(pencil);
  expect(pencil.getAttribute('aria-pressed')).toBe(String(!defaultAllowWrite));
  expect(onChange).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(title);
  expect(onChange).toHaveBeenCalledWith([{ ...doc, allowWrite: !defaultAllowWrite }]);
  expect(onClose).toHaveBeenCalledOnce();
});
it('previews through info without referencing, returns to the list, and updates an existing grant', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'info' };
  const doc = await saveLocalDocument(scope, { title: '原件', content: '预览原文' });
  const changed = vi.fn(), closed = vi.fn();
  function Menu() { const [selected, setSelected] = React.useState<DocumentLink[]>([{ ...doc, allowWrite: true }]); return React.createElement(DocumentPicker, { scope, selected, onClose: closed, onChange: next => { changed(next); setSelected(next); } }); }
  render(React.createElement(Menu));
  fireEvent.click(await screen.findByRole('button', { name: '预览 原件' }));
  expect(await screen.findByText('预览原文')).toBeTruthy();
  expect(changed).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭文档预览' }));
  fireEvent.click(screen.getByRole('button', { name: '允许本次修改 原件' }));
  expect(changed).toHaveBeenLastCalledWith([{ ...doc, allowWrite: false }]);
  expect(closed).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(closed).toHaveBeenCalledOnce());
});
