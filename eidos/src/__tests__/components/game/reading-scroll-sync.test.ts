// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { WorldLineBrowser } from '@/components/game/WorldLineBrowser';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldLineNode } from '@/lib/game/types';

const node = (id: string, parentId: string | null, stepNumber: number, childIds: string[]): WorldLineNode => ({
  id, parentId, childIds, stepNumber, dayNumber: 1, createdAt: stepNumber,
  gameTime: { day: 1, hour: 8, minute: stepNumber }, timeSpent: { day: 0, hour: 0, minute: 1 },
  sceneId: 'dock', sceneName: '渡口', playerInput: `行动 ${id}`, playerVisibleText: `已读正文 ${id}`,
  aiResponse: `完整正文 ${id}`, summary: '', worldImpacts: [], snapshotHash: '', segmentHash: '', generationComplete: true,
});
const root = node('sync-root', null, 0, ['sync-live', 'sync-other']);
const live = node('sync-live', root.id, 1, []);
const other = node('sync-other', root.id, 1, []);
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
const scrollIntoView = vi.fn(function (this: HTMLElement) {
  const viewport = this.closest('main');
  const record = this.closest('.eidos-reading-record');
  if (viewport && record) viewport.scrollTop = [...viewport.querySelectorAll('.eidos-reading-record')].indexOf(record) * 500 - 24;
});

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const viewport = this.closest('main');
    if (this.matches('.eidos-reading-content')) return new DOMRect(800, 100, 600, 400);
    if (viewport && this.matches('.eidos-reading-record')) {
      const index = [...viewport.querySelectorAll('.eidos-reading-record')].indexOf(this);
      return new DOMRect(800, 100 + index * 500 - viewport.scrollTop, 600, 500);
    }
    return new DOMRect(0, 0, 800, 600);
  });
  useGameStore.setState({ currentWorld: buildRiftCityStartState().world, worldLine: null, currentNode: live,
    allNodes: structuredClone({ [root.id]: root, [live.id]: live, [other.id]: other }),
    phase: 'reading', pendingInput: '保留的行动草稿', navigationStack: ['playing'] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

const graphNode = (container: HTMLElement, id: string) => container.querySelector(`g[data-node-id="${id}"]`);
const expectCentered = (container: HTMLElement, id: string) => {
  const mark = graphNode(container, id);
  expect(mark?.getAttribute('aria-pressed')).toBe('true');
  expect(Number(mark?.querySelector('circle')?.getAttribute('cx'))).toBeCloseTo(418);
  expect(Number(mark?.querySelector('circle')?.getAttribute('cy'))).toBeCloseTo(318);
};

it.each([{ entry: 'reading', Component: ReadingScreen }, { entry: 'worldline', Component: WorldLineBrowser }])('follows the visible reading record without moving text, focus, zoom or live progress through $entry', async ({ Component }) => {
  const { container } = render(React.createElement(Component));
  const viewport = screen.getByRole('main');
  const graph = container.querySelector('.eidos-worldline-canvas')!;
  fireEvent.wheel(graph, { deltaY: 20, ctrlKey: true });
  const scale = graph.getAttribute('data-worldline-scale');
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '已读正文' } });
  search.focus();
  const scrollCalls = scrollIntoView.mock.calls.length;
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);

  await waitFor(() => expectCentered(container, root.id));
  expect(screen.getByRole('article', { name: '第0步原文' }).getAttribute('data-selected')).toBe('true');
  expect(viewport.scrollTop).toBe(200);
  expect(document.activeElement).toBe(search);
  expect((search as HTMLInputElement).value).toBe('已读正文');
  expect(scrollIntoView.mock.calls).toHaveLength(scrollCalls);
  expect(graph.getAttribute('data-worldline-scale')).toBe(scale);
  expect(useGameStore.getState().currentNode?.id).toBe(live.id);
  expect(useGameStore.getState().pendingInput).toBe('保留的行动草稿');

  fireEvent.wheel(graph, { deltaY: 45 });
  const panned = graphNode(container, root.id)?.querySelector('circle')?.getAttribute('cy');
  viewport.scrollTop = 250;
  fireEvent.scroll(viewport);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(graphNode(container, root.id)?.querySelector('circle')?.getAttribute('cy')).toBe(panned);

  viewport.scrollTop = 520;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, live.id));
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, root.id));

  fireEvent.click(screen.getByRole('button', { name: '回到当前节点' }));
  expectCentered(container, live.id);
  expect(viewport.scrollTop).toBe(476);
});

