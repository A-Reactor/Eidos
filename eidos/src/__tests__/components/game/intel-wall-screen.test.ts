// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { IntelWallScreen } from '@/components/game/IntelWallScreen';
import { useGameStore } from '@/store/game-store';
afterEach(cleanup);
it('legacy intel route cannot reveal tasks, hidden clues or causal projections', () => {
  useGameStore.setState({ allNodes: {}, currentNode: null, questLog: [{ title: '自动任务' }] as any, criticalFacts: [{ text: '秘密真相' }] as any });
  render(React.createElement(IntelWallScreen));
  expect(screen.getByRole('searchbox')).toBeTruthy();
  expect(screen.queryByText('自动任务')).toBeNull();
  expect(screen.queryByText('秘密真相')).toBeNull();
  expect(screen.queryByRole('button', { name: /因果|档案|任务/ })).toBeNull();
});
