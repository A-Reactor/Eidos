// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVisualViewport } from '@/components/shell/use-visual-viewport';

function Probe() { useVisualViewport(); return null; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('follows keyboard height and pan, ignores zoom, and releases viewport overrides on unmount', () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport); vi.stubGlobal('innerWidth', 390);
  const { unmount } = render(React.createElement(Probe));
  const root = document.documentElement.style;
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('844px');
  act(() => { viewport.height = 420; viewport.offsetTop = 40; viewport.dispatchEvent(new Event('resize')); });
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('420px');
  expect(root.getPropertyValue('--eidos-viewport-top')).toBe('40px');
  act(() => { viewport.scale = 2; viewport.dispatchEvent(new Event('resize')); });
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('');
  act(() => { viewport.scale = 1; viewport.height = 844; viewport.offsetTop = 0; viewport.dispatchEvent(new Event('scroll')); });
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('844px');
  unmount();
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('');
  expect(root.getPropertyValue('--eidos-viewport-top')).toBe('');
  viewport.height = 400; viewport.dispatchEvent(new Event('resize'));
  expect(root.getPropertyValue('--eidos-viewport-height')).toBe('');
});

it('removes keyboard offsets when returning to a desktop width', () => {
  const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 30, scale: 1 });
  vi.stubGlobal('visualViewport', viewport); vi.stubGlobal('innerWidth', 390);
  render(React.createElement(Probe));
  act(() => { vi.stubGlobal('innerWidth', 1280); window.dispatchEvent(new Event('resize')); });
  expect(document.documentElement.style.getPropertyValue('--eidos-viewport-height')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--eidos-viewport-top')).toBe('');
});
