import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettings, loadSettings } from '@/lib/game/settings';
import { GameScreen } from '@/components/game/GameScreen';
import { hudWorld } from '../../lib/game/gameplay-resource-fixtures';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldLineNode } from '@/lib/game/types';
import { speculativeEngine } from '@/lib/ai/speculation';
import { getSceneById } from '@/lib/game/scene-utils';
vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay: () => {}, stop: () => {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor: () => {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); });
beforeEach(() => {
  localStorage.clear();
  useGameStore.setState({ gameplayResources: {}, worldFlags: {},readingView:null,readingSegments:null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const { world } = buildRiftCityStartState();
  const node: WorldLineNode = { id: 'read', parentId: null, stepNumber: 1, playerInput: '听船夫说话', aiResponse: '你好。\n\n未读秘密。', playerVisibleText: '', summary: '秘密总结', worldImpacts: ['秘密计划'], gameTime: { day: 1, hour: 8, minute: 0 }, sceneId: 'dock', sceneName: '渡口', dayNumber: 1, createdAt: 1, childIds: [], timeSpent: { day: 0, hour: 0, minute: 1 }, snapshotHash: '', segmentHash: '', generationComplete: true };
  useGameStore.setState({ phase: 'playing', currentWorld: world, currentScene: null, currentSceneId: '', sceneNarrative: '你好。', allNodes: { read: node }, currentNode: node, worldLine: null, isLoading: false, history: [], availableActions: [], savedSegments: [{ type: 'narration', text: '你好。' }, { type: 'narration', text: '未读秘密。' }], savedSegmentIndex: 0, savedIsShowingSegments: true, midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
});
it.each([true, false])('saves a document reply without committing game effects, streaming=%s', async streaming => {
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only', autoAdvance: false, autoSelect: false, enableSpeculation: false });
  const text = '完整分析。'.repeat(250) + '全文末尾';
  const original = useGameStore.getState();
  useGameStore.setState({ currentPlaythroughId: `document-flow-${streaming}`, sandboxMode: false, availableActions: ['继续'], savedIsShowingSegments: false });
  const before = useGameStore.getState();
  const data = { document: { title: '测试报告', format: 'markdown', content: text, rawOutput: 'raw' }, itemsGained: [{ id: 'fake', name: '假物品' }], timeSpent: { day: 99, hour: 0, minute: 0 }, sceneChanges: ['fake'], sandboxToolRequests: [{ toolId: 'ui.lock_actions' }] };
  vi.stubGlobal('fetch', vi.fn(async url => String(url).includes('/api/game/action')
    ? streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`) : Response.json(data)
    : Response.json({})));
  try {
    render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '请写一份报告' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'Enter' });
    await waitFor(() => expect(useGameStore.getState().phase).toBe('documents'));
    const selection = useGameStore.getState().documentSelection!;
    const { loadModelDocuments } = await import('@/lib/game/model-documents');
    expect((await loadModelDocuments(selection.scope)).find(doc => doc.id === selection.initialId)?.content).toBe(text);
    const after = useGameStore.getState();
    expect(after.gameTime).toEqual(before.gameTime);
    expect(after.history).toBe(before.history);
    expect(after.currentNode?.id).toBe(before.currentNode?.id);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.currentSceneId).toBe(before.currentSceneId);
    expect(after.availableActions).toEqual(before.availableActions);
  } finally { useGameStore.setState({ currentPlaythroughId: original.currentPlaythroughId }); }
});
describe('game reading flow', () => {
  it('uses saved reading shortcuts while ignoring IME, modifiers and input focus', () => {
    const settings = loadSettings();
    saveSettings({ ...settings, keyboardShortcuts: { ...settings.keyboardShortcuts, advance: 'q' } });
    render(React.createElement(GameScreen));
    const progress = () => screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current');
    const input = screen.getByRole('textbox', { name: '行动输入' }); input.focus();
    fireEvent.keyDown(input, { key: 'q' }); expect(progress()).toBeNull();
    input.blur();
    fireEvent.keyDown(window, { key: 'q', isComposing: true });
    fireEvent.keyDown(window, { key: 'q', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'q', repeat: true });
    expect(progress()).toBeNull();
    fireEvent.keyDown(window, { key: 'q' });
    fireEvent.keyDown(window, { key: 'q' });
    expect(progress()).toBe('step');
  });
  it('keeps unread paragraphs hidden when clicking the focused paragraph again', async () => {
    render(React.createElement(GameScreen));
    const record = screen.getByRole('region', { name: '行动记录' });
    fireEvent.click(record.querySelector('[data-reading-text]')!);
    await waitFor(() => expect(useGameStore.getState().savedIsShowingSegments).toBe(true));
    expect(screen.getByRole('button', { name: '播放第 1 段' }).getAttribute('aria-current')).toBeNull();
    expect(record.textContent).not.toContain('未读秘密。');
    expect(useGameStore.getState().allNodes.read.playerVisibleText).not.toContain('未读秘密。');
  });
  it('advances from the phone record blank area', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('region', { name: '行动记录' }).querySelector('.eidos-story-paper')!);
    expect(screen.getByRole('slider', { name: '当前叙事段落' }).getAttribute('aria-valuetext')).toBe('第 2 段，共 2 段');
  });
  it('uses a tap after editing only to dismiss input, without switching prose or advancing', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(React.createElement(GameScreen));
    const input = screen.getByRole('textbox', { name: '行动输入' });
    fireEvent.change(input, { target: { value: '保留这个行动草稿' } }); input.focus();
    const text = screen.getByRole('region', { name: '行动记录' }).querySelector('[data-reading-text]')!;
    fireEvent.pointerDown(text); input.blur(); fireEvent.click(text);
    expect(screen.getByRole('slider', { name: '当前叙事段落' }).getAttribute('aria-valuetext')).toBe('第 1 段，共 2 段');
    expect(useGameStore.getState().savedSegmentIndex).toBe(0);
    expect((input as HTMLTextAreaElement).value).toBe('保留这个行动草稿');
    expect(screen.queryByRole('button', { name: '当前世界 AI 用量' })).toBeNull();
    expect(screen.getByLabelText('节点深度').textContent).toBe('1');
  });
  it('returns to the collection with a right swipe through the existing save flow', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const originalSave = useGameStore.getState().autoSave;
    const save = vi.fn().mockResolvedValue(undefined);
    useGameStore.setState({ autoSave: save });
    const view = render(React.createElement(GameScreen));
    try {
      const reader = screen.getByRole('region', { name: '行动记录' });
      const frame = view.container.querySelector<HTMLElement>('.eidos-game-frame')!;
      Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 390 });
      const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 220 });
      fireEvent.touchStart(reader, { touches: [finger(80)] });
      fireEvent.touchMove(reader, { touches: [finger(210)] });
      expect(frame.style.getPropertyValue('--swipe-x')).toBe('130px');
      const preview = view.container.querySelector('[data-collection-preview]')!;
      expect(preview.querySelector('h1')?.textContent).toBe('世界集合');
      expect(preview.hasAttribute('inert')).toBe(true);
      expect(preview.getAttribute('aria-hidden')).toBe('true');
      expect(screen.queryByRole('heading', { name: '游戏档案' })).toBeNull();
      expect(save).not.toHaveBeenCalled();
      fireEvent.touchEnd(reader, { touches: [], changedTouches: [finger(210)] });
      await waitFor(() => expect(useGameStore.getState().phase).toBe('world_select'));
      expect(save).toHaveBeenCalledOnce();
    } finally { view.unmount(); useGameStore.setState({ autoSave: originalSave }); }
  });
  it('opens the phone archive by a gutter swipe without advancing narrative or submitting an action', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const view = render(React.createElement(GameScreen));
    const frame = view.container.querySelector<HTMLElement>('.eidos-game-frame')!;
    const measure = vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 844));
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 390 });
    try {
      const reader = screen.getByRole('region', { name: '行动记录' });
      const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 220 });
      fireEvent.touchStart(reader, { touches: [finger(350)] });
      fireEvent.touchMove(reader, { touches: [finger(220)] });
      expect(screen.getByRole('heading', { name: '游戏档案' })).toBeTruthy();
      expect(frame.style.getPropertyValue('--archive-offset')).toBe('260px');
      fireEvent.touchEnd(reader, { touches: [], changedTouches: [finger(220)] });
      expect(screen.getByRole('heading', { name: '游戏档案' })).toBeTruthy();
      expect(useGameStore.getState().currentNode?.id).toBe('read');
      expect(useGameStore.getState().savedSegmentIndex).toBe(0);
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/game/action'))).toBe(false);
    } finally { measure.mockRestore(); }
  });
  it('keeps phone prose readable despite a collapsed desktop record and advances on the first tap', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    localStorage.setItem('eidos_record_collapsed', 'true');
    render(React.createElement(GameScreen));
    const record = screen.getByRole('region', { name: '行动记录' });
    expect(record.parentElement?.hasAttribute('inert')).toBe(false);
    expect(record.closest('.eidos-record-shell')?.getAttribute('aria-hidden')).toBe('false');
    const controls = within(screen.getByRole('navigation', { name: '手机阅读操作' }));
    fireEvent.click(record.querySelector('[data-reading-text]')!);
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerVisibleText).toBe('你好。\n\n未读秘密。'));
    expect(controls.getByRole('slider', { name: '当前叙事段落' }).getAttribute('aria-valuetext')).toBe('第 2 段，共 2 段');
    const finger = (x: number) => ({ identifier: 1, clientX: x, clientY: 220 });
    fireEvent.touchStart(record, { touches: [finger(300)] }); fireEvent.touchMove(record, { touches: [finger(160)] });
    fireEvent.touchEnd(record, { touches: [], changedTouches: [finger(160)] });
    expect(screen.getByRole('heading', { name: '游戏档案' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭游戏档案' }));
    expect(screen.queryByRole('heading', { name: '游戏档案' })).toBeNull();
    expect(localStorage.getItem('eidos_record_collapsed')).toBe('true');
  });
  it('keeps an engine rewind failure visible beside the attempted story', () => {
    const node = { ...useGameStore.getState().currentNode!, rewindFailure: { target: '缺失锚点', reason: '没有可用锚点' } };
    useGameStore.setState({ currentNode: node, allNodes: { read: node } });
    render(React.createElement(GameScreen));
    expect(screen.getByText('回溯未执行：没有可用锚点 当前仍停留在第1步。')).toBeTruthy();
    expect(useGameStore.getState().currentNode?.id).toBe('read');
  });
  it('blocks submitting behind visited segments in ability worlds, including after a remount', async () => {
    const state = useGameStore.getState();
    useGameStore.setState({ currentWorld: { ...state.currentWorld!, gameModeConfig: { rewind: { anchorLabels: ['开场'] } } },
      allNodes: { read: { ...state.currentNode!, playerVisibleText: state.currentNode!.aiResponse } },
      currentNode: { ...state.currentNode!, playerVisibleText: state.currentNode!.aiResponse } });
    render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '在之前的段落改变决定' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'Enter' });
    await screen.findByText('这段之后还有已经访问的内容，请回到已读最远处再行动。');
    expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('在之前的段落改变决定');
    expect(useGameStore.getState().currentNode?.id).toBe('read');
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/game/action'))).toBe(false);
  });
  it('keeps automatic paging available with a non-interactive HUD', async () => {
    vi.useFakeTimers();
    try {
      saveSettings({ ...loadSettings(), autoAdvance: true, autoSelect: false, autoAdvanceDelay: 1000 });
      useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, ...hudWorld() }, gameplayResources: {}, availableActions: ['先休息'] });
      render(React.createElement(GameScreen));
      expect(screen.getByRole('region', { name: '玩法 HUD' })).toBeDefined();
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step');
    } finally { cleanup(); vi.useRealTimers(); }
  });
  it('shows live HUD without a new main-screen control, keeping loaded mod names in the drawer', () => {
    useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, ...hudWorld() }, gameplayResources: { 'gameplay.supplies.stamina': 3 } });
    const view = render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '我要探索道路' } });
    const hud = screen.getByRole('region', { name: '玩法 HUD' });
    expect(within(hud).getByLabelText('体力数值').textContent).toContain('3');
    expect(within(hud).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: '打开玩法与模组' })).toBeNull();
    expect(view.container.querySelector('.eidos-console-drawer')).toBeNull();
    expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('我要探索道路');
    fireEvent.click(screen.getByRole('button', { name: /打开世界状态/ }));
    expect(screen.queryByRole('region', { name: '玩法 HUD' })).toBeNull();
    expect(screen.getByLabelText('已加载模组').textContent).toContain('旅途补给');
    expect(view.container.querySelector('.eidos-plugin-reference details')).toBeNull();
  });
  it('opens character dossiers through saved navigation and retains the action draft', async () => {
    render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '想再问林一个问题' } });
    fireEvent.click(screen.getByRole('button', { name: /打开世界状态/ }));
    fireEvent.click(screen.getByRole('button', { name: '人物档案' }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('npc_dossiers'));
    expect(useGameStore.getState().pendingInput).toBe('想再问林一个问题');
    useGameStore.getState().goBack();
    expect(useGameStore.getState().phase).toBe('playing');
  });
  it('opens the map through saved navigation and returns without replacing the action draft', async () => {
    render(React.createElement(GameScreen));
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '先问问船夫' } });
    fireEvent.click(screen.getByRole('button', { name: /打开世界状态/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开地图/ }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('map'));
    expect(useGameStore.getState().pendingInput).toBe('先问问船夫');
  });
  it('consumes map travel once through the action pipeline without pre-emptively changing the scene', async () => {
    const original = useGameStore.getState().tryMatchChildNode;
    const state = useGameStore.getState();
    const current = getSceneById(state.currentWorld, 'central_plaza')!;
    const target = getSceneById(state.currentWorld, 'north_market')!;
    const match = vi.fn().mockResolvedValue(state.currentNode);
    useGameStore.setState({ phase: 'map', currentScene: current, currentSceneId: 'central_plaza', visitedScenes: ['central_plaza'], tryMatchChildNode: match });
    try {
      expect(useGameStore.getState().requestMapTravel('north_market')).toBe(true);
      render(React.createElement(GameScreen));
      await waitFor(() => expect(match).toHaveBeenCalledWith(`我尝试前往${target.name}。`, undefined, expect.objectContaining({ isCurrent: expect.any(Function) })));
      expect(match).toHaveBeenCalledTimes(1);
      expect(useGameStore.getState().currentSceneId).toBe('central_plaza');
      expect(useGameStore.getState().mapTravelRequest).toBeNull();
    } finally { useGameStore.setState({ tryMatchChildNode: original }); }
  });
  it('groups status actions once and opens voice settings from the resource card', async () => {
    render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: /打开世界状态/ }));
    const actions = screen.getByLabelText('世界状态快捷操作');
    expect(within(actions).getAllByRole('button')).toHaveLength(3);
    expect(within(actions).queryByRole('button', { name: '文档' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /打开背包/ })).toHaveLength(1);
    expect(within(actions).queryByRole('button', { name: '原文回看' })).toBeNull();
    expect(within(actions).getByRole('button', { name: '系统设置' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /资源与服务 →/ }));
    const readingPosition = useGameStore.getState().savedSegmentIndex;
    fireEvent.click(screen.getByRole('button', { name: 'MOMOI 音频管理' }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('audio'));
    expect(useGameStore.getState().navigationStack.at(-1)).toBe('playing');
    act(() => useGameStore.getState().goBack());
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState().savedSegmentIndex).toBe(readingPosition);
  });
  it.each(['record', 'complete', 'dialogue'] as const)('excerpts a full quoted dialogue from the %s presentation', async (presentation) => {
    const node = { ...useGameStore.getState().allNodes.read, aiResponse: '「船夫：你好。」\n\n未读秘密。' };
    useGameStore.setState({ allNodes: { read: node }, currentNode: node,
      savedSegments: [{ type: 'dialogue', speaker: '船夫', text: '你好。' }, { type: 'narration', text: '未读秘密。' }],
      savedIsShowingSegments: presentation !== 'complete' });
    if (presentation === 'dialogue') localStorage.setItem('eidos_record_collapsed', 'true');
    const view = render(React.createElement(GameScreen));
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerVisibleText).toContain('「船夫：你好。」'));
    const paragraph = presentation === 'dialogue'
      ? screen.getByRole('region', { name: '当前对话读条' }).querySelector('p')!
      : view.container.querySelector('.eidos-story-paper p')!;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.click(screen.getByRole('button', { name: '摘录选中文字' }));
    fireEvent.click(screen.getByRole('button', { name: '保存摘录' }));
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerExcerpts?.[0]?.text).toBe('你好。'));
  });
  it('dismisses the layout menu outside without activating the story or other controls', () => {
    render(React.createElement(GameScreen));
    const toggle = screen.getByRole('button', { name: '页面整理' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('menu', { name: '页面整理选项' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
    expect(screen.queryByRole('menu', { name: '页面整理选项' })).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '播放与快捷设置' }));
    expect(screen.queryByRole('menu', { name: '页面整理选项' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: '播放与快捷设置' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放与快捷设置' }));
    expect(screen.getByRole('dialog', { name: '播放与快捷设置' })).toBeTruthy();
  });
  it('remembers the scene record preference when returning to the game', () => {
    const view = render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: '页面整理' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '收起场景记录' }));
    view.unmount();
    render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: '页面整理' }));
    expect(screen.getByRole('menuitem', { name: '展开场景记录' })).toBeTruthy();
  });
  it('excerpts selected story text without leaving or advancing the current paragraph', async () => {
    const view = render(React.createElement(GameScreen));
    const paragraph = screen.getAllByText('你好。').find(element => element.tagName === 'P')!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    fireEvent.click(screen.getByRole('button', { name: '摘录选中文字' }));
    fireEvent.change(screen.getByLabelText('我的备注'), { target: { value: '初次相遇' } });
    fireEvent.click(screen.getByRole('button', { name: '保存摘录' }));
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerExcerpts?.[0]?.note).toBe('初次相遇'));
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState().allNodes.read.playerVisibleText).toBe('你好。');
    expect(screen.queryByText('未读秘密。')).toBeNull();
    view.unmount(); selection.removeAllRanges();
  });
  it('keeps the archive drawer inside the presented text boundary, including its fallback', () => {
    const view = render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: /打开世界线/ }));
    expect(screen.queryByText('秘密总结')).toBeNull();
    expect(screen.queryByText('未读秘密。')).toBeNull();
    view.unmount();
    const node = { ...useGameStore.getState().allNodes.read, summary: '', label: '隐藏结局标题' };
    useGameStore.setState({ currentNode: node, allNodes: { read: node }, sceneNarrative: node.aiResponse });
    render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: /打开世界线/ }));
    expect(screen.queryByText('隐藏结局标题')).toBeNull();
    expect(screen.queryByText(/未读秘密/)).toBeNull();
  });
  it('does not label image resources with unrelated clue or branch counts', async () => {
    render(React.createElement(GameScreen));
    fireEvent.click(screen.getByRole('button', { name: /打开资源与服务/ }));
    expect(screen.getByRole('button', { name: /资源与服务 →/ }).textContent).toBe('资源与服务 →');
    await screen.findByText('数量读取失败 · 打开资源库');
  });
  it('archives a fully displayed pure-text paragraph without waiting for the hidden typewriter', () => {
    localStorage.setItem('eidos_story_display_mode', 'classic');
    render(React.createElement(GameScreen));
    expect(screen.getAllByText('你好。').length).toBeGreaterThan(0);
    expect(useGameStore.getState().allNodes.read.playerVisibleText).toBe('你好。');
  });
  it('keeps the original archive rail and reading boundary while removing retired entries', async () => {
    render(React.createElement(GameScreen));
    expect(screen.getByRole('navigation', { name: '档案快捷栏' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '游戏工具' })).toBeNull();
    expect(screen.queryByRole('button', { name: /打开因果投影/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /打开角色关系/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /打开情报档案/ })).toBeNull();
    expect(screen.queryByText('未读秘密。')).toBeNull();
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerVisibleText).toBe('你好。'));
    fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
    await waitFor(() => expect(useGameStore.getState().allNodes.read.playerVisibleText).toBe('你好。\n\n未读秘密。'));
    fireEvent.click(screen.getByRole('button', { name: /打开世界线/ }));
    fireEvent.click(screen.getByRole('button', { name: '打开完整世界线 →' }));
    await waitFor(() => expect(useGameStore.getState().phase).toBe('world_line_view'));
  });
});
it('uses existing segments and input interruption for multi-stop travel without a separate travel dialog', async () => {
  const original = { addActionNode: useGameStore.getState().addActionNode, autoSave: useGameStore.getState().autoSave, tryMatchChildNode: useGameStore.getState().tryMatchChildNode };
  const world = buildRiftCityStartState().world;
  const sample = getSceneById(world, 'central_plaza')!;
  world.regions = { r: { id:'r', name:'城区', description:'', scenes: Object.fromEntries(['a','b','c','d'].map((id,i,ids)=>[id,{...sample,id,name:id.toUpperCase(),region:'r',connections:ids[i+1]?[ids[i+1]]:[]}])) } };
  const match = vi.fn(async () => useGameStore.getState().currentNode);
  useGameStore.setState({ currentWorld:world, currentSceneId:'a',currentScene:world.regions.r.scenes.a,visitedScenes:['a','b','c','d'],phase:'map',isLoading:false,mapTravelRequest:null,
    autoSave:vi.fn().mockResolvedValue(undefined),tryMatchChildNode:match,
    addActionNode:vi.fn(async record => { const node={...useGameStore.getState().currentNode!,id:record.id,aiResponse:record.aiResponse,sceneId:record.sceneId,playerVisibleText:''};useGameStore.setState(s=>({currentNode:node,allNodes:{...s.allNodes,[node.id]:node}}));return node; }) });
  vi.stubGlobal('fetch',vi.fn(async input => new Response(JSON.stringify(String(input)==='/api/game/action' ? {travelSegments:[{from:'a',to:'b',arrived:true,text:'抵达 B。',minutes:1},{from:'b',to:'c',arrived:true,text:'抵达 C。',minutes:1},{from:'c',to:'d',arrived:true,text:'抵达 D。',minutes:1}]} : {}))));
  const view=render(React.createElement(GameScreen));
  try {
    act(()=>{expect(useGameStore.getState().requestMapTravel('d')).toBe(true);});
    await waitFor(()=>expect(useGameStore.getState().currentSceneId).toBe('b'));
    await waitFor(()=>expect(useGameStore.getState().isLoading).toBe(false));
    expect(screen.getByRole('button', {name:'播放第 1 段'})).toBeTruthy();
    expect(screen.queryByRole('dialog',{name:'连续旅行'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'播放第 2 段'}));
    await waitFor(()=>expect(useGameStore.getState().currentSceneId).toBe('c'));
    const input=screen.getByRole('textbox',{name:'行动输入'});
    fireEvent.change(input,{target:{value:'停下，看看四周'}});
    fireEvent.keyDown(input,{key:'Enter'});
    await waitFor(()=>expect(match).toHaveBeenCalledWith('停下，看看四周',undefined,expect.objectContaining({isCurrent:expect.any(Function)})));
    expect(useGameStore.getState().currentSceneId).toBe('c');
    expect(useGameStore.getState().history).toHaveLength(2);
    expect(JSON.stringify(useGameStore.getState().savedSegments)).not.toContain('抵达 D');
  } finally { view.unmount();useGameStore.setState(original); }
});

it('syncs disabled auto paging after mount and stays manual after selecting the next segment', async () => {
  vi.useFakeTimers();
  try {
    saveSettings({...loadSettings(),autoAdvance:true,autoSelect:false,autoAdvanceDelay:1000});
    render(React.createElement(GameScreen));
    act(()=>saveSettings({...loadSettings(),autoAdvance:false}));
    fireEvent.click(screen.getByRole('button',{name:'播放第 2 段'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
    expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button',{name:'播放与快捷设置'}));
    expect(screen.getByRole('button',{name:'自动翻页 · 关闭'}).getAttribute('aria-pressed')).toBe('false');
  } finally { cleanup();vi.useRealTimers(); }
});
it('shows complete historical text until clicking a paragraph to replay its segment', () => {
  useGameStore.setState({savedIsShowingSegments:false});
  const view=render(React.createElement(GameScreen));
  expect(screen.getByText('未读秘密。')).toBeTruthy();
  expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
  fireEvent.click(screen.getByText('未读秘密。'));
  expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBe('step');
  expect(screen.getAllByText('你好。').length).toBeGreaterThan(0);
});

it('shows only the active world usage and toggles compact precision',()=>{
 const world=useGameStore.getState().currentWorld!;
 useGameStore.setState({tokensUsed:900000000,estimatedCost:99,worldTokenUsage:{[world.id]:{tokensUsed:314542,estimatedCost:.51,tokenDetail:useGameStore.getState().tokenDetail}}});
 render(React.createElement(GameScreen));
 const button=screen.getByRole('button',{name:'当前世界 AI 用量'});
 expect(button.textContent).toBe('Total 314.5K token - 0.5¥');
 fireEvent.click(button);expect(button.textContent).toBe('Total 314542 token - 0.51¥');
 fireEvent.click(button);expect(button.textContent).toBe('Total 314.5K token - 0.5¥');
});

it('keeps revealed later paragraphs when refocusing earlier text, and toggles current text out of playback',()=>{
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'播放第 2 段'}));
 const panel=screen.getByRole('region',{name:'行动记录'});
 fireEvent.click(within(panel).getByRole('button',{name:'你好。'}));
 expect(within(panel).getByText('未读秘密。')).toBeTruthy();
 expect(screen.getByRole('button',{name:'播放第 1 段'}).getAttribute('aria-current')).toBe('step');
 fireEvent.click(within(panel).getByRole('button',{name:'你好。'}));
 expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
 expect(within(panel).getByText('未读秘密。')).toBeTruthy();
});
it('dismisses token details outside, keeps inside clicks open, and does not advance on dismissal',()=>{
 render(React.createElement(GameScreen));
 const toggle=screen.getByRole('button',{name:'当前世界 AI 用量'});fireEvent.click(toggle);
 fireEvent.click(screen.getByRole('region',{name:'当前世界用量明细'}));
 expect(toggle.getAttribute('aria-expanded')).toBe('true');
 fireEvent.click(document.querySelector('[data-story-stage]')!);
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 expect(screen.getByRole('button',{name:'播放第 1 段'}).getAttribute('aria-current')).toBe('step');
});
it('pauses an unfinished live paragraph while reading its parent, then resumes the same typing cursor',async()=>{
 vi.useFakeTimers();
 try {
  const child={...useGameStore.getState().currentNode!,parentId:'parent'};
  const parent={...child,id:'parent',parentId:null,childIds:[child.id],aiResponse:'父节点正文',playerVisibleText:'父节点正文',segmentHash:''};
  const longText='正在讲述尚未说完的故事。'.repeat(30);
  const childSegments=[{type:'narration' as const,text:longText},{type:'narration' as const,text:'后面未播的段落'}];
  useGameStore.setState({currentNode:child,allNodes:{[child.id]:child,parent},savedSegments:childSegments,savedSegmentIndex:0,savedIsShowingSegments:true});
  render(React.createElement(GameScreen));
  act(()=>vi.advanceTimersByTime(100));
  const before=screen.getByLabelText('当前段落字形场').textContent;
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));});
  expect(useGameStore.getState().readingView?.nodeId).toBe('parent');expect(useGameStore.getState().currentNode?.id).toBe(child.id);
  act(()=>vi.advanceTimersByTime(200));
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'下一行动记录'}));});
  expect(useGameStore.getState().readingView).toBeNull();
  expect(screen.getByLabelText('当前段落字形场').textContent).toBe(before);
  act(()=>vi.advanceTimersByTime(50));
  expect(screen.queryByText('后面未播的段落')).toBeNull();
  expect(screen.getByLabelText('当前段落字形场').textContent).not.toContain('正在讲述尚未说完的故事。');
 } finally {cleanup();vi.useRealTimers();}
});

it('closes quick tools outside without activating the underlying story', () => {
 render(React.createElement(GameScreen));
 const toggle=screen.getByRole('button',{name:'播放与快捷设置'});
 fireEvent.click(toggle);
 fireEvent.click(screen.getByRole('dialog',{name:'播放与快捷设置'}));
 expect(toggle.getAttribute('aria-expanded')).toBe('true');
 fireEvent.click(document.querySelector('[data-story-stage]')!);
 expect(screen.queryByRole('dialog',{name:'播放与快捷设置'})).toBeNull();
 expect(screen.getByRole('button',{name:'播放第 1 段'}).getAttribute('aria-current')).toBe('step');
});

it.each([true,false])('shows impossible attempts temporarily and restores the origin, streaming=%s', async streaming => {
 localStorage.setItem('eidos_stream_mode',JSON.stringify(streaming));
 const original=useGameStore.getState();
 const child={...original.currentNode!,id:'child',parentId:'read',playerInput:'已走行动'};
 const node={...original.currentNode!,childIds:['child']};
 useGameStore.setState({currentNode:node,allNodes:{read:node,child},availableActions:['继续探索']});
 const rejection={validity:{isPossible:false,fantasyResponse:'你暂时无法飞到月亮。',reason:'缺少飞行能力'},segments:[{type:'narration',text:'你暂时无法飞到月亮。'}],availableActions:['错误的后续行动'],timeSpent:{day:1,hour:8,minute:0},sceneChanges:['north_market'],_tokenUsage:{promptTokens:5,completionTokens:5,totalTokens:10}};
 vi.stubGlobal('fetch',vi.fn(async url=>String(url).includes('/api/game/action/stream')
   ? new Response(`data: ${JSON.stringify({type:'segments',segments:rejection.segments})}\n\ndata: ${JSON.stringify({type:'done',...rejection})}\n\n`)
   : new Response(JSON.stringify(rejection))));
 render(React.createElement(GameScreen));
 fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'飞到月亮'}});
 fireEvent.click(screen.getByRole('button',{name:'发送行动'}));
 await screen.findByRole('heading',{name:'行动未执行'});
 expect(screen.getByRole('button',{name:'下一行动记录'}).hasAttribute('disabled')).toBe(true);
 expect(screen.queryByText('错误的后续行动')).toBeNull();
 expect(useGameStore.getState().currentNode?.id).toBe('read');
 expect(useGameStore.getState().gameTime).toEqual(original.gameTime);
 expect(useGameStore.getState().sceneNarrative).toBe(original.sceneNarrative);
 expect(useGameStore.getState().history).toEqual(original.history);
 expect(useGameStore.getState().savedSegments).toEqual(original.savedSegments);
 expect(Object.keys(useGameStore.getState().allNodes)).toEqual(['read','child']);
 expect(useGameStore.getState().allNodes.read.playerVisibleText).not.toContain('月亮');
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(screen.queryByRole('heading',{name:'行动未执行'})).toBeNull());
 expect(screen.getByRole('button',{name:'播放第 1 段'}).getAttribute('aria-current')).toBe('step');
 expect(screen.getByRole('textbox',{name:'行动输入'}).getAttribute('value') ?? (screen.getByRole('textbox',{name:'行动输入'}) as HTMLTextAreaElement).value).toBe('飞到月亮');
});

it('warms missing actions again when entering an existing child node', async () => {
 const spy=vi.spyOn(speculativeEngine,'triggerSpeculation').mockResolvedValue();
 try {
  saveSettings({...loadSettings(),aliceApiKey:'test-only',autoSelect:false,autoAdvance:false});
  const original=useGameStore.getState();
  const child={...original.currentNode!,id:'cached-child',parentId:'read',childIds:[],playerInput:'询问船夫',availableActions:['沿河走']};
  const parent={...original.currentNode!,childIds:[child.id]};
  useGameStore.setState({currentNode:parent,allNodes:{read:parent,[child.id]:child},availableActions:['询问船夫','看看码头']});
  render(React.createElement(GameScreen));
  await waitFor(()=>expect(spy).toHaveBeenCalledWith(['看看码头'],expect.objectContaining({scope:expect.stringContaining(':read')}),3));
  act(()=>useGameStore.setState({currentNode:child,availableActions:['沿河走'],savedSegments:[{type:'narration',text:'船夫指向河岸。'}],savedIsShowingSegments:false}));
  await waitFor(()=>expect(spy).toHaveBeenCalledWith(['沿河走'],expect.objectContaining({scope:expect.stringContaining(':cached-child')}),3));
 } finally {spy.mockRestore();}
});

it('opens read-only history in an ability world without restoring an older record or losing the action draft', async () => {
  const live = useGameStore.getState(), current = { ...live.currentNode!, parentId: 'past' };
  const past = { ...current, id: 'past', parentId: null, childIds: ['read'], aiResponse: '过去已读过的对白', playerVisibleText: '过去已读过的对白' };
  useGameStore.setState({ currentWorld: { ...live.currentWorld!, gameModeConfig: { rewind: { anchorLabels: ['黎明'] } } }, currentNode: current,
    allNodes: { past, read: current }, savedIsShowingSegments: false, worldFlags: { future: true } });
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '接下来询问船夫' } });
  fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().phase).toBe('reading'));
  expect(useGameStore.getState().currentNode?.id).toBe('read');
  expect(useGameStore.getState().worldFlags.future).toBe(true);
  expect(useGameStore.getState().pendingInput).toBe('接下来询问船夫');
});

it('keeps a restricted node dossier readable without manual restore or deletion controls', async () => {
  const { InspectorPanel } = await import('@/components/game/worldline/InspectorPanel');
  const node = { ...useGameStore.getState().currentNode!, snapshotHash: 'past-snapshot', playerVisibleText: '回溯前已读过的对白' };
  const backtrack = vi.fn(), remove = vi.fn();
  render(React.createElement(InspectorPanel, { node, restrictedRewind: true, onBacktrack: backtrack, onDelete: remove, onClose() {} }));
  expect(screen.getByText('回溯前已读过的对白')).toBeDefined();
  expect(screen.queryByText('回档到此处')).toBeNull();
  expect(screen.queryByText('删除节点及后代')).toBeNull();
   expect(screen.getByRole('status').textContent).toContain('游戏依据剧情和角色能力判断目标');
  expect(backtrack).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it.each([true, false])('looks up history before committing exactly one action, streaming=%s', async streaming => {
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  const original = useGameStore.getState();
  const { snapshot } = buildRiftCityStartState();
  original.restoreSnapshot(snapshot);
  const old = { ...original.currentNode!, aiResponse: '钟声响起后，银钥匙落在壁炉旁。', playerVisibleText: '钟声响起后，银钥匙落在壁炉旁。', rewindFailure: { target: 'bad', reason: '目标不存在' } };
  const addActionNode = vi.fn(async record => {
    const node = { ...old, id: record.id, parentId: old.id, aiResponse: record.aiResponse, playerVisibleText: '' };
    useGameStore.setState(s => ({ currentNode: node, allNodes: { ...s.allNodes, [node.id]: node } }));
    return node;
  });
  useGameStore.setState({ currentNode: old, allNodes: { [old.id]: old }, currentWorld: original.currentWorld, history: [], worldFlags: {},
    worldLine: { id: 'test-line', worldId: original.currentWorld!.id, playthroughId: 'test-play', rootNodeId: old.id, currentNodeId: old.id, allNodeIds: [old.id], totalSteps: 1, branchCount: 0, createdAt: 0, updatedAt: 0 },
    currentPlaythroughId: 'test-play', savedSegments: [{ type: 'narration', text: old.aiResponse }], savedSegmentIndex: 0, savedIsShowingSegments: false,
    tryMatchChildNode: vi.fn().mockResolvedValue(null), autoSave: vi.fn().mockResolvedValue(undefined), addActionNode });
  const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: 'alice' };
  const requests: Record<string, unknown>[] = [];
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (!String(url).startsWith('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (requests.length === 1) {
      const data = { historyRequest: { query: '银钥匙' }, itemsGained: [{ name: '不应获得的物品' }], timeSpent: { day: 1, hour: 0, minute: 0 }, _tokenUsage: usage };
      return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`) : Response.json(data);
    }
    if (requests.length === 2) return Response.json({ historyRequest: { nodeId: old.id, offset: 0 }, _tokenUsage: usage });
    return new Promise<Response>(resolve => { finish = resolve; });
  }));
  const view = render(React.createElement(GameScreen));
  try {
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '找到银钥匙落下时的原文' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'Enter' });
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[0]._worldLineSummary).toMatchObject({ rewindFailure: old.rewindFailure });
    expect(String(actionEvidence(requests[2]))).toContain(old.aiResponse);
    expect(useGameStore.getState().currentNode?.id).toBe(old.id);
    expect(useGameStore.getState().gameTime).toEqual(snapshot.currentGameTime);
    expect(useGameStore.getState().history).toHaveLength(0);
    expect(addActionNode).not.toHaveBeenCalled();
    expect(useGameStore.getState().inventory.some(i => i.name === '不应获得的物品')).toBe(false);
    await act(async () => finish(Response.json({ segments: [{ type: 'narration', text: '你重新确认了钥匙落下的时刻。' }], timeSpent: { day: 0, hour: 0, minute: 1 }, availableActions: [], _tokenUsage: usage })));
    await waitFor(() => expect(addActionNode).toHaveBeenCalledTimes(1));
    expect(useGameStore.getState().history).toHaveLength(1);
    expect(useGameStore.getState().history[0].aiResponse).toBe('你重新确认了钥匙落下的时刻。');
    expect(useGameStore.getState().isLoading).toBe(false);
  } finally {
    view.unmount();
    useGameStore.setState({ addActionNode: original.addActionNode, tryMatchChildNode: original.tryMatchChildNode, autoSave: original.autoSave });
  }
});


