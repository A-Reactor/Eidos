// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { useNativeReadingContinuation } from '@/components/game/use-native-reading-continuation';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import type { StorySegment } from '@/lib/ai/types';
beforeEach(() => {
  vi.useFakeTimers();
  const plugin = parsePluginFile(JSON.parse(readFileSync('mods/dist/continuous-novel.eidos-plugin.json', 'utf8')))[0];
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: [plugin] } });
  saveSettings({ ...loadSettings(), autoAdvance: true, modPreferences: { [plugin.id]: { auto_continue: true } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
it('continues opted-in ordinary prose once and cancels when native reading is paused', () => {
  const onContinue = vi.fn(), segments: StorySegment[] = [{ type: 'narration', text: '雨渐渐停了。' }];
  const { rerender } = renderHook(({ ready }) => useNativeReadingContinuation({ segments, ready, onContinue }), { initialProps: { ready: true } });
  act(() => vi.advanceTimersByTime(4000)); expect(onContinue).not.toHaveBeenCalled();
  rerender({ ready: false }); act(() => vi.advanceTimersByTime(2000)); expect(onContinue).not.toHaveBeenCalled();
  rerender({ ready: true }); act(() => vi.advanceTimersByTime(5000)); expect(onContinue).toHaveBeenCalledExactlyOnceWith({ kind: 'continue' });
  act(() => vi.advanceTimersByTime(15000)); expect(onContinue).toHaveBeenCalledTimes(1);
});
it.each(['choice', 'chapter', 'ending'])('never auto-submits a %s boundary', kind => {
  const onContinue = vi.fn();
  const segment: StorySegment = { type: 'narration', text: '她等着回答。', ...(kind === 'choice' ? { choices: [{ id: 'stay', label: '留下' }] } : { beat: { boundary: kind as 'chapter' | 'ending' } }) };
  renderHook(() => useNativeReadingContinuation({ segments: [segment], ready: true, onContinue }));
  act(() => vi.advanceTimersByTime(15000)); expect(onContinue).not.toHaveBeenCalled();
});
