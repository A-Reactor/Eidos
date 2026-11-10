// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { useGameStore } from '@/store/game-store';
import type { WorldLineNode } from '@/lib/game/types';
const make = (id: string, parentId: string | null, text: string): WorldLineNode => ({ id, parentId, stepNumber: 1, childIds: [], createdAt: 1, gameTime: { day: 1, hour: 8, minute: 0 }, sceneId: 'dock', sceneName: '渡口', dayNumber: 1, timeSpent: { day: 0, hour: 0, minute: 1 }, playerInput: `交谈 ${id}`, aiResponse: text + '\n未读秘密', playerVisibleText: text, summary: '隐藏动机', worldImpacts: ['秘密计划'], snapshotHash: '', segmentHash: '', generationComplete: true });
const a = { ...make('a', null, '「船夫：明天见。」'), stepNumber: 0, childIds: ['b', 'other'] };
const b = make('b', 'a', '潮水涨了。');
const other = make('other', 'a', '另一分支的证词');
const persistWorldLineData = useGameStore.getState().persistWorldLineData;
afterEach(() => { cleanup(); useGameStore.setState({ persistWorldLineData }); });
beforeEach(() => {
  localStorage.clear();
  useGameStore.setState({ allNodes: structuredClone({ a, b, other }), currentNode: b, worldLine: null, phase: 'reading', navigationStack: ['playing'] });
});
describe('original reading', () => {
  it('retries a new excerpt after changing its note without duplicating the quote', async () => {
    useGameStore.setState({ persistWorldLineData: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined) });
    render(React.createElement(ReadingScreen));
    fireEvent.click(screen.getByRole('button', { name: '摘录这段' }));
    fireEvent.click(screen.getByRole('button', { name: '保存摘录' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('我的备注'), { target: { value: '补充的疑问' } });
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useGameStore.getState().allNodes.b.playerExcerpts).toHaveLength(1);
    expect(useGameStore.getState().allNodes.b.playerExcerpts?.[0].note).toBe('补充的疑问');
  });
  it('edits only the personal note and keeps a failed save available for retry', async () => {
    const node = { ...b, playerExcerpts: [{ id: 'quote', text: '潮水涨了。', note: '旧备注' }] };
    useGameStore.setState({ allNodes: { a, b: node }, currentNode: node,
      persistWorldLineData: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined) });
    render(React.createElement(ReadingScreen));
    fireEvent.click(screen.getByRole('button', { name: '我的摘录' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注' }));
    fireEvent.change(screen.getByLabelText('我的备注'), { target: { value: '新的疑问' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useGameStore.getState().allNodes.b.playerExcerpts).toEqual([{ id: 'quote', text: '潮水涨了。', note: '新的疑问' }]);
    expect(useGameStore.getState().allNodes.b.aiResponse).toBe(b.aiResponse);
  });
  it('shows literal matching words with context before expanding, then focuses their paragraph', () => {
    const text = '\n\n风吹过渡口。\n\n「船夫：记住代号 [A+B]，明天见。」';
    const node = make('b', 'a', text);
    useGameStore.setState({ allNodes: { a, b: node, other }, currentNode: node });
    render(React.createElement(ReadingScreen));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '[A+B]' } });
    expect(screen.getByText('[A+B]', { selector: 'mark' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText(/记住代号/).textContent).toContain('明天见');
    fireEvent.click(within(screen.getByLabelText('原文搜索结果')).getByRole('button'));
    expect(document.activeElement?.textContent).toBe('「船夫：记住代号 [A+B]，明天见。」');
    expect(screen.queryByText(/未读秘密/)).toBeNull();
  });
  it('restores search, expanded text and scroll on return, without applying it to another current node', () => {
    const view = render(React.createElement(ReadingScreen));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '船夫' } });
    fireEvent.click(within(screen.getByLabelText('原文搜索结果')).getByRole('button'));
    const main = screen.getByRole('main');
    main.scrollTop = 180;
    fireEvent.scroll(main);
    view.unmount();
    const reopened = render(React.createElement(ReadingScreen));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('船夫');
    expect(screen.getByRole('article', { name: '第0步原文' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('main').scrollTop).toBe(180);
    reopened.unmount();
    useGameStore.setState({ currentNode: other });
    render(React.createElement(ReadingScreen));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
  it('opens an excerpt source at the quoted paragraph', () => {
    const text = '\n\n渡口的风。\n\n「船夫：明天见。」';
    const node = { ...make('b', 'a', text), playerExcerpts: [{ id: 'quote', text: '明天见。', note: '我的疑问' }] };
    useGameStore.setState({ allNodes: { a, b: node }, currentNode: node });
    render(React.createElement(ReadingScreen));
    fireEvent.click(screen.getByRole('button', { name: '我的摘录' }));
    fireEvent.click(screen.getByRole('button', { name: '查看来源' }));
    expect(document.activeElement?.textContent).toBe('「船夫：明天见。」');
  });
  it('finds original words, exposes context and creates/removes personal excerpts without altering narration', async () => {
    render(React.createElement(ReadingScreen));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '船夫' } });
    expect(within(screen.getByLabelText('原文搜索结果')).queryByText('交谈 b')).toBeNull();
    fireEvent.click(within(screen.getByLabelText('原文搜索结果')).getByRole('button'));
    expect(document.activeElement?.textContent).toBe('「船夫：明天见。」');
    expect(screen.queryByText(/未读秘密|隐藏动机|秘密计划|另一分支的证词/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '摘录这段' }));
    fireEvent.change(screen.getByLabelText('我的备注'), { target: { value: '我还没答应' } });
    fireEvent.click(screen.getByRole('button', { name: '保存摘录' }));
    await waitFor(() => expect(useGameStore.getState().allNodes.a.playerExcerpts?.[0].note).toBe('我还没答应'));
    fireEvent.click(screen.getByRole('button', { name: '我的摘录' }));
    expect(screen.getByText(/我的备注：我还没答应/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除摘录' }));
    await waitFor(() => expect(useGameStore.getState().allNodes.a.playerExcerpts).toEqual([]));
    expect(useGameStore.getState().allNodes.a.aiResponse).toBe('「船夫：明天见。」\n未读秘密');
  });
  it('keeps empty searches safe, returns to the game and reaches branch tools explicitly', () => {
    render(React.createElement(ReadingScreen));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '未读秘密' } });
    expect(screen.getByText('没有找到相关原文。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(useGameStore.getState().phase).toBe('playing');
  });
});

it('shows long original paragraphs and action headings without shortening them', () => {
  const text = '完整原文。'.repeat(160) + '原文末尾标记';
  const action = '调查广场与日晷。'.repeat(12) + '行动末尾标记';
  const node = { ...make('long', null, text), playerInput: action };
  useGameStore.setState({ allNodes: { long: node }, currentNode: node });
  render(React.createElement(ReadingScreen));
  expect(screen.getByText(text).textContent).toBe(text);
  expect(screen.getByRole('heading', { name: action })).toBeTruthy();
  expect(screen.queryByText('未读秘密')).toBeNull();
});
it('shows an entry-bearing action once in the graph, text and search',()=>{
 const parent={...a,stepNumber:20,childIds:['fresh'],aiResponse:'源节点完整正文。',playerVisibleText:'源节点完整正文。'};
 const fresh={...b,id:'fresh',parentId:parent.id,stepNumber:21,playerInput:'新的行动',aiResponse:'独立的新正文。',playerVisibleText:'独立的新正文。',
  entry:{version:1 as const,id:'entry-view',sourceNodeId:parent.id,originNodeId:'other',changes:[],presentationOrder:1,snapshotHash:'before'}};
 useGameStore.setState({allNodes:{[parent.id]:parent,fresh},currentNode:fresh});
 render(React.createElement(ReadingScreen));
 expect(screen.getByRole('article',{name:'第21步原文'}).textContent).toContain('独立的新正文。');
 expect(screen.getAllByText('源节点完整正文。')).toHaveLength(1);
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'源节点完整正文'}});
 expect(within(screen.getByLabelText('原文搜索结果')).getAllByRole('button')).toHaveLength(1);
 expect(useGameStore.getState().allNodes.fresh.parentId).toBe(parent.id);
});
it('shows the full visible original immediately in the node inspector', async () => {
  const { InspectorPanel } = await import('@/components/game/worldline/InspectorPanel');
  const text = '可查阅的完整文字。'.repeat(100) + '末尾证词';
  render(React.createElement(InspectorPanel, { node: make('long', null, text), onBacktrack: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() }));
  expect(screen.getByText(text).textContent).toBe(text);
  expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull();
  expect(screen.queryByText('未读秘密')).toBeNull();
});