it('stores the current phone reading position and draft when manually saving from the archive', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const original = useGameStore.getState().saveGame;
  const save = vi.fn(async () => 'saved');
  useGameStore.setState({ saveGame: save });
  const view = render(React.createElement(GameScreen));
  try {
    fireEvent.click(screen.getByRole('region', { name: '行动记录' }).querySelector('.eidos-story-paper')!);
    fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '前往钟楼' } });
    fireEvent.click(screen.getByRole('button', { name: /打开世界状态/ }));
    fireEvent.click(screen.getByRole('button', { name: '手动保存' }));
    fireEvent.click(screen.getByRole('button', { name: '新建存档' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(useGameStore.getState().savedSegmentIndex).toBe(1);
    expect(useGameStore.getState().pendingInput).toBe('前往钟楼');
  } finally { view.unmount(); useGameStore.setState({ saveGame: original }); }
});

it.each([false, true])('lands a read-only parent at the head and the live child at the foot, phone=%s', async phone => {
 saveSettings({...loadSettings(),autoAdvance:false,autoSelect:false,enableSpeculation:false});
 vi.stubGlobal('matchMedia', vi.fn((query:string) => ({matches:phone && query.includes('max-width'),addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 const height=vi.spyOn(Element.prototype,'scrollHeight','get').mockReturnValue(1200);
 const oldScroll=HTMLElement.prototype.scrollTo;
 HTMLElement.prototype.scrollTo=function(options?:ScrollToOptions | number) { if(typeof options !== 'number') this.scrollTop=options?.top ?? 0; };
 const state=useGameStore.getState(), restore=state.backtrackToNode;
 const child={...state.currentNode!,parentId:'parent',childIds:[],availableActions:['继续探索']};
 const parent={...child,id:'parent',parentId:null,childIds:[child.id],aiResponse:'父节点的完整正文',playerVisibleText:'父节点的完整正文',segmentHash:'',availableActions:['观察河岸']};
 const childSegments=[{type:'narration' as const,text:'子节点已经读到这里。'},{type:'narration' as const,text:'子节点尚未播放的内容'}];
 useGameStore.setState({currentNode:child,allNodes:{[child.id]:child,parent},availableActions:child.availableActions,savedSegments:childSegments,savedSegmentIndex:0,savedIsShowingSegments:true,
  backtrackToNode:async id=>{useGameStore.setState({currentNode:id==='parent'?parent:child,savedSegments:id==='parent'?[{type:'narration',text:parent.aiResponse}]:[...childSegments],savedSegmentIndex:0,savedIsShowingSegments:false,availableActions:id==='parent'?parent.availableActions:child.availableActions});}});
 const view=render(React.createElement(GameScreen));
 const viewport=()=>view.container.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing) .eidos-record-scroll')!;
 const pull=(from:number,to:number)=>{
  const target=viewport().querySelector('[data-reading-text]')!;
  const finger=(y:number)=>({identifier:1,clientX:180,clientY:y});
  fireEvent.touchStart(target,{touches:[finger(from)]});fireEvent.touchMove(target,{touches:[finger(to)]});fireEvent.touchEnd(target,{touches:[],changedTouches:[finger(to)]});
 };
 try {
  if(phone) {viewport().scrollTop=0;pull(180,300);} else fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
  await waitFor(()=>{expect(useGameStore.getState().readingView?.nodeId).toBe('parent');expect(useGameStore.getState().currentNode?.id).toBe(child.id);expect(viewport().scrollTop).toBe(0);});
  if(phone) {viewport().scrollTop=1200;pull(300,180);} else fireEvent.click(screen.getByRole('button',{name:'下一行动记录'}));
  await waitFor(()=>{expect(useGameStore.getState().readingView).toBeNull();expect(useGameStore.getState().currentNode?.id).toBe(child.id);expect(viewport().scrollTop).toBe(1200);});
  expect(screen.queryByText('子节点尚未播放的内容')).toBeNull();
  expect(useGameStore.getState().savedSegmentIndex).toBe(0);
 } finally {view.unmount();height.mockRestore();HTMLElement.prototype.scrollTo=oldScroll;useGameStore.setState({backtrackToNode:restore});}
});

it('submits the global plugin transformed input through the regular action pipeline', async () => {
 const { globalPluginRuntime } = await import('@/lib/game/global-plugins/runtime');
 const { installGlobalPlugins, setGlobalPluginEnabled, removeGlobalPlugin } = await import('@/lib/game/global-plugins/library');
 const { PAPER_LAB_PLUGIN } = await import('@/lib/game/global-plugins/examples');
 saveSettings({...loadSettings(),autoAdvance:false,autoSelect:false,enableSpeculation:false,enableContentReview:false});
 localStorage.setItem('eidos_stream_mode','false');
 useGameStore.setState({availableActions:['继续观察'],savedIsShowingSegments:false});
 const stop = globalPluginRuntime.start();
 try {
  installGlobalPlugins([PAPER_LAB_PLUGIN]);setGlobalPluginEnabled(PAPER_LAB_PLUGIN.id,true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({validity:{isPossible:false,reason:'不提交游戏变化',fantasyResponse:'测试反馈'},segments:[],availableActions:[]})));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'/环顾'}});
  fireEvent.click(screen.getByRole('button',{name:'发送行动'}));
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url,options])=>String(url).includes('/api/game/action') && JSON.parse(String(options?.body)).playerInput==='仔细观察当前环境，留意可见的人物、物品与出入口。')).toBe(true));
 } finally {cleanup();removeGlobalPlugin(PAPER_LAB_PLUGIN.id);stop();}
});

