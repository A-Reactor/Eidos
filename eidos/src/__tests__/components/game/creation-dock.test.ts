// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreationDock } from '@/components/game/creation/CreationDock';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('adjusts the progress dock within bounds and retains access to its content', () => {
  render(React.createElement(CreationDock, null, React.createElement('p', null, '生成材料仍可查看')));
  const handle = screen.getByRole('separator', { name: '生成进度高度' });
  const footer = screen.getByRole('contentinfo');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 800));
  fireEvent.keyDown(handle, { key: 'End' });
  expect(handle.getAttribute('aria-valuenow')).toBe('520');
  expect(footer.style.getPropertyValue('--creation-dock-height')).toBe('520px');
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(handle.getAttribute('aria-valuenow')).toBe('56');
  expect(screen.getByText('生成材料仍可查看')).toBeTruthy();
});

it('allows responsive default heights to change without treating observation as a manual resize', () => {
  let changed!: ResizeObserverCallback;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { changed = callback; }
    observe() {} disconnect() {}
  });
  let height = 176;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 390, this.tagName === 'FOOTER' ? height : 800);
  });
  render(React.createElement(CreationDock, null, '生成进度'));
  const footer = screen.getByRole('contentinfo'), handle = screen.getByRole('separator', { name: '生成进度高度' });
  changed([], {} as ResizeObserver);
  expect(footer.style.getPropertyValue('--creation-dock-height')).toBe('');
  height = 192; changed([], {} as ResizeObserver);
  expect(footer.style.getPropertyValue('--creation-dock-height')).toBe('');
  expect(handle.getAttribute('aria-valuenow')).toBe('192');
  height = 900; changed([], {} as ResizeObserver);
  expect(footer.style.getPropertyValue('--creation-dock-height')).toBe('520px');
});