it('follows the viewed branch by node identity even when another branch has the same step number', async () => {
  const { container } = render(React.createElement(ReadingScreen));
  fireEvent.click(screen.getByRole('button', { name: '适应视图' }));
  fireEvent.keyDown(graphNode(container, other.id)!, { key: 'Enter' });
  const viewport = screen.getByRole('main');
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, root.id));
  viewport.scrollTop = 520;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, other.id));
  expect(screen.getByRole('main').textContent).toContain('已读正文 sync-other');
  expect(screen.getByRole('main').textContent).not.toContain('已读正文 sync-live');
  expect(useGameStore.getState().currentNode?.id).toBe(live.id);
});

it('hands off to the next record in the upper reading area while the previous record leaves the viewport', async () => {
  const { container } = render(React.createElement(ReadingScreen));
  const viewport = screen.getByRole('main');
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, root.id));
  viewport.scrollTop = 425;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, live.id));
  expect(viewport.scrollTop).toBe(425);
});

it('keeps an explicit graph jump selected when its programmatic text scroll emits an event', async () => {
  const { container } = render(React.createElement(ReadingScreen));
  fireEvent.click(screen.getByRole('button', { name: '适应视图' }));
  fireEvent.keyDown(graphNode(container, other.id)!, { key: 'Enter' });
  const viewport = screen.getByRole('main');
  const position = graphNode(container, other.id)?.querySelector('circle')?.getAttribute('cy');
  const calls = scrollIntoView.mock.calls.length;
  fireEvent.scroll(viewport);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(graphNode(container, other.id)?.getAttribute('aria-pressed')).toBe('true');
  expect(graphNode(container, other.id)?.querySelector('circle')?.getAttribute('cy')).toBe(position);
  expect(scrollIntoView.mock.calls).toHaveLength(calls);
  expect(useGameStore.getState().currentNode?.id).toBe(live.id);
});

it('restores the graph to the reading node when reopening a scrolled history', async () => {
  const view = render(React.createElement(ReadingScreen));
  const viewport = screen.getByRole('main');
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(view.container, root.id));
  view.unmount();
  const reopened = render(React.createElement(ReadingScreen));
  expect(screen.getByRole('main').scrollTop).toBe(200);
  expectCentered(reopened.container, root.id);
  expect(useGameStore.getState().currentNode?.id).toBe(live.id);
});

it('tracks location-filtered prose without clearing the filter and leaves excerpt scrolling alone', async () => {
  useGameStore.setState(state => ({ allNodes: { ...state.allNodes, [root.id]: { ...root, sceneName: '旧渡口',
    playerExcerpts: [{ id: 'quote', text: '已读正文 sync-root', note: '' }] } } }));
  const { container } = render(React.createElement(ReadingScreen));
  fireEvent.change(screen.getByRole('combobox', { name: '地点' }), { target: { value: '旧渡口' } });
  const viewport = screen.getByRole('main');
  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  await waitFor(() => expectCentered(container, root.id));
  expect((screen.getByRole('combobox', { name: '地点' }) as HTMLSelectElement).value).toBe('旧渡口');
  expect(screen.queryByRole('article', { name: '第1步原文' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '我的摘录' }));
  fireEvent.wheel(container.querySelector('.eidos-worldline-canvas')!, { deltaY: 40 });
  const position = graphNode(container, root.id)?.querySelector('circle')?.getAttribute('cy');
  viewport.scrollTop = 200;
  fireEvent.scroll(viewport);
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(graphNode(container, root.id)?.querySelector('circle')?.getAttribute('cy')).toBe(position);
  expect(screen.getByRole('button', { name: '全部原文' })).toBeDefined();
});
