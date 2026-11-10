// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { GameplayResources } from '@/components/game/GameplayResources';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { resourceWorld } from '../../lib/game/gameplay-resource-fixtures';
afterEach(cleanup);
it('shows current resources and units without revealing hidden counters or internal keys', () => {
  useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, ...resourceWorld() }, gameplayResources: { 'gameplay.supplies.stamina': 0, 'gameplay.supplies.food': 2, 'gameplay.supplies.secret': 4 } });
  const view = render(React.createElement(GameplayResources));
  expect(screen.getByLabelText('体力').textContent).toContain('0 点');
  expect(screen.getByLabelText('补给').textContent).toContain('2 份');
  expect(screen.queryByText('内部进度')).toBeNull();
  expect(view.container.textContent).not.toContain('gameplay.');
  act(() => useGameStore.setState({ currentWorld: buildRiftCityStartState().world, gameplayResources: {} }));
  expect(screen.queryByLabelText('玩法资源')).toBeNull();
});