it.each(['cancel','error'])('does not send or consume an action when a global hook returns %s', async mode=>{
 const {globalPluginRuntime}=await import('@/lib/game/global-plugins/runtime');
 const {installGlobalPlugins,setGlobalPluginEnabled,removeGlobalPlugin}=await import('@/lib/game/global-plugins/library');
 const {parseGlobalPlugin}=await import('@/lib/game/global-plugins/manifest');
 saveSettings({...loadSettings(),autoAdvance:false,autoSelect:false,enableSpeculation:false,enableContentReview:false});
 localStorage.setItem('eidos_stream_mode','false');useGameStore.setState({availableActions:['继续'],savedIsShowingSegments:false});
 const before=useGameStore.getState().createSnapshot(),stop=globalPluginRuntime.start();
 const plugin=parseGlobalPlugin({format:'eidos-global-plugin',version:1,id:'stop-action',name:'接管行动',release:'1',description:'测试',script:mode==='cancel'?"api.actions.beforeSubmit(()=>({cancel:true}));":"api.actions.beforeSubmit(()=>{throw new Error('测试钩子失败')});"});
 try {
  installGlobalPlugins([plugin]);setGlobalPluginEnabled(plugin.id,true);render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'测试行动'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'发送行动'}));});
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/api/game/action'))).toBe(false);
  expect((screen.getByRole('textbox',{name:'行动输入'}) as HTMLTextAreaElement).value).toBe('测试行动');
  expect(useGameStore.getState().createSnapshot()).toEqual(before);
  if(mode==='error')expect(globalPluginRuntime.getSnapshot()[plugin.id]).toMatchObject({state:'error',error:'测试钩子失败'});
 } finally {cleanup();removeGlobalPlugin(plugin.id);stop();}
});

