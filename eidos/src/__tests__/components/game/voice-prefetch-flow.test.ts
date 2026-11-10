// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';
import { useMomoiPrefetch } from '@/lib/game/momoi/use-momoi-prefetch';
import type { StorySegment } from '@/lib/ai/types';

const { playback } = vi.hoisted(() => ({ playback: vi.fn(() => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} })) }));
vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: playback }));
vi.mock('@/lib/game/momoi/service-status', async importOriginal => ({ ...await importOriginal<object>(), useVoiceServiceMonitor() {} }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
afterEach(() => { cleanup(); abortActiveStream(); useGameStore.setState({ voiceSession: useGameStore.getState().voiceSession + 1 }); vi.unstubAllGlobals(); localStorage.clear(); });

it('starts speech from closed SSE dialogue before done, then persists each final line once', async () => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear();
  saveSettings({ ...loadSettings(), aliceApiKey: 'test', keiApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false });
  localStorage.setItem('eidos_stream_mode', 'true');
  const { world, snapshot } = buildRiftCityStartState(), initial = useGameStore.getInitialState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: crypto.randomUUID(),
    currentNode: null, worldLine: null, allNodes: {}, history: [], availableActions: ['询问'],
    currentSceneId: snapshot.currentSceneId, currentScene: null, savedSegments: [], savedIsShowingSegments: false,
    voiceConfig: { ...DEFAULT_VOICE_CONFIG, referencePath: '/test-reference.wav' },
    momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 }, midoriSettings: { ...initial.midoriSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/game/action/stream')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.endsWith('/api/momoi/start')) return Response.json({ ok: true, status: 'already_running' });
    if (url.endsWith('/api/momoi/speak')) { calls.push(JSON.parse(String(init?.body)).text); return Response.json({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' }); }
    return Response.json({});
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '询问' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'Enter' });
  await waitFor(() => expect(stream).toBeDefined());
  const closed = { type: 'dialogue', speaker: '甲', text: '这是一句完整的台词。' };
  const send = (event: object) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  await act(async () => send({ type: 'segments', segments: [closed, { type: 'dialogue', speaker: '乙', text: '草稿尚未' }], lastIsDraft: true }));
  await waitFor(() => expect(calls).toEqual([closed.text]));
  expect(useGameStore.getState().isLoading).toBe(true);
  await act(async () => send({ type: 'segments', segments: [closed, { type: 'dialogue', speaker: '乙', text: '草稿尚未结束，仍在增长' }], lastIsDraft: true }));
  expect(calls).toEqual([closed.text]);
  const middle = ['第二句已经闭合。', '第三句也已经闭合。'].map(text => ({ type: 'dialogue' as const, speaker: '乙', text }));
  await act(async () => send({ type: 'segments', segments: [closed, ...middle, { type: 'dialogue', speaker: '乙', text: '末尾仍是草稿' }], lastIsDraft: true }));
  await waitFor(() => expect(calls).toEqual([closed.text, ...middle.map(segment => segment.text)]));
  expect(useGameStore.getState().isLoading).toBe(true);
  const final = { type: 'dialogue', speaker: '乙', text: '现在最后一句也完整了。' };
  await act(async () => { send({ type: 'done', segments: [closed, ...middle, final], validity: { isPossible: true }, availableActions: [], timeSpent: { day: 0, hour: 0, minute: 1 }, summary: '测试对话' }); stream.close(); });
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  await waitFor(() => expect(Object.keys(useGameStore.getState().voiceAssets)).toHaveLength(4));
  expect(calls).toEqual([closed.text, ...middle.map(segment => segment.text), final.text]);
  expect(Object.values(useGameStore.getState().voiceAssets).map(asset => asset.text)).not.toContain('草稿尚未');
});
it('discards late synthesis after leaving the archive and cancels its remaining waiters', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const initial = useGameStore.getInitialState(), { world } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, currentWorld: world, currentPlaythroughId: crypto.randomUUID(), voiceConfig: DEFAULT_VOICE_CONFIG,
    momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 } });
  let finish!: (value: Response) => void;
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/start')) return Response.json({ ok: true, status: 'already_running' });
    calls.push(JSON.parse(String(init?.body)).text);
    return new Promise<Response>(resolve => { finish = resolve; });
  });
  const segments: StorySegment[] = ['旧档案首句。', '旧档案次句。'].map(text => ({ type: 'dialogue', speaker: '甲', text }));
  renderHook(() => useMomoiPrefetch({ segments, index: 0, streaming: false, active: true }));
  await waitFor(() => expect(useGameStore.getState().voiceQueue).toHaveLength(2));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => useGameStore.setState({ currentPlaythroughId: 'different-archive', voiceAssets: {}, voiceAssetScope: null, momoiSettings: { enabled: false, autoPlay: false, volume: .8, speed: 1 } }));
  await act(async () => finish(Response.json({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' })));
  expect(calls).toEqual(['旧档案首句。']);
  expect(useGameStore.getState().voiceAssets).toEqual({});
  expect(useGameStore.getState().voiceQueue).toEqual([]);
  expect(useGameStore.getState().voiceError).toBeNull();
});
it.each(['stopped', 'error'])('discards unaccepted draft text without synthesizing it after the stream is %s', async outcome => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear();
  saveSettings({ ...loadSettings(), aliceApiKey: 'test', keiApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false });
  localStorage.setItem('eidos_stream_mode', 'true');
  const { world, snapshot } = buildRiftCityStartState(), initial = useGameStore.getInitialState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: crypto.randomUUID(),
    currentNode: null, worldLine: null, allNodes: {}, history: [], availableActions: ['询问'],
    currentSceneId: snapshot.currentSceneId, currentScene: null, savedSegments: [], savedIsShowingSegments: false,
    voiceConfig: { ...DEFAULT_VOICE_CONFIG, referencePath: '/test.wav' },
    momoiSettings: { enabled: true, autoPlay: false, volume: .8, speed: 1 }, midoriSettings: { ...initial.midoriSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const spoken: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/game/action/stream')) return new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    if (url.endsWith('/api/momoi/start')) return Response.json({ ok: true, status: 'already_running' });
    if (url.endsWith('/api/momoi/speak')) { spoken.push(JSON.parse(String(init?.body)).text); return Response.json({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' }); }
    return Response.json({});
  });
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '询问' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'Enter' });
  await waitFor(() => expect(stream).toBeDefined());
  const send = (event: object) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  await act(async () => send({ type: 'segments', segments: [{ type: 'dialogue', speaker: '甲', text: '尚未完成的草稿台词' }], lastIsDraft: true }));
  if (outcome === 'stopped') fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  else await act(async () => { send({ type: 'error', message: '测试中断' }); stream.close(); });
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(spoken).toEqual([]);
  expect(screen.queryByText('尚未完成的草稿台词')).toBeNull();
  expect(useGameStore.getState().history).toHaveLength(0);
  if (outcome === 'stopped') stream.close();
});
