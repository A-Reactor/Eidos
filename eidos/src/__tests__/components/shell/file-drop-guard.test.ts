// @vitest-environment jsdom
import React from 'react';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFileDropGuard } from '@/components/shell/use-file-drop-guard';
import { FileImportZone } from '@/components/ui/FileImportZone';

function Guard({ children }: { children?: React.ReactNode }) { useFileDropGuard(); return children; }
afterEach(cleanup);

it('cancels file navigation over blank areas, including a child that stops propagation', () => {
  render(React.createElement(Guard, null, React.createElement('div', { onDrop: (event: React.DragEvent) => event.stopPropagation() }, '空白区域')));
  const target = screen.getByText('空白区域');
  const over = createEvent.dragOver(target, { dataTransfer: { types: ['Files'] } });
  fireEvent(target, over);
  expect(over.defaultPrevented).toBe(true);
  const drop = createEvent.drop(target, { dataTransfer: { files: [new File(['hi'], 'readme.txt')] } });
  fireEvent(target, drop);
  expect(drop.defaultPrevented).toBe(true);
});

it('recognizes file items even when the webview file list is empty', () => {
  render(React.createElement(Guard));
  const drop = createEvent.drop(window, { dataTransfer: { types: [], files: [], items: [{ kind: 'file' }] } });
  fireEvent(window, drop);
  expect(drop.defaultPrevented).toBe(true);
});

it('keeps real import zones working and ignores files on disabled zones', async () => {
  const onFiles = vi.fn().mockResolvedValue(undefined);
  const props = { label: '资料导入区', inputLabel: '选择资料', accept: '.txt', onFiles, children: '导入' };
  const view = render(React.createElement(Guard, null, React.createElement(FileImportZone, props)));
  const file = new File(['hello'], 'readme.txt');
  fireEvent.drop(screen.getByRole('button', { name: '资料导入区' }), { dataTransfer: { types: ['Files'], files: [file] } });
  await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  view.rerender(React.createElement(Guard, null, React.createElement(FileImportZone, { ...props, disabled: true })));
  const target = screen.getByRole('button', { name: '资料导入区' });
  const drop = createEvent.drop(target, { dataTransfer: { types: ['Files'], files: [file] } });
  fireEvent(target, drop);
  expect(drop.defaultPrevented).toBe(true);
  expect(onFiles).toHaveBeenCalledTimes(1);
});

it('leaves plain text dragging alone and removes the guard on unmount', () => {
  const view = render(React.createElement(Guard));
  for (const create of [createEvent.dragOver, createEvent.drop]) {
    const event = create(window, { dataTransfer: { types: ['text/plain'], files: [], items: [{ kind: 'string' }] } });
    fireEvent(window, event);
    expect(event.defaultPrevented).toBe(false);
  }
  view.unmount();
  const event = createEvent.drop(window, { dataTransfer: { types: ['Files'] } });
  fireEvent(window, event);
  expect(event.defaultPrevented).toBe(false);
});
