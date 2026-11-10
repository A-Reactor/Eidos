// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveScreen } from '@/components/ui/ArchiveScreen';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { EditModal } from '@/components/game/EditModal';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { IdentitySelect } from '@/components/game/IdentitySelect';
import { DocumentLibrary } from '@/components/game/DocumentLibrary';
import { ResponsiveSidebar } from '@/components/ui/ResponsiveSidebar';
import { TitleScreen } from '@/components/game/TitleScreen';
import { PersonalityTracePanel } from '@/components/game/PersonalityTracePanel';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  useGameStore.setState({ ...useGameStore.getInitialState(), phase: 'identity', currentWorld: {
    ...buildRiftCityStartState().world,
    identityOptions: [{ id: 'visitor', name: '旅人', description: '从渡口出发', openingNarrative: '', startingScene: 'lower_entrance' }],
  } });
});
afterEach(() => { cleanup(); delete document.documentElement.dataset.motion; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the page return guard even when focus remains in a text field or outside the page', () => {
  let saved = false;
  render(React.createElement(ArchiveScreen, { title: '编辑', onBack: () => { saved = true; }, beforeBack: () => {} }, React.createElement('input', { 'aria-label': '草稿' })));
  const input = screen.getByLabelText('草稿'); input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(saved).toBe(false);
  cleanup();
  render(React.createElement(ArchiveScreen, { title: '资料', onBack: () => { saved = true; } }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(saved).toBe(true);
});

it('returns from a nested detail before leaving the outer page', () => {
  function Page() {
    const [detail, setDetail] = useState(true), [left, setLeft] = useState(false);
    return left ? React.createElement('p', null, '已离开') : React.createElement(ArchiveScreen, { title: '文档', onBack: () => setLeft(true) },
      detail && React.createElement(ArchiveScreen, { title: '详情', swipeBack: true, onBack: () => setDetail(false) }, React.createElement('input', { 'aria-label': '详情搜索' })));
  }
  render(React.createElement(Page));
  const input = screen.getByLabelText('详情搜索'); input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByText('详情')).toBeNull();
  expect(screen.getByText('文档')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByText('已离开')).toBeTruthy();
});

it('closes the visible dialog without invoking a background page or a hidden underlay', () => {
  const pageBack = vi.fn(), hiddenBack = vi.fn();
  function Page() {
    const [open, setOpen] = useState(true);
    return React.createElement(React.Fragment, null,
      React.createElement(ArchiveScreen, { title: '可见', onBack: pageBack }, open && React.createElement(InteractionDialog, { title: '确认', onClose: () => setOpen(false) } as React.ComponentProps<typeof InteractionDialog>, null)),
      React.createElement('div', { inert: true }, React.createElement(ArchiveScreen, { title: '底层', onBack: hiddenBack })));
  }
  render(React.createElement(Page));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(pageBack).not.toHaveBeenCalled(); expect(hiddenBack).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(pageBack).toHaveBeenCalledOnce(); expect(hiddenBack).not.toHaveBeenCalled();
});

it('ignores held Escape and composition without leaving the page', () => {
  const back = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '资料', onBack: back }));
  fireEvent.keyDown(window, { key: 'Escape', repeat: true });
  fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(back).toHaveBeenCalledOnce();
});

it('cancels only the discard confirmation inside a dirty editor', () => {
  const close = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '物品', onBack: close }, React.createElement(EditModal, { category: 'inventoryItem', title: '编辑物品', data: { name: '旧名字' }, onSave: vi.fn(), onClose: close })));
  fireEvent.change(screen.getByDisplayValue('旧名字'), { target: { value: '新名字' } });
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '放弃未保存的修改？' })).toBeNull();
  expect(screen.getByDisplayValue('新名字')).toBeTruthy(); expect(close).not.toHaveBeenCalled();
});

it('asks before leaving settings with unsaved changes and Escape keeps the draft', () => {
  useGameStore.setState({ phase: 'settings', navigationStack: ['title'] });
  render(React.createElement(SettingsScreen));
  fireEvent.click(screen.getByRole('button', { name: '阅读与自动操作' }));
  const input = screen.getByLabelText('自定义提示词（ALICE）');
  fireEvent.change(input, { target: { value: '保留这份草稿' } }); input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: '保存更改后再离开？' })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((screen.getByLabelText('自定义提示词（ALICE）') as HTMLTextAreaElement).value).toBe('保留这份草稿');
  expect(useGameStore.getState().phase).toBe('settings');
});

it('returns from name entry to identity selection before returning to the library', () => {
  render(React.createElement(IdentitySelect));
  fireEvent.click(screen.getByRole('button', { name: '选择身份：旅人' }));
  const name = screen.getByPlaceholderText('输入角色名字...');
  fireEvent.keyDown(name, { key: 'Escape' });
  expect(screen.getByRole('button', { name: '选择身份：旅人' })).toBeTruthy();
  expect(useGameStore.getState().phase).toBe('identity');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useGameStore.getState().phase).toBe('world_select');
});

it('returns from a mobile directory detail to its index before leaving', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  document.documentElement.dataset.motion = 'reduced';
  const back = vi.fn();
  const view = render(React.createElement(ArchiveScreen, { title: '目录', onBack: back, directoryFirst: true },
    React.createElement(ResponsiveSidebar, { label: '分类', className: 'test-index' }, React.createElement('button', null, '进入详情')),
    React.createElement('main', null, '详情正文')));
  fireEvent.click(screen.getByRole('button', { name: '进入详情' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(view.container.querySelector('section')?.dataset.mobileDirectory).toBe('index');
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(back).toHaveBeenCalledOnce();
  delete document.documentElement.dataset.motion;
});

it('leaves native dialog dismissal to the browser without activating background game listeners', () => {
  const back = vi.fn(), gameKey = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '游戏', onBack: back }, React.createElement('dialog', { open: true }, '原生菜单')));
  window.addEventListener('keydown', gameKey);
  try {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(back).not.toHaveBeenCalled(); expect(gameKey).not.toHaveBeenCalled();
  } finally { window.removeEventListener('keydown', gameKey); }
});

it('returns from document trash to the document list before leaving the documents page', async () => {
  const back = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '文档管理', onBack: back }, React.createElement(DocumentLibrary, { scope: { worldId: 'trash-escape', playthroughId: 'test' } })));
  await screen.findByText('还没有文档。');
  fireEvent.click(screen.getByRole('button', { name: '回收站' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByRole('button', { name: '回收站' })).toBeTruthy();
  expect(back).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(back).toHaveBeenCalledOnce();
});

it('closes the sandbox snapshot list from its text input with Escape', async () => {
  vi.useFakeTimers();
  useGameStore.setState({ phase: 'title', sandboxMode: true, loadSandboxSnapshots: async () => [] });
  render(React.createElement(TitleScreen));
  fireEvent.pointerDown(screen.getByRole('button', { name: '返回普通卷宗 001' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(650); });
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog.querySelector('input')!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(useGameStore.getState().phase).toBe('title');
});

it('closes the personality panel before the page behind it', () => {
  const pageBack = vi.fn(), close = vi.fn();
  render(React.createElement(ArchiveScreen, { title: '游戏', onBack: pageBack }, React.createElement(PersonalityTracePanel, { open: true, onClose: close })));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce(); expect(pageBack).not.toHaveBeenCalled();
});
