// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NodeActions } from '@/components/game/worldline/NodeActions';
import { useGameStore } from '@/store/game-store';
import type { WorldLineNode } from '@/lib/game/types';

afterEach(() => { cleanup(); useGameStore.setState({ isLoading: false }); });

it('protects conflicting timeline mutations during generation and releases them afterward', async () => {
  useGameStore.setState({ isLoading: true });
  const onBacktrack = vi.fn(), onDelete = vi.fn();
  const view = render(React.createElement(NodeActions, { node: { id: 'past', snapshotHash: 'snapshot' } as WorldLineNode, onBacktrack, onDelete }));
  expect(view.container.querySelector('fieldset')?.disabled).toBe(true);
  expect(screen.getByRole('status').textContent).toContain('回看不受影响');
  act(() => useGameStore.setState({ isLoading: false }));
  expect(view.container.querySelector('fieldset')?.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '回档到此处' }));
  fireEvent.click(screen.getByRole('button', { name: '确认回档' }));
  await waitFor(() => expect(onBacktrack).toHaveBeenCalledWith('past'));
  expect(onDelete).not.toHaveBeenCalled();
});
