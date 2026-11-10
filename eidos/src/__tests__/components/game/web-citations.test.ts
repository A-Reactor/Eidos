// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NarrativeText, EffectText } from '@/components/game/NarrativeText';
import { ReadingText } from '@/components/game/ReadingText';
import { extractSpokenDialogue } from '@/lib/game/momoi/spoken-text';
import { useGameStore } from '@/store/game-store';

beforeEach(() => useGameStore.setState(useGameStore.getInitialState()));
afterEach(cleanup);
const source = '查阅了[TypeScript 官方文档](https://www.typescriptlang.org/docs/?from=search)，可以继续。';
it('groups sources into one numeric superscript using the actual deduplicated search pages', () => {
  const view = render(React.createElement(NarrativeText, { text: source,
    searchSources: [{ label: '文档', url: 'https://www.typescriptlang.org/docs/' }, { label: '手册', url: 'https://www.typescriptlang.org/docs/handbook/' }, { label: '文档再次命中', url: 'https://www.typescriptlang.org/docs/#intro' }] }));
  const button = screen.getByRole('button', { name: '查看搜索来源（2 个网页）' });
  expect(button.textContent).toBe('2');
  expect(button.closest('sup')).not.toBeNull();
  expect(view.container.querySelectorAll('.eidos-inline-source')).toHaveLength(1);
  fireEvent.click(button);
  expect(screen.getAllByRole('link', { name: /打开原网页/ })).toHaveLength(2);
});
it('keeps source URLs out of prose and opens a compact source preview without advancing the story', () => {
  let advanced = 0;
  const view = render(React.createElement('p', { onClick: () => advanced++ }, React.createElement(NarrativeText, { text: source })));
  expect(view.container.textContent).toContain('查阅了TypeScript 官方文档');
  expect(view.container.textContent).not.toContain('https://');
  expect(view.container.textContent).not.toContain('](');
  const button = screen.getByRole('button', { name: /查看搜索来源/ }); button.focus(); fireEvent.click(button);
  const dialog = screen.getByRole('dialog', { name: '引用来源' });
  expect(dialog.textContent).toContain('www.typescriptlang.org');
  const link = screen.getByRole('link', { name: /打开原网页/ });
  expect(link.getAttribute('href')).toBe('https://www.typescriptlang.org/docs/?from=search');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toContain('noopener');
  expect(advanced).toBe(0);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button);
});
it('hides bare URLs and preserves punctuation and text around them', () => {
  const view = render(React.createElement(NarrativeText, { text: '来源：https://example.com/article_(guide)。接着说。' }));
  expect(view.container.textContent).not.toContain('https://');
  expect(view.container.textContent).toContain('。接着说。');
  fireEvent.click(screen.getByRole('button', { name: /查看搜索来源/ }));
  expect(screen.getByRole('link', { name: /打开原网页/ }).getAttribute('href')).toBe('https://example.com/article_(guide)');
});
it('does not flash a URI or activate its source before the typewriter reaches the end of the reference', () => {
  const view = render(React.createElement(NarrativeText, { text: source.slice(0, source.indexOf('https://') + 10), source }));
  expect(view.container.textContent).toBe('查阅了TypeScript 官方文档');
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(React.createElement(NarrativeText, { text: '查阅了[官方](https://', source: '查阅了[官方](https://', sourceComplete: false }));
  expect(view.container.textContent).toBe('查阅了官方');
  expect(screen.queryByRole('button')).toBeNull();
});
it('waits for the completed paragraph before exposing the source count in an effect projection', () => {
  const props = { runs: [{ text: '查阅中', effects: [] }], searchSources: [{ label: '原文', url: 'https://example.com/docs' }] };
  const view = render(React.createElement(EffectText, { ...props, sourceComplete: false }));
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(React.createElement(EffectText, { ...props, sourceComplete: true }));
  expect(screen.getByRole('button', { name: '查看搜索来源（1 个网页）' }).textContent).toBe('1');
});
it('uses the same source presentation in history reading without losing the readable label', () => {
  const view = render(React.createElement(ReadingText, { text: source, query: 'TypeScript' }));
  expect(view.container.textContent).not.toContain('https://');
  expect(view.container.textContent).toContain('TypeScript 官方文档');
  expect(screen.getByRole('button', { name: /查看搜索来源/ })).toBeTruthy();
});
it('keeps website syntax and URLs out of spoken dialogue', () => {
  expect(extractSpokenDialogue('请看[官方文档](https://example.com/docs)。也可参考 https://example.org/path。')).toBe('请看官方文档。也可参考 。');
});
it('never turns a non-web scheme into an active website source', () => {
  render(React.createElement(NarrativeText, { text: '[网页](javascript:alert(1)) [原件](file:///tmp/x)' }));
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
});
