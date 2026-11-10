// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { WorldLibraryFlow } from '@/components/game/WorldLibraryFlow';
vi.mock('@/components/game/WorldSelectScreen', () => ({ WorldSelectScreen: ({ preview }: { preview: boolean }) => React.createElement('div', { 'data-preview': String(preview) },
  React.createElement('input', { 'aria-label': '集合搜索', defaultValue: '' }),
  React.createElement('button', { onClick: () => useGameStore.getState().setPhase('world_create') }, '创造一个世界')) }));
vi.mock('@/components/game/WorldCreateScreen', () => ({ WorldCreateScreen: () => React.createElement('button', { onClick: () => useGameStore.getState().setPhase('world_select') }, '返回世界集合') }));
afterEach(cleanup);
it('keeps the collection and its draft mounted below creation and restores the same page on return', () => {
  useGameStore.setState({ phase: 'world_select', navigationStack: [] });
  const view = render(React.createElement(WorldLibraryFlow));
  const search = screen.getByRole('textbox', { name: '集合搜索' });
  fireEvent.change(search, { target: { value: '纸城' } });
  fireEvent.click(screen.getByRole('button', { name: '创造一个世界' }));
  const underlay = view.container.querySelector('[data-world-collection-underlay]')!;
  expect(underlay.hasAttribute('inert')).toBe(true);
  expect(underlay.getAttribute('aria-hidden')).toBe('true');
  expect(underlay.querySelector('[data-preview="true"]')).not.toBeNull();
  expect(underlay.querySelector('input')).toBe(search);
  act(() => { fireEvent.click(screen.getByRole('button', { name: '返回世界集合' })); });
  expect(screen.getByRole('textbox', { name: '集合搜索' })).toBe(search);
  expect((search as HTMLInputElement).value).toBe('纸城');
  expect(underlay.hasAttribute('inert')).toBe(false);
  expect(underlay.querySelector('[data-preview="false"]')).not.toBeNull();
});
