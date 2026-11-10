// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';
import type { StorySegment } from '@/lib/ai/types';

const { ensure } = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock('@/lib/game/momoi/runtime', () => ({ getVoiceLibrary: async () => ({ ensure }), requestForSegment: (segment: StorySegment) => segment?.type === 'dialogue' ? { text: segment.text, speaker: segment.speaker } : null }));
vi.mock('@/lib/game/momoi/use-momoi-prefetch', () => ({ useMomoiPrefetch() {} }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
const audios: FakeAudio[] = [];
class FakeAudio {
  src = ''; volume = 1; playbackRate = 1;
  onended = null; onerror = null;
  pause = vi.fn(); play = vi.fn().mockResolvedValue(undefined);
  constructor(src: string) { this.src = src; audios.push(this); }
}
beforeEach(() => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel(); audios.length = 0;
  ensure.mockReset().mockResolvedValue({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
  vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), phase: 'playing', currentSceneId: snapshot.currentSceneId,
    sceneNarrative: '船夫正在说话。', savedSegments: [{ type: 'dialogue', speaker: '船夫', text: '你好，请听我说完。' }, { type: 'narration', text: '随后风吹过。' }], savedSegmentIndex: 0, savedIsShowingSegments: true,
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { enabled: true, autoPlay: true, volume: .8, speed: 1 } });
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, aliceApiKey: '' });
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it('keeps the same audio playing through the quick tools, file menu, and both preview entry points', async () => {
  const scope = currentDocumentScope(useGameStore.getState())!;
  await saveLocalDocument(scope, { title: '船夫笔记', content: '笔记的完整正文' });
  render(React.createElement(GameScreen));
  await waitFor(() => expect(useGameStore.getState().isVoicePlaying).toBe(true));
  const audio = audios[0], source = audio.src;
  const stillPlaying = () => { expect(audio.pause).not.toHaveBeenCalled(); expect(audio.src).toBe(source); expect(audios).toHaveLength(1); expect(ensure).toHaveBeenCalledOnce(); expect(useGameStore.getState().isVoicePlaying).toBe(true); };
  fireEvent.click(screen.getByRole('button', { name: '播放与快捷设置' })); stillPlaying();
  fireEvent.click(screen.getByRole('button', { name: '收起快捷设置' }));
  fireEvent.click(screen.getByRole('button', { name: '引用文档' }));
  const info = await screen.findByRole('button', { name: '预览 船夫笔记' }); stillPlaying();
  fireEvent.click(info);
  expect(await screen.findByText('笔记的完整正文')).toBeTruthy(); stillPlaying();
  fireEvent.click(screen.getByRole('button', { name: '关闭文档预览' }));
  fireEvent.click(screen.getByRole('button', { name: '船夫笔记' }));
  // Selecting a document restores the native caret on the next animation frame.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '行动输入' })));
  fireEvent.click(screen.getByRole('link', { name: '船夫笔记' }));
  expect(screen.getByRole('dialog', { name: '文档预览' })).toBeTruthy();
  expect(await screen.findByText('笔记的完整正文')).toBeTruthy(); stillPlaying();
  fireEvent.click(screen.getByRole('button', { name: '关闭文档预览' })); stillPlaying();
  expect(useGameStore.getState().history).toHaveLength(0);
});
