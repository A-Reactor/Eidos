// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreationProgress, FIELD_MESSAGES } from '@/components/game/creation/CreationProgress';

afterEach(() => { cleanup(); vi.useRealTimers(); });
it('changes copy with actual completed fields and events rather than elapsed time', () => {
  vi.useFakeTimers();
  const props = { error: null, receivedChars: 0, completedFields: [] as string[], eventCount: 0 };
  const view = render(React.createElement(CreationProgress, props));
  expect(screen.getByText('KEI 在给这个世界起名字…')).not.toBeNull();
  act(() => vi.advanceTimersByTime(40_000));
  expect(screen.getByText('KEI 在给这个世界起名字…')).not.toBeNull();
  view.rerender(React.createElement(CreationProgress, { ...props, completedFields: ['name', 'regions'] }));
  expect(screen.getByText(FIELD_MESSAGES.regions)).not.toBeNull();
  act(() => vi.advanceTimersByTime(80_000));
  expect(screen.getByText(FIELD_MESSAGES.regions)).not.toBeNull();
  view.rerender(React.createElement(CreationProgress, { ...props, completedFields: ['timeline', 'regions'], eventCount: 4, currentField: 'npcs' }));
  expect(screen.getByLabelText('走向：已填充')).toBeTruthy();
  expect(screen.getByLabelText('人物：正在填充')).toBeTruthy();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  expect(screen.queryByText('推演时间线')).toBeNull();
});

it('shows true content fill reaching 100% while the world is being considered, without debug instructions', () => {
  const completedFields = ['name', 'subtitle', 'overview', 'regions', 'npcs', 'identityOptions', 'contradictions', 'history', 'clues', 'timeline'];
  render(React.createElement(CreationProgress, { error: null, completedFields, receivedChars: 4000, eventCount: 4, liveMessage: 'KEI正在推敲' }));
  expect(screen.getByRole('progressbar', { name: '世界内容' }).getAttribute('aria-valuenow')).toBe('100');
  expect(screen.getByText('KEI正在推敲')).toBeTruthy();
  expect(screen.queryByText(/通常需要|持续接收中|字符已接收/)).toBeNull();
  expect(screen.getByLabelText('身份：已填充')).toBeTruthy();
  expect(screen.getAllByRole('listitem')).toHaveLength(9);
});
