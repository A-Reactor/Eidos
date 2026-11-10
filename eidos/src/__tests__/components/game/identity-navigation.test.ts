// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Home from '@/app/page';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('eidos_storage_version', '3');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: buildRiftCityStartState().world,
    currentPlaythroughId: 'new-tree-awaiting-identity',
    identityOptions: [{ id: 'visitor', name: '旅人', description: '从渡口出发', openingNarrative: '你来到渡口。', startingScene: 'lower_entrance' }] });
  useGameStore.getState().setPhase('world_select');
  useGameStore.getState().setPhase('identity');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('returns to the world library on Escape while a new tree is awaiting its identity', async () => {
  render(React.createElement(Home));
  await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
  expect(useGameStore.getState().phase).toBe('world_select');
  expect(useGameStore.getState().playerName).toBe('');
  expect(screen.queryByRole('region', { name: '行动记录' })).toBeNull();
});

it('returns through settings to identity, then to the library without entering the new tree', async () => {
  useGameStore.getState().setPhase('settings');
  useGameStore.getState().goBack();
  expect(useGameStore.getState().phase).toBe('identity');
  render(React.createElement(Home));
  await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
  expect(useGameStore.getState().phase).toBe('world_select');
});
