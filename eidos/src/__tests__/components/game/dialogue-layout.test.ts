// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogueReadout } from '@/components/game/DialogueReadout';
import { ActionRecordPanel } from '@/components/game/ActionRecordPanel';

const dialogue = { type: 'dialogue' as const, speaker: '船夫', text: '河岸的灯火。'.repeat(100) };
const draw = (text = '河岸', key = 'one') => React.createElement(DialogueReadout, {
  currentSegment: dialogue, displayedText: text, passageKey: key, sceneName: '渡口', hasSceneImage: false,
});
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('routes readout clicks to its advance callback once, without clicking through, and keeps replay separate', () => {
  const advance = vi.fn(), replay = vi.fn(), through = vi.fn();
  const view = render(React.createElement('div', { onClick: through }, React.createElement(DialogueReadout, {
    currentSegment: dialogue, displayedText: '河岸', sceneName: '', hasSceneImage: false, onReplay: replay, onAdvance: advance,
  })));
  fireEvent.click(screen.getByLabelText('当前对话读条'));
  fireEvent.click(screen.getByText('河岸', { exact: false, selector: 'p' }));
  fireEvent.click(view.container.querySelector('.eidos-dialogue-readout__avatar')!);
  fireEvent.click(screen.getByRole('button', { name: '船夫' }));
  expect(through).not.toHaveBeenCalled();
  expect(advance).toHaveBeenCalledTimes(3);
  expect(replay).toHaveBeenCalledTimes(1);
});

it('changes height only through its top handle and retains the chosen height across passages and remounts', () => {
  const view = render(draw());
  const handle = screen.getByRole('separator', { name: '对话框高度' });
  const initial = Number(handle.getAttribute('aria-valuenow'));
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(Number(handle.getAttribute('aria-valuenow'))).toBe(initial + 24);
  view.rerender(draw(dialogue.text, 'two'));
  expect(Number(handle.getAttribute('aria-valuenow'))).toBe(initial + 24);
  view.unmount(); render(draw());
  expect(Number(screen.getByRole('separator', { name: '对话框高度' }).getAttribute('aria-valuenow'))).toBe(initial + 24);
});

it('scrolls growing dialogue in ordinary image layout without overriding a deliberate scroll back', () => {
  let height = 80;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  const view = render(draw());
  const text = view.container.querySelector<HTMLElement>('.eidos-dialogue-readout__text')!;
  height = 300; view.rerender(draw('河岸的灯火'));
  expect(text.scrollTop).toBe(300);
  text.scrollTop = 20; height = 400; view.rerender(draw('河岸的灯火映在水中'));
  expect(text.scrollTop).toBe(20);
  view.rerender(draw('新一段', 'two'));
  expect(text.scrollTop).toBe(0);
});

it('keeps a replayed full paragraph at its beginning while playback replaces the previous text', () => {
  let height = 80;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  const drawReview = (text: string) => React.createElement(DialogueReadout, {
    currentSegment: dialogue, displayedText: text, passageKey: 'review', animate: false, sceneName: '', hasSceneImage: false,
  });
  const view = render(drawReview('上一段残留文本'));
  height = 800;
  view.rerender(drawReview(dialogue.text));
  expect(view.container.querySelector('.eidos-dialogue-readout__text')?.scrollTop).toBe(0);
});

it.each([{ height: 100, want: 320 }, { height: 500, want: 584 }])('keeps the playing paragraph above dialogue, or its first line at the record top when too tall ($height)', ({ height, want }) => {
  const original = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) { if (typeof options !== 'number') this.scrollTop = options?.top ?? 0; };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.eidos-record-scroll')) return new DOMRect(0, 100, 480, 600);
    if (this.matches('.eidos-dialogue-readout')) return new DOMRect(0, 496, 800, 240);
    if (this.hasAttribute('data-record-segment')) return new DOMRect(0, 700 - (this.closest('.eidos-record-scroll')?.scrollTop ?? 0), 480, height);
    return new DOMRect(0, 0, 1000, 800);
  });
  try {
    const view = render(React.createElement('div', { 'data-story-stage': '' }, draw(), React.createElement(ActionRecordPanel, {
      visualLayout: true, focused: false, pageKey: 0, segments: [{ type: 'narration', text: '正在播放的旁白' }],
      segmentIndex: 0, showing: true, loading: false, fallback: '', actions: [],
      onAction: vi.fn(), onReplay: vi.fn(), onNavigate: vi.fn(), onFocusChange: vi.fn(),
    })));
    expect(view.container.querySelector('.eidos-record-scroll')?.scrollTop).toBe(want);
    expect(view.container.querySelector('[data-current-record-segment]')?.getAttribute('data-record-segment')).toBe('0');
  } finally { HTMLElement.prototype.scrollTo = original; }
});

it('does not advance while selecting text or using the height handle', () => {
  const advance = vi.fn();
  render(React.createElement(DialogueReadout, { currentSegment: dialogue, displayedText: '河岸', sceneName: '', hasSceneImage: false, onAdvance: advance }));
  fireEvent.click(screen.getByRole('separator', { name: '对话框高度' }));
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '选中的文字' } as Selection);
  fireEvent.click(screen.getByLabelText('当前对话读条'));
  expect(advance).not.toHaveBeenCalled();
});
it('shows enabled narration without a location heading or avatar, retaining the chosen height', () => {
  localStorage.setItem('eidos-dialogue-height', '320');
  const p = { currentSegment: { type: 'narration' as const, text: '河面起雾了。' }, displayedText: '河面', sceneName: '渡口', hasSceneImage: true };
  const view = render(React.createElement(DialogueReadout, p));
  expect(screen.queryByLabelText('当前对话读条')).toBeNull();
  view.rerender(React.createElement(DialogueReadout, { ...p, hideNarration: false }));
  expect(screen.getByRole('separator', { name: '对话框高度' }).getAttribute('aria-valuenow')).toBe('320');
  expect(view.container.querySelector('.eidos-dialogue-readout__speaker')).toBeNull();
  expect(view.container.querySelector('.eidos-dialogue-readout__avatar')).toBeNull();
  expect(screen.queryByText('渡口')).toBeNull();
});
