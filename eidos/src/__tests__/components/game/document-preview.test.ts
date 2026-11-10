// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DocumentLinks } from '@/components/game/DocumentLinks';
import { DocumentPreview } from '@/components/game/DocumentPreview';
import { DocumentPicker } from '@/components/game/DocumentPicker';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { useGameStore } from '@/store/game-store';

afterEach(cleanup);
it('opens a pinned document version in a local dialog and restores focus without changing game state', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'preview' };
  const link = await saveLocalDocument(scope, { title: '很长的标题'.repeat(30), content: '第一版结尾', format: 'text' });
  await saveLocalDocument(scope, { title: '更名的文档', content: '第二版', format: 'text', previous: link });
  const before = useGameStore.getState(), node = before.currentNode, time = before.gameTime;
  function Preview() {
    const [open, setOpen] = React.useState(false);
    return React.createElement(React.Fragment, null, React.createElement(DocumentLinks, { links: [link], onOpen: () => setOpen(true) }), open && React.createElement(DocumentPreview, { scope, documentRef: link, onClose: () => setOpen(false) }));
  }
  render(React.createElement(Preview));
  const button = screen.getByRole('button', { name: `文档 → ${link.title}` }); button.focus(); fireEvent.click(button);
  await screen.findByText('第一版结尾'); expect(screen.queryByText('第二版')).toBeNull();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(document.activeElement).toBe(button); expect(useGameStore.getState().currentNode).toBe(node); expect(useGameStore.getState().gameTime).toBe(time);
});
it('uses a nonmodal reference list and dismisses it with Escape', () => {
  function Picker() { const [open, setOpen] = React.useState(false); return React.createElement(React.Fragment, null,
    React.createElement('button', { 'data-document-picker-trigger': true, onClick: () => setOpen(true) }, '打开'), open && React.createElement(DocumentPicker, { scope: { worldId: 'x', playthroughId: 'y' }, selected: [], onChange() {}, onClose: () => setOpen(false) })); }
  render(React.createElement(Picker)); const origin = screen.getByRole('button', { name: '打开' }); origin.focus(); fireEvent.click(origin);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: '确认引用' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('region', { name: '引用文档' }), { key: 'Escape' });
  expect(screen.queryByRole('region')).toBeNull(); expect(document.activeElement).toBe(origin);
});
