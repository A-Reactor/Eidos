// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { WorldLineBrowser } from '@/components/game/WorldLineBrowser';
import { useGameStore } from '@/store/game-store';
import type { WorldLineNode } from '@/lib/game/types';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

const make = (id: string, parentId: string | null, step: number, childIds: string[], text: string): WorldLineNode => ({
  id, parentId, childIds, stepNumber: step, dayNumber: 1, createdAt: step,
  gameTime: { day: 1, hour: 8, minute: step }, timeSpent: { day: 0, hour: 0, minute: 1 },
  sceneId: 'dock', sceneName: '渡口', playerInput: `行动 ${id}`, playerVisibleText: text,
  aiResponse: `${text}\n未读秘密`, summary: '隐藏推断', worldImpacts: [], snapshotHash: 'snapshot', segmentHash: '', generationComplete: true,
});
const root = make('root', null, 0, ['main', 'left', 'right'], '共同前文');
const main = make('main', 'root', 1, [], '当前路线正文');
const left = make('left', 'root', 1, [], '左侧路线证词');
const right = make('right', 'root', 1, [], '右侧路线证词');
const actions = { backtrackToNode: useGameStore.getState().backtrackToNode, deleteSubtree: useGameStore.getState().deleteSubtree };
afterEach(() => { cleanup(); useGameStore.setState(actions); vi.restoreAllMocks(); });
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  useGameStore.setState({ currentWorld: buildRiftCityStartState().world, phase: 'reading', worldLine: null, currentNode: main,
    allNodes: structuredClone({ root, main, left, right }), pendingInput: '保留的行动草稿', navigationStack: ['playing'],
    backtrackToNode: vi.fn(), deleteSubtree: vi.fn() });
});

it('embeds the existing coordinate renderer in both legacy entry points', () => {
  const first = render(React.createElement(WorldLineBrowser));
  expect(screen.getByLabelText('连续原文')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '总览' })).toBeNull();
  expect(screen.queryByRole('button', { name: '阅读' })).toBeNull();
  const tools = within(screen.getByRole('group', { name: '世界线视图操作' }));
  expect(tools.getByRole('button', { name: '适应视图' })).toBeTruthy();
  expect(tools.getByRole('button', { name: '回到当前节点' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: '适应视图' })).toHaveLength(1);
  expect(screen.getByRole('separator', { name: '世界线与原文分隔线' })).toBeTruthy();
  expect(first.container.querySelector('g[data-node-id="root"]')).toBeTruthy();
  expect(screen.queryByText('STEP')).toBeNull();
  expect(first.container.querySelector('[data-worldline-ruler="top"]')?.getAttribute('height')).toBe(first.container.querySelector('[data-worldline-ruler="left"]')?.getAttribute('width'));
  first.unmount();
  render(React.createElement(ReadingScreen));
  expect(screen.getByRole('heading', { level: 1, name: '世界线' })).toBeTruthy();
  expect(screen.getByLabelText('分支导航')).toBeTruthy();
});

it('resizes the phone split with a keyboard without changing the game route', () => {
  render(React.createElement(ReadingScreen));
  const divider = screen.getByRole('separator', { name: '分支图与原文高度' });
  fireEvent.keyDown(divider, { key: 'End' });
  expect(divider.getAttribute('aria-valuenow')).toBe('65');
  expect(divider.parentElement?.style.getPropertyValue('--mobile-map-height')).toBe('65%');
  fireEvent.keyDown(divider, { key: 'ArrowDown' });
  expect(divider.getAttribute('aria-valuenow')).toBe('65');
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(divider.parentElement?.style.getPropertyValue('--mobile-map-height')).toBe('20%');
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
});

it('pinches the worldline graph on touch screens without accidentally opening a branch', () => {
  const view = render(React.createElement(ReadingScreen));
  const graph = view.container.querySelector<HTMLElement>('.eidos-worldline-canvas')!;
  graph.setPointerCapture = vi.fn();
  const touch = (type: string, id: number, x: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 120 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    fireEvent(graph, event);
  };
  touch('pointerdown', 1, 100); touch('pointerdown', 2, 300); touch('pointermove', 2, 200);
  expect(Number(graph.getAttribute('data-worldline-scale'))).toBe(110);
  touch('pointerup', 1, 100); touch('pointerup', 2, 200);
  fireEvent.click(view.container.querySelector('g[data-node-id="left"]')!, { detail: 1 });
  expect(screen.getByRole('main').textContent).toContain('当前路线正文');
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
});

