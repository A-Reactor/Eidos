// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { BackButton } from '@/components/ui/BackButton';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('puts a single directory back button on the right and the explanation immediately after the title', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const back = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '地图', subtitle: '已知地点', directoryFirst: true, onBack: back,
    action: React.createElement(BackButton, { onClick: back }) }, React.createElement('div', null,
    React.createElement(ResponsiveSidebar, { label: '已知地点', className: 'index' }, React.createElement('button', null, '地点A')),
    React.createElement('main', null, '地点详情'))));
  const header = view.container.querySelector('.eidos-archive-header')!;
  expect(header.lastElementChild?.contains(screen.getByRole('button', { name: '返回' }))).toBe(true);
  expect(header.querySelector('h1')?.nextElementSibling).toBe(screen.getByRole('button', { name: '页面说明' }));
  expect(header.querySelectorAll('.eidos-back-button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '地点A' }));
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(view.container.querySelector('[data-mobile-directory]')?.getAttribute('data-mobile-directory')).toBe('index');
  expect(back).not.toHaveBeenCalled();
});


it('keeps the phone directory in its initial index position in server markup before viewport detection', () => {
  const markup = renderToString(React.createElement(ArchiveScreen, { title: '地图', directoryFirst: true },
    React.createElement('div', null,
      React.createElement(ResponsiveSidebar, { label: '已知地点', className: 'map' }, '地图目录'),
      React.createElement('main', null, '地点详情'))));
  const container = document.createElement('div'); container.innerHTML = markup;
  expect(container.querySelector('[data-mobile-directory="index"]')).not.toBeNull();
  expect(container.querySelector('.eidos-directory-index + main')).not.toBeNull();
});
