// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResourceGrid } from '@/components/game/gallery/ResourceGrid';
import type { ImageResource } from '@/lib/game/midori/image-resource';

const image: ImageResource = { id: 'cat', worldId: 'world', type: 'character', targetId: '猫', label: '猫',
  tags: ['开心', '夜间礼服'], description: '', imageUrl: '/cat.gif', source: 'uploaded', createdAt: 1, updatedAt: 1 };
const props = () => ({ target: { type: 'character' as const, targetId: '猫', label: '猫' }, images: [image], busy: false, onUpload: vi.fn(), onOpen: vi.fn() });
const columns = () => Number(document.querySelector<HTMLElement>('.eidos-gallery-resource-grid')?.style.getPropertyValue('--album-columns'));
const album = (p: React.ComponentProps<typeof ResourceGrid> = props()) => React.createElement('section', { className: 'eidos-gallery-screen' },
  React.createElement('header', null, '图像管理'), React.createElement('aside', null, '人物目录'),
  React.createElement(ResourceGrid, p));
const pinchWheel = (element: Element, deltaY: number) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY });
  fireEvent(element, event); return event;
};
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('lets players enlarge previews down to one column and remembers it after changing the viewed object', () => {
  const view = render(album());
  pinchWheel(screen.getByText('图像管理'), -500);
  expect(columns()).toBe(1);
  expect(screen.queryByRole('button', { name: '放大预览' })).toBeNull();
  expect(screen.queryByRole('button', { name: '缩小预览' })).toBeNull();
  expect(screen.queryByLabelText('每行预览数')).toBeNull();
  view.unmount(); render(album());
  expect(columns()).toBe(1);
  pinchWheel(screen.getByText('人物目录'), 115);
  expect(columns()).toBe(2);
});

it('uses trackpad pinch to change density but leaves ordinary wheel scrolling alone', () => {
  const view = render(album());
  const surface = view.container.querySelector('.eidos-gallery-screen')!;
  const start = columns();
  const scroll = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 150 });
  fireEvent(surface, scroll);
  expect(scroll.defaultPrevented).toBe(false); expect(columns()).toBe(start);
  const pinch = pinchWheel(screen.getByText('人物目录'), -250);
  expect(pinch.defaultPrevented).toBe(true); expect(columns()).toBe(1);
});

it('pinches with two fingers without opening a picture, and keeps a single finger available for scrolling', () => {
  const p = props(), view = render(album(p));
  const grid = view.container.querySelector('header')!;
  const point = (identifier: number, clientX: number) => ({ identifier, clientX, clientY: 200 });
  const one = new Event('touchmove', { bubbles: true, cancelable: true });
  Object.defineProperty(one, 'touches', { value: [point(1, 100)] }); fireEvent(grid, one);
  expect(one.defaultPrevented).toBe(false);
  fireEvent.touchStart(grid, { touches: [point(1, 100), point(2, 180)] });
  fireEvent.touchMove(grid, { touches: [point(1, 0), point(2, 400)] });
  fireEvent.touchEnd(grid, { touches: [] });
  expect(columns()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: '查看图像：猫 · 开心 · 夜间礼服' }), { detail: 1 });
  expect(p.onOpen).not.toHaveBeenCalled();
});

it('places the complete tag text inside the image preview and preserves native GIF playback', () => {
  render(album({ ...props(), defaultUrl: image.imageUrl }));
  expect(screen.getByText('默认').className).toBe('eidos-gallery-default-marker');
  const preview = screen.getByRole('button', { name: '查看图像：猫 · 开心 · 夜间礼服' });
  expect(preview.textContent).toContain('开心 · 夜间礼服');
  expect(preview.querySelector('img')?.getAttribute('src')).toBe('/cat.gif');
  expect(preview.parentElement?.querySelector('.eidos-gallery-tile-tags')?.parentElement).toBe(preview);
  expect(screen.getByLabelText('上传 猫 的立绘').getAttribute('accept')).toContain('image/gif');
});

it('supports WebKit trackpad gestures without changing the surrounding page zoom', () => {
  const view = render(album());
  const grid = view.container.querySelector('header')!;
  const gesture = (type: string, scale: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'scale', { value: scale }); fireEvent(grid, event); return event;
  };
  expect(gesture('gesturestart', 1).defaultPrevented).toBe(true);
  expect(gesture('gesturechange', 4).defaultPrevented).toBe(true);
  expect(columns()).toBe(1);
  gesture('gestureend', 4);
});