it('remembers the adjustable split across both entry points without changing the route, search or game progress', () => {
  const view = render(React.createElement(ReadingScreen));
  fireEvent.keyDown(view.container.querySelector('g[data-node-id="left"]')!, { key: 'Enter' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '左侧' } });
  fireEvent.keyDown(screen.getByRole('separator', { name: '世界线与原文分隔线' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('separator', { name: '世界线与原文分隔线' }).getAttribute('aria-valuenow')).toBe('664');
  expect(localStorage.getItem('eidos-panel-width:worldline-reader')).toBe('664');
  expect(screen.getByRole('main').textContent).toContain('左侧路线证词');
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
  view.unmount();
  render(React.createElement(WorldLineBrowser));
  expect(screen.getByRole('separator', { name: '世界线与原文分隔线' }).getAttribute('aria-valuenow')).toBe('664');
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('左侧');
  expect(screen.getByRole('main').textContent).toContain('左侧路线证词');
});

it('uses the real outgoing track directions for both fork arrows', () => {
  const view = render(React.createElement(ReadingScreen));
  const arrows = view.container.querySelectorAll('g[data-node-id="root"] [data-branch-direction]');
  expect(arrows).toHaveLength(2);
  for (const arrow of arrows) {
    const [edgeX, , tipX] = arrow.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(arrow.getAttribute('data-branch-direction') === 'left' ? tipX < edgeX : tipX > edgeX).toBe(true);
  }
});

it('keeps child frames and guide padding below their owning fork', () => {
  const view = render(React.createElement(ReadingScreen));
  const rootDash = view.container.querySelector('g[data-node-id="root"] rect')!;
  const forkY = Number(rootDash.getAttribute('y')) + Number(rootDash.getAttribute('height')) / 2;
  const guides = [...view.container.querySelectorAll('[data-worldline-guide]')].filter(g => g.getAttribute('data-worldline-guide') !== 'g-0');
  expect(guides).toHaveLength(2);
  for (const guide of guides) expect(Number(guide.querySelector('line')!.getAttribute('y1'))).toBeGreaterThanOrEqual(forkY);
  const frames = [...view.container.querySelectorAll('[data-worldline-frame]')].filter(f => f.getAttribute('data-worldline-frame') !== '1:0');
  expect(frames).toHaveLength(2);
  for (const frame of frames) {
    const numbers = frame.querySelector('path')!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(numbers[1]).toBeGreaterThan(forkY);
  }
});

it('fits the graph from the toolbar without changing the viewed route or game progress', () => {
  const view = render(React.createElement(ReadingScreen));
  const position = () => view.container.querySelector('g[data-node-id="root"] rect')?.getAttribute('y');
  fireEvent.click(screen.getByRole('button', { name: '适应视图' }));
  const original = position();
  expect(original).not.toBeUndefined();
  fireEvent.wheel(view.container.querySelector('.eidos-worldline-canvas')!, { deltaY: 20 });
  expect(position()).not.toBe(original);
  fireEvent.click(screen.getByRole('button', { name: '适应视图' }));
  expect(position()).toBe(original);
  expect(within(screen.getByRole('main')).getByText('当前路线正文')).toBeTruthy();
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
});

it('enters at maximum detail each time and preserves user zoom during ordinary selection', () => {
  const view = render(React.createElement(ReadingScreen));
  const graph = () => view.container.querySelector('.eidos-worldline-canvas')!;
  expect(graph().getAttribute('data-worldline-scale')).toBe('220');
  fireEvent.wheel(graph(), { deltaY: 40, ctrlKey: true });
  const zoomed = graph().getAttribute('data-worldline-scale');
  expect(Number(zoomed)).toBeLessThan(220);
  fireEvent.keyDown(view.container.querySelector('g[data-node-id="root"]')!, { key: 'Enter' });
  expect(graph().getAttribute('data-worldline-scale')).toBe(zoomed);
  view.unmount();
  const next = render(React.createElement(ReadingScreen));
  expect(next.container.querySelector('.eidos-worldline-canvas')!.getAttribute('data-worldline-scale')).toBe('220');
});

it('opens another route from the graph while retaining the real game progress and draft', () => {
  const view = render(React.createElement(ReadingScreen));
  fireEvent.keyDown(view.container.querySelector('g[data-node-id="left"]')!, { key: 'Enter' });
  const reader = within(screen.getByRole('main'));
  expect(reader.getByText('左侧路线证词')).toBeTruthy();
  expect(reader.queryByText('当前路线正文')).toBeNull();
  expect(reader.getAllByText('共同前文')).toHaveLength(1);
  expect(reader.queryByText(/未读秘密|隐藏推断/)).toBeNull();
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  expect(useGameStore.getState().pendingInput).toBe('保留的行动草稿');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '回到当前节点' }));
  expect(reader.getByText('当前路线正文')).toBeTruthy();
});