it('replaces only the central glyph picture with a scene map and preserves native records and input', async () => {
  const { parsePluginFile } = await import('@/lib/game/plugins/manifest');
  const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'chinese-room', name: '文字地图与角色扮演', description: '主世界地图', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<main>地图</main>', reading: 'inherit', presentation: 'scene-map' } })[0];
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: [plugin] } }));
  render(React.createElement(GameScreen));
  const frame = screen.getByTitle('文字地图与角色扮演') as HTMLIFrameElement;
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { channel: 'eidos-mod', token: frame.dataset.session, scope: frame.dataset.scope, command: 'ready' } })));
  await waitFor(() => expect(document.querySelector('[data-scene-map="true"]')).not.toBeNull());
  expect(screen.getByRole('region', { name: '行动记录' })).toBeDefined();
  expect(screen.getByRole('textbox', { name: '行动输入' })).toBeDefined();
  expect(screen.queryByLabelText('当前段落字形场')).toBeNull();
  expect(document.querySelector('[data-mod-reading="true"]')).toBeNull();
});

it('keeps configured next-paragraph keys working after focus moves outside a map onto record text',async()=>{
 const {parsePluginFile}=await import('@/lib/game/plugins/manifest');
 const plugin=parsePluginFile({format:'eidos-gameplay-plugin',version:1,id:'chinese-room',name:'文字地图与角色扮演',description:'主世界地图',tags:[],rules:[],prompts:{creation:'',action:'',review:''},ui:{html:'<main>地图</main>',reading:'inherit',presentation:'scene-map'}})[0];
 useGameStore.setState(s=>({currentWorld:{...s.currentWorld!,gameplayPlugins:[plugin]}}));
 render(React.createElement(GameScreen));
 const frame=screen.getByTitle('文字地图与角色扮演') as HTMLIFrameElement;
 act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{channel:'eidos-mod',token:frame.dataset.session,scope:frame.dataset.scope,command:'ready'}})));
 await waitFor(()=>expect(document.querySelector('[data-scene-map="true"]')).not.toBeNull());
 const text=within(screen.getByRole('region',{name:'行动记录'})).getByRole('button',{name:'你好。'});
 act(()=>text.focus());fireEvent.keyDown(text,{key:'z'});fireEvent.keyDown(text,{key:'z'});
 expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBe('step');
});

