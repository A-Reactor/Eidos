// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRecordEdgeSwipe } from '@/components/ui/use-record-edge-swipe';
function Probe({ previous, next, enabled = true }: { previous: () => void; next: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useRecordEdgeSwipe(ref, { enabled, previous: true, next: true, onPrevious: previous, onNext: next });
  return React.createElement('section', { ref }, React.createElement('div', { className: 'eidos-record-scroll', 'data-testid': 'scroll' }, React.createElement('p', { 'data-testid': 'text' }, '正文')), React.createElement('textarea', { 'aria-label': '输入' }));
}
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number, x = 180) => {
  const finger = { identifier: 1, clientX: x, clientY: y };
  fireEvent[type](screen.getByTestId('text'), { touches: type === 'touchEnd' ? [] : [finger], changedTouches: [finger] });
};
const swipe = (from: number, to: number) => { touch('touchStart', from); touch('touchMove', to); touch('touchEnd', to); };
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup() {
  const previous = vi.fn(), next = vi.fn(); render(React.createElement(Probe, { previous, next }));
  const scroll = screen.getByTestId('scroll');
  Object.defineProperties(scroll, { clientHeight: { value: 300 }, scrollHeight: { value: 900 } });
  return { previous, next, scroll };
}
it('pulls down from the top and up from the bottom, once per completed gesture', () => {
  const { previous, next, scroll } = setup();
  touch('touchStart', 180); touch('touchMove', 290);
  expect(scroll.parentElement?.dataset.edgePull).toBe('previous-ready'); expect(previous).not.toHaveBeenCalled();
  touch('touchEnd', 290); expect(previous).toHaveBeenCalledOnce();
  scroll.scrollTop = 600; swipe(290, 180); expect(next).toHaveBeenCalledOnce();
});
it('does not navigate when ordinary scrolling merely reaches an edge or the pull is short', () => {
  const { previous, next, scroll } = setup();
  scroll.scrollTop = 120; touch('touchStart', 180); scroll.scrollTop = 0; touch('touchMove', 300); touch('touchEnd', 300);
  swipe(180, 215); touch('touchStart', 180); touch('touchMove', 185, 300); touch('touchEnd', 300, 300);
  expect(previous).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
});
it('respects editing focus and cancellation', () => {
  const { previous, next } = setup(); const input = screen.getByLabelText('输入');
  input.focus(); swipe(180, 300); input.blur();
  touch('touchStart', 180); touch('touchMove', 300); fireEvent.touchCancel(screen.getByTestId('text')); touch('touchEnd', 300);
  expect(previous).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
});
