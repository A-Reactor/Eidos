// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileArchive } from '@/components/game/MobileArchive';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { resourceKey } from '@/lib/game/plugins/resources';
const callbacks = () => ({ onClose: vi.fn(), onNavigate: vi.fn(), onSave: vi.fn().mockResolvedValue('save-new'), onGallery: vi.fn(), onDocuments: vi.fn(), onVoices: vi.fn(), busy: false, usage: '3k token' });
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  world.gameplayPlugins = parseGameplayPlugins([
    { format: 'eidos-gameplay-plugin', version: 2, id: 'active', name: '旅途', description: '公开玩法', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], resources: {
      health: { name: '体力', min: 0, max: 10, initial: 8, unit: '点' },
      secret: { name: '隐藏进度', min: 0, max: 10, initial: 5, visible: false },
      fixed: { name: '固定数值', min: 2, max: 2, initial: 2 },
    } },
    { format: 'eidos-gameplay-plugin', version: 2, id: 'later', name: '后续玩法', description: '后续场景启用', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], activation: { requires: { revealed: true } }, resources: { power: { name: '尚未开放的能力', min: 0, max: 5, initial: 4 } } },
  ]);
  useGameStore.setState({ currentWorld: world, inventory: [], worldFlags: {}, gameplayResources: { [resourceKey('active', 'health')]: 3 } });
});
afterEach(cleanup);

it('provides a compact hierarchy and keeps resource services on a second level', () => {
  const cb = callbacks(); render(React.createElement(MobileArchive, cb));
  fireEvent.click(screen.getByRole('button', { name: /背包/ })); expect(cb.onNavigate).toHaveBeenCalledWith('inventory');
  fireEvent.click(screen.getByRole('button', { name: '资源与服务' }));
  expect(screen.getByRole('heading', { name: '资源与服务' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '图像管理' })); expect(cb.onGallery).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /音频管理/ })); expect(cb.onVoices).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '文档管理' })); expect(cb.onDocuments).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '资源与文档' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /返回档案目录/ }));
  expect(screen.getByRole('navigation', { name: '档案目录' })).toBeTruthy(); expect(cb.onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭游戏档案' })); expect(cb.onClose).toHaveBeenCalledOnce();
});
it('charts only active public resources, retaining exact values and omitting zero-range bars', () => {
  render(React.createElement(MobileArchive, callbacks()));
  const meter = screen.getByRole('meter', { name: '体力进度' });
  expect(meter.getAttribute('aria-valuenow')).toBe('3');
  expect((meter.firstElementChild as HTMLElement).style.width).toBe('30%');
  expect(screen.queryByText('隐藏进度')).toBeNull(); expect(screen.queryByRole('meter', { name: /尚未开放/ })).toBeNull();
  expect(screen.getByText('固定数值')).toBeTruthy(); expect(screen.queryByRole('meter', { name: '固定数值进度' })).toBeNull();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.later.revealed': true } }));
  expect(screen.getByRole('meter', { name: '尚未开放的能力进度' }).getAttribute('aria-valuenow')).toBe('4');
});


it('puts the world name after the archive title in a unified header', () => {
  const view = render(React.createElement(MobileArchive, callbacks()));
  const heading = screen.getByRole('heading', { name: '游戏档案' });
  expect(heading.nextElementSibling?.tagName).toBe('SMALL');
  expect(heading.nextElementSibling?.textContent).toBe(useGameStore.getState().currentWorld!.name);
  expect(view.container.querySelector('.eidos-mobile-archive-header [aria-hidden="true"]')).not.toBeNull();
});


it('opens manual saving as a directory peer and removes the footer', () => {
  const cb = callbacks(); const view = render(React.createElement(MobileArchive, cb));
  const entry = screen.getByRole('button', { name: '手动保存' });
  expect(entry.closest('nav')?.getAttribute('aria-label')).toBe('档案目录');
  expect(view.container.querySelector('footer')).toBeNull();
  expect(screen.queryByText('保存进度')).toBeNull();
  fireEvent.click(entry);
  expect(screen.getByRole('heading', { name: '手动保存' })).toBeTruthy();
  expect(cb.onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回档案目录' }));
  expect(screen.getByRole('navigation', { name: '档案目录' })).toBeTruthy();
  expect(cb.onClose).not.toHaveBeenCalled();
});
