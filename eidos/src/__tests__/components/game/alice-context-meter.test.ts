// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { AliceContextMeter } from '@/components/game/AliceContextMeter';
import { useGameStore } from '@/store/game-store';
const context = { modelId: 'gpt-4o-mini', providerId: 'openai', inputTokens: 32000, windowTokens: 128000, estimated: false };
beforeEach(() => useGameStore.setState({ currentWorld: { id: 'a' } as never, tokensUsed: 999999999, worldAliceContext: { a: context } }));
afterEach(cleanup);
it('shows request occupancy instead of cumulative usage and switches with the world', () => {
  render(React.createElement(AliceContextMeter));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  expect(screen.getByTitle('ALICE 上下文 25.0% · 32.0K / 128.0K · gpt-4o-mini').textContent).toBe('');
  act(() => useGameStore.setState({ currentWorld: { id: 'b' } as never }));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
  expect(screen.getByTitle('ALICE 上下文 · 等待首次行动')).toBeTruthy();
});
it('labels estimates and unknown windows without fabricating a percentage', () => {
  useGameStore.setState({ worldAliceContext: { a: { ...context, windowTokens: undefined, estimated: true } } });
  render(React.createElement(AliceContextMeter));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
  expect(screen.getByTitle('ALICE 上下文 · 估算 32.0K / 上限未知 · gpt-4o-mini')).toBeTruthy();
});
it('caps the bar at its visual width while keeping the true percentage', () => {
  useGameStore.setState({ worldAliceContext: { a: { ...context, inputTokens: 256000 } } });
  render(React.createElement(AliceContextMeter));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  expect(screen.getByTitle('ALICE 上下文 200.0% · 256.0K / 128.0K · gpt-4o-mini')).toBeTruthy();
});
