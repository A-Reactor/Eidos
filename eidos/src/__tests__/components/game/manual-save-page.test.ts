// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ManualSavePage } from '@/components/game/ManualSavePage';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { SaveSlot } from '@/lib/game/types';

beforeEach(() => {
  const { world } = buildRiftCityStartState();
  const slot = { id: 'save-a', type: 'manual', name: '钟楼前', worldId: world.id, playthroughId: 'pt-a', playerName: '林', currentSceneName: '旧钟楼',
    createdAt: 10, updatedAt: 1700000000000, gameTime: { day: 2, hour: 9, minute: 0 }, actionCount: 12, playDuration: 45, preview: '钟声响起。' } as SaveSlot;
  useGameStore.setState({ currentWorld: world, currentPlaythroughId: 'pt-a', cachedSaveSlots: [slot,
    { ...slot, id: 'other', name: '其他周目', playthroughId: 'pt-b' }, { ...slot, id: 'other-world', name: '其他世界', worldId: 'other' },
    { ...slot, id: 'auto', name: '自动恢复', type: 'autosave' }] });
});
afterEach(cleanup);
it('lists only this world and playthrough manual slots with readable progress metadata', () => {
  render(React.createElement(ManualSavePage, { onBack: vi.fn(), onSave: vi.fn(), busy: false }));
  expect(screen.getByRole('list', { name: '当前周目手动存档' }).textContent).toContain('钟楼前');
  expect(screen.getByText(/旧钟楼/)).toBeTruthy(); expect(screen.getByText(/第 12 步/)).toBeTruthy();
  expect(screen.queryByText('其他周目')).toBeNull(); expect(screen.queryByText('其他世界')).toBeNull(); expect(screen.queryByText('自动恢复')).toBeNull();
});
it('saves a named new slot once while pending and reports success', async () => {
  let finish!: (id: string) => void;
  const onSave = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  render(React.createElement(ManualSavePage, { onBack: vi.fn(), onSave, busy: false }));
  fireEvent.change(screen.getByLabelText('存档名称'), { target: { value: '  前往钟楼  ' } });
  fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
  fireEvent.click(screen.getByRole('button', { name: '保存中…' }));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('前往钟楼', undefined);
  await act(async () => { finish('new'); });
  expect(screen.getByRole('status').textContent).toContain('保存成功');
});
it('requires explicit confirmation before overwriting the selected slot and preserves it on failure', async () => {
  const onSave = vi.fn().mockResolvedValue('');
  render(React.createElement(ManualSavePage, { onBack: vi.fn(), onSave, busy: false }));
  fireEvent.click(screen.getByRole('button', { name: '覆盖存档 钟楼前' }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '覆盖存档 钟楼前' }));
  fireEvent.click(screen.getByRole('button', { name: '确认覆盖' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith(undefined, 'save-a'));
  expect((await screen.findByRole('alert')).textContent).toContain('保存失败');
  expect(screen.getByRole('button', { name: '覆盖存档 钟楼前' })).toBeTruthy();
});
