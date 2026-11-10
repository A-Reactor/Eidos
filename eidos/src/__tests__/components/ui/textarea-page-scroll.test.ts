// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTextareaPageScroll } from '@/components/ui/use-textarea-page-scroll';

function Probe() {
  const root = useRef<HTMLDivElement>(null);
  useTextareaPageScroll(root);
  return React.createElement('div', { ref: root }, React.createElement('div', { style: { overflowY: 'auto' }, 'data-testid': 'page' }, React.createElement('textarea', { 'aria-label': '世界概述' })));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('scrolls the page over an unfocused field and leaves focused content scrolling native', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  render(React.createElement(Probe));
  const page = screen.getByTestId('page'), field = screen.getByRole('textbox');
  const finger = (y: number) => ({ identifier: 1, clientX: 160, clientY: y });
  fireEvent.touchStart(field, { touches: [finger(300)] });
  fireEvent.touchMove(field, { touches: [finger(220)] });
  fireEvent.touchEnd(field, { touches: [], changedTouches: [finger(220)] });
  expect(page.scrollTop).toBe(80);
  expect(field.scrollTop).toBe(0);
  field.focus();
  fireEvent.touchStart(field, { touches: [finger(300)] }); fireEvent.touchMove(field, { touches: [finger(220)] });
  fireEvent.wheel(field, { deltaY: 100 });
  expect(page.scrollTop).toBe(80);
  field.blur(); fireEvent.wheel(field, { deltaY: 100 });
  expect(page.scrollTop).toBe(180);
});
