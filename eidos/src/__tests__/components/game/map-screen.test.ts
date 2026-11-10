// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { MapScreen } from '@/components/game/MapScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { Scene } from '@/lib/game/types';

afterEach(cleanup);
beforeEach(() => {
  const world = buildRiftCityStartState().world;
  const scene = (id: string, name: string, connections: string[]) => ({ id, name, connections, region: '居住区', initialDescription: '未读描述', detailLevel: 0, npcs: [], secrets: ['隐藏机关'], discoveredSecrets: [] } as Scene);
  world.regions = { living: { id: 'living', description: '后台秘密', scenes: { a: scene('a', '宿舍', ['b']), b: scene('b', '大厅', ['hidden']), c: scene('c', '旧庭院', ['a']), hidden: scene('hidden', '密室', []) } } };
  useGameStore.setState({ currentWorld: world, currentSceneId: 'a', currentScene: world.regions.living.scenes.a, visitedScenes: ['a', 'c'], currentNode: null, allNodes: {}, phase: 'map', navigationStack: ['playing'], isLoading: false, mapTravelRequest: null });
});
it('selects before travelling, exposes no hidden description, and queues a single action without teleporting', () => {
  render(React.createElement(MapScreen));
  fireEvent.click(screen.getByRole('button', { name: '选择地点：大厅' }));
  expect(useGameStore.getState().currentSceneId).toBe('a');
  expect(useGameStore.getState().mapTravelRequest).toBeNull();
  expect(screen.queryByText(/未读描述|隐藏机关|密室|后台秘密/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '前往大厅' }));
  expect(useGameStore.getState().phase).toBe('playing');
  expect(useGameStore.getState().currentSceneId).toBe('a');
  expect(useGameStore.getState().mapTravelRequest?.to).toBe('b');
  expect(useGameStore.getState().requestMapTravel('b')).toBe(false);
  act(() => {
    expect(useGameStore.getState().takeMapTravelRequest()?.to).toBe('b');
    expect(useGameStore.getState().takeMapTravelRequest()).toBeNull();
  });
});
it('blocks old visited destinations without outgoing paths and refuses travel while busy', () => {
  render(React.createElement(MapScreen));
  fireEvent.click(screen.getByRole('button', { name: '选择地点：旧庭院' }));
  expect((screen.getByRole('button', { name: '暂无直达路线' }) as HTMLButtonElement).disabled).toBe(true);
  expect(useGameStore.getState().requestMapTravel('c')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '选择地点：大厅' }));
  act(() => useGameStore.setState({ isLoading: true }));
  expect((screen.getByRole('button', { name: '行动处理中…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(useGameStore.getState().requestMapTravel('b')).toBe(false);
});
it('supports list selection, recentering and returning without changing scene or draft', () => {
  useGameStore.setState({ pendingInput: '还没说完的话' });
  render(React.createElement(MapScreen));
  fireEvent.click(within(screen.getByRole('navigation', { name: '已知地点列表' })).getByRole('button', { name: '选择地点：大厅' }));
  expect(screen.getByRole('button', { name: '前往大厅' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '放大地图' }));
  expect(screen.getByLabelText('地图缩放').textContent).toBe('120%');
  fireEvent.click(screen.getByRole('button', { name: '回到当前位置' }));
  expect(screen.getByLabelText('地图缩放').textContent).toBe('100%');
  expect((screen.getByRole('button', { name: '已在此处' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(useGameStore.getState().phase).toBe('playing');
  expect(useGameStore.getState().pendingInput).toBe('还没说完的话');
  expect(useGameStore.getState().currentSceneId).toBe('a');
});
it('clears a pending route when leaving the game or entering another secondary page', () => {
  expect(useGameStore.getState().requestMapTravel('b')).toBe(true);
  useGameStore.getState().setPhase('settings');
  expect(useGameStore.getState().mapTravelRequest).toBeNull();
});
it('shows AI notes and closed passages, with travel disabled', () => {
  useGameStore.getState().applyMapUpdates({ places: [{ id: 'b', note: '大厅正在检修，请从侧门绕行。' }], routes: [{ from: 'a', to: 'b', status: 'blocked', bidirectional: true }] });
  render(React.createElement(MapScreen));
  expect(screen.getByRole('button', { name: '→ 大厅 · 已封闭' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '选择地点：大厅' }));
  expect(screen.getByText('大厅正在检修，请从侧门绕行。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '通路已封闭' }) as HTMLButtonElement).disabled).toBe(true);
});
it('plans a multi-hop route through known open nodes', () => {
  const state = useGameStore.getState();
  useGameStore.setState({ visitedScenes: ['a', 'b', 'c'], currentWorld: { ...state.currentWorld!, mapState: { places: {}, routes: [{ from: 'b', to: 'c', status: 'open' }] } } });
  render(React.createElement(MapScreen));
  fireEvent.click(screen.getByRole('button', { name: '选择地点：旧庭院' }));
  expect(screen.getByText(/路线：宿舍 → 大厅 → 旧庭院/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '连续前往旧庭院' }));
  expect(useGameStore.getState().mapTravelRequest?.path).toEqual(['a', 'b', 'c']);
  expect(useGameStore.getState().currentSceneId).toBe('a');
});

it('keeps the full read original in place details while excluding unread continuation',()=>{
 const text='地点原文。'.repeat(100)+'地点原文末尾';
 const node={id:'long',parentId:null,childIds:[],sceneId:'a',aiResponse:text+'未读后续',playerVisibleText:text,generationComplete:true};
 useGameStore.setState({allNodes:{long:node as never},currentNode:node as never});
 render(React.createElement(MapScreen));
 expect(screen.getByText(text).textContent).toBe(text);
 expect(screen.queryByText(/未读后续/)).toBeNull();
});