it('searches already read text across routes and opens the matching source', () => {
  render(React.createElement(ReadingScreen));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '左侧路线' } });
  fireEvent.click(within(screen.getByLabelText('原文搜索结果')).getByRole('button'));
  expect(document.activeElement?.textContent).toBe('左侧路线证词');
  expect(useGameStore.getState().currentNode?.id).toBe('main');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '未读秘密' } });
  expect(screen.getByText('没有找到相关原文。')).toBeTruthy();
});

it('retains the selected other route and reading position on return', () => {
  const view = render(React.createElement(ReadingScreen));
  fireEvent.keyDown(view.container.querySelector('g[data-node-id="right"]')!, { key: 'Enter' });
  const main = screen.getByRole('main'); main.scrollTop = 143; fireEvent.scroll(main);
  view.unmount();
  render(React.createElement(ReadingScreen));
  expect(within(screen.getByRole('main')).getByText('右侧路线证词')).toBeTruthy();
  expect(screen.getByRole('main').scrollTop).toBe(143);
});

it('keeps restores explicit, surfaces failures and removes manual tools in restricted rewind', async () => {
  useGameStore.setState({ backtrackToNode: vi.fn().mockRejectedValue(new Error('读取存档失败')) });
  const view = render(React.createElement(ReadingScreen));
  fireEvent.click(screen.getByRole('button', { name: '回档到此处' }));
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认回档' }));
  expect((await screen.findByRole('alert')).textContent).toContain('读取存档失败');
  view.unmount();
  const world = useGameStore.getState().currentWorld!;
  useGameStore.setState({ currentWorld: { ...world, gameModeConfig: { ...world.gameModeConfig, rewind: { enabled: true, anchorLabels: ['渡口'] } } } });
  render(React.createElement(ReadingScreen));
  expect(screen.queryByRole('button', { name: '回档到此处' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除节点及后代' })).toBeNull();
  expect(screen.getByText(/依据剧情和角色能力判断目标/)).toBeTruthy();
});

it('fits a long history into a short phone graph instead of stopping at the old zoom floor', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 390, 180));
  const history = Array.from({ length: 240 }, (_, step) => make(`long-${step}`, step ? `long-${step - 1}` : null, step, step < 239 ? [`long-${step + 1}`] : [], `已读原文 ${step}`));
  useGameStore.setState({ allNodes: Object.fromEntries(history.map(node => [node.id, node])), currentNode: history.at(-1)! });
  const view = render(React.createElement(ReadingScreen));
  fireEvent.click(screen.getByRole('button', { name: '适应视图' }));
  const graph = view.container.querySelector('.eidos-worldline-canvas')!;
  expect(Number(graph.getAttribute('data-worldline-scale'))).toBeLessThan(16);
  const marks = view.container.querySelectorAll('g[data-node-id]');
  expect(marks).toHaveLength(240);
  for (const mark of marks) {
    const rect = mark.querySelector('rect')!;
    expect(Number(rect.getAttribute('y'))).toBeGreaterThan(36);
    expect(Number(rect.getAttribute('y')) + Number(rect.getAttribute('height'))).toBeLessThan(180);
  }
  expect(useGameStore.getState().currentNode?.id).toBe('long-239');
  expect(useGameStore.getState().backtrackToNode).not.toHaveBeenCalled();
});
