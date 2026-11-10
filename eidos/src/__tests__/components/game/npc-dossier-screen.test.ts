// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { NpcDossierScreen } from '@/components/game/NpcDossierScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { EncyclopediaEntry, WorldLineNode } from '@/lib/game/types';

vi.mock('@/lib/game/cas-storage', async original => ({ ...await original<object>(), loadBlob: vi.fn() }));
import { loadBlob } from '@/lib/game/cas-storage';
const time = { day: 2, hour: 9, minute: 30 };
const node: WorldLineNode = { id: 'a', parentId: null, childIds: [], stepNumber: 1, playerInput: '询问林',
  aiResponse: '「林：明天见。」\n\n隐藏的后续秘密。', playerVisibleText: '「林：明天见。」',
  summary: '隐藏动机', gameTime: time, sceneId: 'dock', sceneName: '渡口', dayNumber: 2, createdAt: 1,
  timeSpent: time, worldImpacts: [], snapshotHash: 'snap-a', segmentHash: '', generationComplete: true };
const known: EncyclopediaEntry = { id: 'lin', name: '林', type: 'npc', description: '观测局记录员',
  knowledge: [], firstEncountered: time, lastUpdated: time, relatedEntries: [] };
const persist = useGameStore.getState().persistWorldLineData;
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  vi.mocked(loadBlob).mockReset().mockResolvedValue({ worldId: world.id, encyclopedia: [known] });
  useGameStore.setState({ currentWorld: world, currentPlaythroughId: 'test-npc', currentNode: { ...node }, allNodes: { a: { ...node } },
    phase: 'npc_dossiers', navigationStack: ['playing'], worldLine: null, playerName: '玩家', encyclopedia: [],
    persistWorldLineData: vi.fn().mockResolvedValue(undefined) });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { cleanup(); useGameStore.setState({ persistWorldLineData: persist }); vi.unstubAllGlobals(); });

describe('character dossier screen', () => {
  it('shows only read testimony, opens its source without changing progress, and returns', async () => {
    render(React.createElement(NpcDossierScreen));
    await screen.findByRole('button', { name: '查看林的档案' });
    expect(screen.queryByText('观测局记录员')).toBeNull();
    expect(screen.queryByText(/隐藏的后续秘密/)).toBeNull();
    expect(screen.queryByText(/隐藏动机/)).toBeNull();
    for (const label of ['接触记录', '相关线索与证词']) {
      const summary = screen.getByText(label, { selector: 'summary' });
      expect(summary.closest('details')?.open).toBe(false);
    }
    fireEvent.click(screen.getByText('相关线索与证词', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: '→ 查看来源 · 渡口' }));
    const dialog = screen.getByRole('dialog', { name: '来源原文' });
    expect(within(dialog).getByText('「林：明天见。」')).toBeTruthy();
    expect(useGameStore.getState().currentNode?.id).toBe('a');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(useGameStore.getState().phase).toBe('playing');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('saves a note with retry, inherits it on a child, and keeps future edits off the parent', async () => {
    useGameStore.setState({ persistWorldLineData: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined) });
    render(React.createElement(NpcDossierScreen));
    const text = await screen.findByRole('textbox', { name: '林的玩家备注' });
    fireEvent.change(text, { target: { value: '他的时间说法有疑点' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await screen.findByText('备注已保存');
    expect(useGameStore.getState().allNodes.a.playerNpcNotes).toEqual({ 林: '他的时间说法有疑点' });
    const child = { ...node, id: 'b', parentId: 'a', snapshotHash: 'snap-b', aiResponse: '「林：晚上见。」', playerVisibleText: '「林：晚上见。」' };
    act(() => useGameStore.setState({ currentNode: child, allNodes: { ...useGameStore.getState().allNodes, b: child } }));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('他的时间说法有疑点'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '后来发现的新疑点' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    await screen.findByText('备注已保存');
    act(() => useGameStore.setState({ currentNode: useGameStore.getState().allNodes.a }));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('他的时间说法有疑点'));
    expect(useGameStore.getState().allNodes.a.aiResponse).toBe(node.aiResponse);
    expect(useGameStore.getState().encyclopedia).toEqual([]);
  });
  it('searches known names and provides an empty state without revealing world NPCs', async () => {
    render(React.createElement(NpcDossierScreen));
    await screen.findByRole('button', { name: '查看林的档案' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '尚未认识' } });
    expect(screen.getByText('没有找到这位人物。')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    expect(screen.getByRole('textbox', { name: '林的玩家备注' })).toBeTruthy();
  });
  it('keeps read records available if public snapshot loading fails', async () => {
    vi.mocked(loadBlob).mockRejectedValueOnce(new Error('missing snapshot'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(React.createElement(NpcDossierScreen));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '林的玩家备注' })).toBeTruthy();
    vi.mocked(loadBlob).mockResolvedValue({ worldId: useGameStore.getState().currentWorld?.id, encyclopedia: [known] });
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    warn.mockRestore();
  });
});

it('uses the default avatar or portrait in both the character index and dossier', async () => {
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: useGameStore.getState().currentWorld!.id, targetType: 'character', targetId: '林', slot: 'portrait', imageUrl: '/lin-default.png', source: 'uploaded' });
  useGameStore.setState({ midoriAssetRegistry: registry });
  const view = render(React.createElement(NpcDossierScreen));
  await screen.findByRole('button', { name: '查看林的档案' });
  expect(view.container.querySelectorAll('.eidos-npc-monogram img[src="/lin-default.png"]')).toHaveLength(2);
});
