// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NarrativeText } from '@/components/game/NarrativeText';
import { ActionRecordPanel } from '@/components/game/ActionRecordPanel';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { readFileSync } from 'node:fs';
import type { TextEffect } from '@/lib/game/text-effects';
import type { WorldLineNode } from '@/lib/game/types';
import { compilePresentation, advancePresentation } from '@/lib/game/presentation';
const plugin = parsePluginFile(JSON.parse(readFileSync('mods/dist/palimpsest-stage.eidos-plugin.json', 'utf8')))[0];
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: [{...plugin,release:'0.3.0'}] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('renders ordinary prose as the same text node with no extra panel or wrapper', () => {
  const { container } = render(React.createElement(NarrativeText, { text: '风把门推开了。' }));
  expect(container.innerHTML).toBe('风把门推开了。');
});
it('keeps provisional text separate from the live node even when their original words match', () => {
  const text = '信上写着去左门。';
  const lines = [{ type: 'narration' as const, text, textEffects: [{ kind: 'replace' as const, quote: '左门', value: '右门', afterSegments: -1 }] }];
  const node = { id: 'old-record', parentId: null, childIds: [], aiResponse: text, playerVisibleText: text, playerInput: '看信', summary: '',
    stepNumber: 1, snapshotHash: '', segmentHash: 'old-record', createdAt: 1, gameTime: { day: 0, hour: 8, minute: 0 }, sceneId: 'dock', sceneName: '渡口', dayNumber: 0,
    timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], generationComplete: true } as WorldLineNode;
  node.presentation = compilePresentation(node, lines, {});
  const nodes = advancePresentation({ [node.id]: node }, node.id, 0, text.length, true, 0);
  useGameStore.setState({ allNodes: nodes, currentNode: nodes[node.id] });
  const view = render(React.createElement(NarrativeText, { text, segmentIndex: 0 }));
  expect(view.container.textContent).toBe('信上写着去右门。');
  view.rerender(React.createElement(NarrativeText, { text, segmentIndex: 0, nodeId: null }));
  expect(view.container.textContent).toBe('信上写着去左门。');
});
it('changes only fully typed targets after their delay and cancels stale timers on paragraph changes', () => {
  vi.useFakeTimers();
  const effects: TextEffect[] = [{ kind: 'replace', quote: '明天', value: '永远', delayMs: 600 }];
  const { container, rerender } = render(React.createElement(NarrativeText, { text: '明', source: '明天见。', effects }));
  act(() => vi.advanceTimersByTime(1000)); expect(container.textContent).toBe('明');
  rerender(React.createElement(NarrativeText, { text: '明天见。', effects }));
  act(() => vi.advanceTimersByTime(599)); expect(container.textContent).toBe('明天见。');
  act(() => vi.advanceTimersByTime(1)); expect(container.textContent).toBe('永远见。');
  rerender(React.createElement(NarrativeText, { text: '下一页。', effects }));
  act(() => vi.advanceTimersByTime(5000)); expect(container.innerHTML).toBe('下一页。');
});
it('combines masking, color and scale on text while preserving the rest of the sentence', () => {
  const effects: TextEffect[] = [{ kind: 'mask', quote: '澄' }, { kind: 'color', quote: '澄', value: 'accent' }, { kind: 'size', quote: '澄', value: 'large' }];
  const { container } = render(React.createElement(NarrativeText, { text: '澄在这里。', effects }));
  expect(container.querySelector('.is-mask.is-color-accent.is-size-large')?.textContent).not.toBe('澄');
  expect(container.textContent).not.toContain('澄');
  expect(container.textContent).toContain('在这里。');
  expect(container.querySelectorAll('button,aside,section,iframe')).toHaveLength(0);
});
it('waits for paragraph finality before unquoted streaming replacements', () => {
  const effects: TextEffect[] = [{ kind: 'replace', value: '她明天会死。' }];
  const { container, rerender } = render(React.createElement(NarrativeText, { text: '她', effects, occurrence: 'paragraph-1', sourceComplete: false }));
  expect(container.textContent).toBe('她');
  rerender(React.createElement(NarrativeText, { text: '她在这里。', effects, occurrence: 'paragraph-1', sourceComplete: true }));
  expect(container.textContent).toBe('她明天会死。');
});
it('keeps a completed phrase timer through streaming appends, then resets for another passage', () => {
  vi.useFakeTimers();
  const effects: TextEffect[] = [{ kind: 'replace', quote: '明天', value: '永远', delayMs: 100 }];
  const { container, rerender } = render(React.createElement(NarrativeText, { text: '明天', effects, occurrence: 'first', sourceComplete: false }));
  act(() => vi.advanceTimersByTime(65));
  rerender(React.createElement(NarrativeText, { text: '明天见。', effects, occurrence: 'first', sourceComplete: false }));
  act(() => vi.advanceTimersByTime(35)); expect(container.textContent).toBe('永远见。');
  rerender(React.createElement(NarrativeText, { text: '明天见。', effects, occurrence: 'second' }));
  expect(container.textContent).toBe('明天见。');
  act(() => vi.advanceTimersByTime(99)); expect(container.textContent).toBe('明天见。');
  act(() => vi.advanceTimersByTime(1)); expect(container.textContent).toBe('永远见。');
});
it('removes decorations when restoring a world without the plugin', () => {
  const { container } = render(React.createElement(NarrativeText, { text: '她记得。', effects: [{ kind: 'garble' }] }));
  expect(container.textContent).not.toBe('她记得。');
  act(() => useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameplayPlugins: [] } })));
  expect(container.innerHTML).toBe('她记得。');
});
it('alters native recommendation lettering but submits the original action exactly once', () => {
  const onAction = vi.fn();
  render(React.createElement(ActionRecordPanel, { pageKey: 0, segments: [{ type: 'narration', text: '信封上留着她的名字。', textEffects: [{ kind: 'replace', target: 'choice', quote: '记住她的名字', value: '忘了她的名字' }] }], segmentIndex: 0, showing: false, loading: false, fallback: '', actions: ['记住她的名字'], onAction, onReplay: vi.fn(), onNavigate: vi.fn(), onFocusChange: vi.fn() }));
  const choice = screen.getByRole('button', { name: /忘了她的名字/ });
  expect(choice.textContent).toContain('忘了她的名字');
  expect(screen.queryByText('原文：记住她的名字')).toBeNull();
  fireEvent.click(choice); expect(onAction).toHaveBeenCalledExactlyOnceWith('记住她的名字');
});
