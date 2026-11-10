// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RegionMap } from '@/components/game/RegionMap';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
afterEach(cleanup);
it('shows reachable locations without unknown destinations or exploration scores', () => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ currentWorld: { ...world, regions: { 城区: { scenes: {
    here: { id: 'here', name: '街角', region: '城区', connections: ['next'] },
    next: { id: 'next', name: '渡口', region: '城区', connections: [] },
    secret: { id: 'secret', name: '隐藏密室', region: '城区', connections: [] },
  } } } } as any, currentSceneId: 'here', visitedScenes: ['here'], sceneDetailLevels: { here: 60 } });
  render(React.createElement(RegionMap, { onOpen: () => {} }));
  expect(screen.getByText(/渡口/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /打开地图/ })).toBeTruthy();
  expect(screen.queryByText('隐藏密室')).toBeNull();
  expect(screen.queryByRole('button', { name: 'KEI 重整理' })).toBeNull();
  expect(screen.queryByText(/6\/10/)).toBeNull();
});
