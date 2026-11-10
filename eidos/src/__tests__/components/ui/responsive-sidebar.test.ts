// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';

let mobile = true;
const listeners = new Set<() => void>();
beforeEach(() => {
  mobile = true;
  vi.stubGlobal('matchMedia', () => ({ matches: mobile, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) }));
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function () { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function () { this.removeAttribute('open'); } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); listeners.clear(); });

function Probe() {
  const [page, setPage] = useState('世界信息');
  const [draft, setDraft] = useState('');
  return React.createElement(React.Fragment, null,
    React.createElement(ResponsiveSidebar, { label: '创建分类', current: page, className: 'original-sidebar', as: 'nav' }, [
      React.createElement('button', { key: 'mode', 'data-sidebar-keep-open': true, onClick: () => setPage('资料档案') }, '资料建档'),
      React.createElement('button', { key: 'disabled', disabled: true }, '不可用'),
      React.createElement('button', { key: 'world', 'aria-current': page === '世界信息' ? 'page' : undefined, onClick: () => setPage('世界信息') }, '世界信息'),
      React.createElement('button', { key: 'style', 'aria-current': page === '文风写法' ? 'page' : undefined, onClick: () => setPage('文风写法') }, '文风写法'),
    ]),
    React.createElement('textarea', { 'aria-label': '表单草稿', value: draft, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value) }));
}

it('opens a modal directory, keeps mode changes open and closes after choosing a section without losing the form', () => {
  render(React.createElement(Probe));
  const trigger = screen.getByRole('button', { name: '创建分类' });
  fireEvent.change(screen.getByLabelText('表单草稿'), { target: { value: '保留世界设定' } });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: '创建分类' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '世界信息' }));
  fireEvent.click(screen.getByRole('button', { name: '资料建档' }));
  fireEvent.click(screen.getByRole('button', { name: '不可用' }));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '文风写法' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger.textContent).toContain('文风写法');
  expect(document.activeElement).toBe(trigger);
  expect((screen.getByLabelText('表单草稿') as HTMLTextAreaElement).value).toBe('保留世界设定');
});

it('supports backdrop, explicit close and native cancel without navigating away', () => {
  render(React.createElement(Probe));
  const trigger = screen.getByRole('button', { name: '创建分类' });
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('dialog'));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: '收起菜单' }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger); fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('restores the desktop sidebar when resizing an open menu, with one directory and preserved form state', () => {
  render(React.createElement(Probe));
  fireEvent.change(screen.getByLabelText('表单草稿'), { target: { value: '跨尺寸草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '创建分类' }));
  act(() => { mobile = false; listeners.forEach(callback => callback()); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: '创建分类' })).toBeNull();
  expect(screen.getByRole('navigation').className).toBe('original-sidebar');
  expect(screen.getAllByRole('button', { name: '世界信息' })).toHaveLength(1);
  act(() => { mobile = true; listeners.forEach(callback => callback()); });
  expect(screen.getByRole('button', { name: '创建分类' }).getAttribute('aria-expanded')).toBe('false');
  expect((screen.getByLabelText('表单草稿') as HTMLTextAreaElement).value).toBe('跨尺寸草稿');
});

function swipe(target: Element, from: number, to: number, y = 200, endY = y) {
  const finger = (x: number, clientY: number) => ({ identifier: 1, clientX: x, clientY });
  fireEvent.touchStart(target, { touches: [finger(from, y)] });
  fireEvent.touchMove(target, { touches: [finger(to, endY)] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [finger(to, endY)] });
}

it('opens from the page center and swipes left across menu buttons to close, without selecting or leaving', () => {
  const back = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '测试', onBack: back }, React.createElement(Probe)));
  const page = view.container.querySelector('section')!;
  const trigger = screen.getByRole('button', { name: '创建分类' });
  swipe(page, 160, 285, 200, 360); expect(trigger.getAttribute('aria-expanded')).toBe('false');
  swipe(trigger, 160, 285); expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const item = screen.getByRole('button', { name: '文风写法' });
  swipe(item, 160, 35, 200, 360); expect(trigger.getAttribute('aria-expanded')).toBe('true');
  swipe(item, 160, 35);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(item, { detail: 1 });
  expect(trigger.textContent).toContain('世界信息');
  expect(back).not.toHaveBeenCalled();
});

it('keeps creation content stationary while its overlay menu opens and closes by swipe', () => {
  const view = render(React.createElement(ArchiveScreen, { title: '创造世界', className: 'eidos-world-create', onBack: vi.fn() }, React.createElement(Probe)));
  const page = view.container.querySelector<HTMLElement>('section')!;
  page.scrollTop = 160;
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 240 });
  fireEvent.touchStart(page, { touches: [finger(100)] });
  fireEvent.touchMove(page, { touches: [finger(220)] });
  expect(page.style.getPropertyValue('--swipe-x')).toBe('');
  expect(page.scrollTop).toBe(160);
  fireEvent.touchEnd(page, { touches: [], changedTouches: [finger(220)] });
  const menu = screen.getByRole('dialog', { name: '创建分类' });
  swipe(menu, 220, 80);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(page.style.getPropertyValue('--swipe-x')).toBe('');
  expect(page.scrollTop).toBe(160);
});

it('uses left swipe for the right creation menu and right swipe to return after the page exits', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const back = vi.fn();
  const content = React.createElement(ResponsiveSidebar, { label: '创建分类', className: 'original-sidebar', side: 'right' }, React.createElement('button', null, '世界信息'));
  const view = render(React.createElement(ArchiveScreen, { title: '创造世界', onBack: back, menuSide: 'right', navigationPlacement: 'end' }, content));
  const page = view.container.querySelector<HTMLElement>('section')!;
  Object.defineProperty(page, 'clientWidth', { value: 390 });
  swipe(page, 240, 100);
  const dialog = screen.getByRole('dialog', { name: '创建分类' });
  expect(dialog.getAttribute('data-side')).toBe('right');
  expect(page.style.getPropertyValue('--swipe-x')).toBe('');
  swipe(dialog, 100, 240);
  expect(screen.queryByRole('dialog')).toBeNull();
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 240 });
  fireEvent.touchStart(page, { touches: [finger(80)] });
  fireEvent.touchMove(page, { touches: [finger(210)] });
  expect(page.style.getPropertyValue('--swipe-x')).toBe('130px');
  fireEvent.touchEnd(page, { touches: [], changedTouches: [finger(210)] });
  expect(back).not.toHaveBeenCalled();
  expect(page.dataset.mobileLeaving).toBe('true');
  fireEvent.transitionEnd(page, { propertyName: 'transform' });
  expect(back).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
});
