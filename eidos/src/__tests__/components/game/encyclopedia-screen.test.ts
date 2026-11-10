// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EncyclopediaScreen } from '@/components/game/EncyclopediaScreen';
import { useGameStore } from '@/store/game-store';
afterEach(cleanup);
it('legacy encyclopedia opens original reading without AI-maintenance controls or inferred facts', () => {
  useGameStore.setState({ allNodes: {}, currentNode: null, encyclopedia: [{ id: 'hidden', name: '隐秘事实', type: 'concept', description: '后台记忆', knowledge: [] }] as any });
  render(React.createElement(EncyclopediaScreen));
  expect(screen.getByRole('searchbox', { name: '搜索原文' })).toBeTruthy();
  expect(screen.queryByText('隐秘事实')).toBeNull();
  expect(screen.queryByRole('button', { name: 'KEI 重整理' })).toBeNull();
});