it('does not consume a next-paragraph key while quick settings is open',()=>{
 render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'播放与快捷设置'}));
 fireEvent.keyDown(window,{key:'z'});fireEvent.keyDown(window,{key:'z'});
 expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBeNull();
});

it('continues native reading from the record blank area outside the map',async()=>{
 const {parsePluginFile}=await import('@/lib/game/plugins/manifest');
 const plugin=parsePluginFile({format:'eidos-gameplay-plugin',version:1,id:'chinese-room',name:'文字地图与角色扮演',description:'主世界地图',tags:[],rules:[],prompts:{creation:'',action:'',review:''},ui:{html:'<main>地图</main>',reading:'inherit',presentation:'scene-map'}})[0];
 useGameStore.setState(s=>({currentWorld:{...s.currentWorld!,gameplayPlugins:[plugin]}}));render(React.createElement(GameScreen));
 const frame=screen.getByTitle('文字地图与角色扮演') as HTMLIFrameElement;
 act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{channel:'eidos-mod',token:frame.dataset.session,scope:frame.dataset.scope,command:'ready'}})));
 await waitFor(()=>expect(document.querySelector('[data-scene-map="true"]')).not.toBeNull());
 const blank=screen.getByRole('region',{name:'行动记录'}).querySelector('.eidos-story-paper')!;
 fireEvent.click(blank);fireEvent.click(blank);
 expect(screen.getByRole('button',{name:'播放第 2 段'}).getAttribute('aria-current')).toBe('step');
});

it('uses arrows immediately after selecting a paragraph while preserving input editing keys', async () => {
  const node = useGameStore.getState().currentNode!;
  useGameStore.setState({ savedIsShowingSegments: false, currentNode: { ...node, playerVisibleText: node.aiResponse }, allNodes: { [node.id]: { ...node, playerVisibleText: node.aiResponse } } });
  render(React.createElement(GameScreen));
  const paragraph = within(screen.getByRole('region', { name: '行动记录' })).getByRole('button', { name: '你好。' });
  fireEvent.click(paragraph);
  act(() => paragraph.focus());
  fireEvent.keyDown(paragraph, { key: 'ArrowRight' });
  fireEvent.keyDown(paragraph, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step'));
  fireEvent.keyDown(paragraph, { key: 'ArrowLeft' });
  await waitFor(() => expect(screen.getByRole('button', { name: '播放第 1 段' }).getAttribute('aria-current')).toBe('step'));
  const input = screen.getByRole('textbox', { name: '行动输入' }); input.focus();
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: '播放第 1 段' }).getAttribute('aria-current')).toBe('step');
  const record = screen.getByRole('region', { name: '行动记录' });
  act(() => record.focus());
  fireEvent.keyDown(record, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step'));
});
