// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NarrativeText } from '@/components/game/NarrativeText';
import { useGameStore } from '@/store/game-store';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
afterEach(cleanup);
it('opens a document preview from a hyperlink inside narration without advancing its paragraph', async () => {
  const scope = { worldId: crypto.randomUUID(), playthroughId: 'inline', archiveId: 'main' };
  const doc = await saveLocalDocument(scope, { title: '报告', content: '完整报告结尾' });
  useGameStore.setState({ currentWorld: { id: scope.worldId } as never, currentPlaythroughId: scope.playthroughId, sandboxMode: false });
  let advanced = 0;
  render(React.createElement('p', { onClick: () => advanced++ }, React.createElement(NarrativeText, { text: `她递来[报告](document://${doc.documentId}/${doc.revision})。` })));
  expect(screen.getByText('她递来', { exact: false }).textContent).toBe('她递来报告。');
  fireEvent.click(screen.getByRole('link', { name: '报告' }));
  expect(await screen.findByText('完整报告结尾')).toBeTruthy();
  expect(advanced).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '返回剧情' }));
  expect(advanced).toBe(0);
});
it('does not reveal link syntax while the label is being typed', () => {
  const source = '她递来[调查报告](document://report/material_1234567890abcdef)。';
  const view = render(React.createElement(NarrativeText, { text: '她递来[调查', source }));
  expect(view.container.textContent).toBe('她递来调查');
});
