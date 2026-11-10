// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const content = React.createElement('p', null, '正文');
function drag(page: HTMLElement, to: number) {
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 200 });
  fireEvent.touchStart(page, { touches: [finger(80)] });
  fireEvent.touchMove(page, { touches: [finger(to)] });
  fireEvent.touchEnd(page, { touches: [], changedTouches: [finger(to)] });
}
it('settles a completed swipe before navigating, and completes only once without transition events', () => {
  const onBack = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '详情', onBack, swipeBack: true }, content));
  const page = view.container.querySelector('section')!;
  drag(page, 210);
  expect(onBack).not.toHaveBeenCalled();
  expect(page.dataset.mobileLeaving).toBe('true');
  act(() => { vi.advanceTimersByTime(240); });
  expect(onBack).toHaveBeenCalledOnce();
  fireEvent.transitionEnd(page, { propertyName: 'transform' });
  expect(onBack).toHaveBeenCalledOnce();
});
it('springs back without navigating after a short drag and clears completion when unmounted', () => {
  const onBack = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '详情', onBack, swipeBack: true }, content));
  const page = view.container.querySelector('section')!;
  drag(page, 110); act(() => { vi.runAllTimers(); });
  expect(onBack).not.toHaveBeenCalled();
  expect(page.style.getPropertyValue('--swipe-x')).toBe('');
  drag(page, 210); view.unmount(); act(() => { vi.runAllTimers(); });
  expect(onBack).not.toHaveBeenCalled();
});
it('lets an unsaved-changes guard approve before starting the exit', () => {
  let approve: (() => void) | undefined;
  const onBack = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '详情', onBack, swipeBack: true, beforeBack: leave => { approve = leave; } }, content));
  const page = view.container.querySelector('section')!;
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(page.dataset.mobileLeaving).toBeUndefined();
  approve!(); expect(page.dataset.mobileLeaving).toBe('true');
  act(() => { vi.runAllTimers(); }); expect(onBack).toHaveBeenCalledOnce();
});
it('returns immediately when reduced motion is selected', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const onBack = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '详情', onBack, swipeBack: true }, content));
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(onBack).toHaveBeenCalledOnce();
});
