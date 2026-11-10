// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMobileSwipe } from '@/components/ui/use-mobile-swipe';

function Probe({ onSwipe, direction = 'right', enabled = true }: { onSwipe: () => void; direction?: 'left' | 'right'; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useMobileSwipe(ref, { onSwipe, direction, enabled });
  return React.createElement('div', { ref, 'data-testid': 'page' },
    React.createElement('p', { 'data-testid': 'prose', onClick: onSwipe }, '正文'),
    React.createElement('button', { 'data-testid': 'button' }, '按钮'),
    React.createElement('textarea', { 'data-testid': 'input' }),
    React.createElement('div', { className: 'eidos-worldline-canvas', 'data-testid': 'graph' }),
    React.createElement('div', { className: 'eidos-mod-surface', 'data-testid': 'mod' }),
    React.createElement('div', { role: 'separator', 'data-testid': 'separator' }),
    React.createElement('div', { style: { overflowX: 'auto' }, 'data-testid': 'horizontal' }, React.createElement('p', { 'data-testid': 'horizontal-text' }, '横向列表')),
    React.createElement('div', { role: 'dialog' }, React.createElement('p', { 'data-testid': 'dialog-text' }, '确认内容')),
    React.createElement('dialog', { open: true }, React.createElement('p', { 'data-testid': 'native-dialog-text' }, '目录内容')),
  );
}
function touch(target: Element, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y = 180, count = 1) {
  const finger = { identifier: 1, clientX: x, clientY: y };
  fireEvent[type](target, { touches: type === 'touchEnd' ? [] : Array.from({ length: count }, (_, i) => ({ ...finger, identifier: i + 1 })), changedTouches: [finger] });
}
function swipe(target: Element, from = 35, to = 160) { touch(target, 'touchStart', from); touch(target, 'touchMove', to); touch(target, 'touchEnd', to); }
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 844));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('opens with a left swipe and returns with a right swipe from the page center', () => {
  const onSwipe = vi.fn(); const view = render(React.createElement(Probe, { onSwipe, direction: 'left' }));
  swipe(screen.getByTestId('prose'), 250, 120); expect(onSwipe).toHaveBeenCalledOnce();
  view.rerender(React.createElement(Probe, { onSwipe, direction: 'right' }));
  swipe(screen.getByTestId('prose'), 160, 290); expect(onSwipe).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('page').hasAttribute('data-swiping')).toBe(false);
});
it('leaves vertical scrolling, short drags and multiple fingers alone', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe })); const prose = screen.getByTestId('prose');
  swipe(prose, 160, 190);
  touch(prose, 'touchStart', 35); touch(prose, 'touchMove', 38, 270); touch(prose, 'touchEnd', 160, 280);
  touch(prose, 'touchStart', 35); touch(prose, 'touchMove', 160, 180, 2); touch(prose, 'touchEnd', 160);
  expect(onSwipe).not.toHaveBeenCalled();
});
it('does not steal form, dialog, graph or mod gestures', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe }));
  for (const id of ['graph', 'mod', 'separator', 'dialog-text', 'native-dialog-text']) swipe(screen.getByTestId(id));
  expect(onSwipe).not.toHaveBeenCalled();
});
it('accepts swipes over buttons and pauses across the entire page while a text field has focus', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe }));
  swipe(screen.getByTestId('button'), 160, 290); expect(onSwipe).toHaveBeenCalledOnce();
  const input = screen.getByTestId('input');
  swipe(input, 160, 290); expect(onSwipe).toHaveBeenCalledTimes(2);
  input.focus();
  swipe(screen.getByTestId('prose'), 160, 290); swipe(screen.getByTestId('button'), 160, 290);
  swipe(input, 160, 290); expect(onSwipe).toHaveBeenCalledTimes(2);
  input.blur(); swipe(screen.getByTestId('prose'), 160, 290); expect(onSwipe).toHaveBeenCalledTimes(3);
});
it('leaves horizontal scrolling inside a page to its own list', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe }));
  Object.defineProperties(screen.getByTestId('horizontal'), { scrollWidth: { value: 800 }, clientWidth: { value: 200 } });
  swipe(screen.getByTestId('horizontal-text')); expect(onSwipe).not.toHaveBeenCalled();
});
it('preserves text selection and long press', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe })); const prose = screen.getByTestId('prose');
  const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '已选择的文字' } as Selection);
  swipe(prose); expect(onSwipe).not.toHaveBeenCalled(); selection.mockRestore();
  vi.useFakeTimers(); touch(prose, 'touchStart', 35); vi.advanceTimersByTime(600); touch(prose, 'touchMove', 160); touch(prose, 'touchEnd', 160);
  expect(onSwipe).not.toHaveBeenCalled();
});
it('does not turn a drag into a paragraph click, while the next tap still works', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe })); const prose = screen.getByTestId('prose');
  swipe(prose, 35, 65); fireEvent.click(prose, { detail: 1 }); expect(onSwipe).not.toHaveBeenCalled();
  touch(prose, 'touchStart', 35); touch(prose, 'touchEnd', 35); fireEvent.click(prose, { detail: 1 }); expect(onSwipe).toHaveBeenCalledOnce();
});
it('cancels on touchcancel and honors disabled or desktop states', () => {
  const onSwipe = vi.fn(); const view = render(React.createElement(Probe, { onSwipe })); const prose = screen.getByTestId('prose');
  touch(prose, 'touchStart', 35); touch(prose, 'touchMove', 160); fireEvent.touchCancel(prose); touch(prose, 'touchEnd', 160);
  view.rerender(React.createElement(Probe, { onSwipe, enabled: false })); swipe(prose);
  view.rerender(React.createElement(Probe, { onSwipe })); vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }))); swipe(prose);
  expect(onSwipe).not.toHaveBeenCalled();
});

it('moves the page before release and springs back after an incomplete drag', () => {
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe }));
  const page = screen.getByTestId('page'), prose = screen.getByTestId('prose');
  touch(prose, 'touchStart', 100); touch(prose, 'touchMove', 135);
  expect(page.style.getPropertyValue('--swipe-x')).toBe('35px');
  expect(onSwipe).not.toHaveBeenCalled();
  touch(prose, 'touchEnd', 135);
  expect(page.style.getPropertyValue('--swipe-x')).toBe('');
  expect(onSwipe).not.toHaveBeenCalled();
});

it('accepts a deliberate short flick but springs back from the same slow movement', () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn(); render(React.createElement(Probe, { onSwipe }));
  const prose = screen.getByTestId('prose');
  touch(prose, 'touchStart', 100); vi.advanceTimersByTime(40); touch(prose, 'touchMove', 142); touch(prose, 'touchEnd', 142);
  expect(onSwipe).toHaveBeenCalledOnce();
  touch(prose, 'touchStart', 100); vi.advanceTimersByTime(100); touch(prose, 'touchMove', 120);
  vi.advanceTimersByTime(200); touch(prose, 'touchMove', 142); touch(prose, 'touchEnd', 142);
  expect(onSwipe).toHaveBeenCalledOnce();
});
