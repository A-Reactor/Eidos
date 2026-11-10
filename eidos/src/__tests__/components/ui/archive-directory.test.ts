// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('enters the directory, reveals a real detail card while dragging, and returns one level at a time', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const back = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '背包', directoryFirst: true, onBack: back },
    React.createElement('div', null, React.createElement(ResponsiveSidebar, { label: '物品目录', className: 'index' }, React.createElement('button', null, '地图')),
      React.createElement('main', null, React.createElement('textarea', { defaultValue: '详情草稿' })))));
  const page = view.container.querySelector('section')!, main = view.container.querySelector('main')!;
  expect(main.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '地图' }));
  expect(page.getAttribute('data-mobile-directory')).toBe('detail');
  const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 200 });
  const pull = (to: number) => { fireEvent.touchStart(main, { touches: [finger(100)] }); fireEvent.touchMove(main, { touches: [finger(to)] }); };
  pull(135); expect(page.style.getPropertyValue('--directory-drag')).toBe('35px');
  fireEvent.touchCancel(main); expect(page.getAttribute('data-mobile-directory')).toBe('detail');
  pull(240); fireEvent.touchEnd(main, { touches: [], changedTouches: [finger(240)] });
  expect(page.getAttribute('data-mobile-directory')).toBe('index'); expect(back).not.toHaveBeenCalled();
  expect(view.container.querySelector('textarea')?.value).toBe('详情草稿');
  pull(240); fireEvent.touchEnd(main, { touches: [], changedTouches: [finger(240)] }); expect(back).toHaveBeenCalledOnce();
});
