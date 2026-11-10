// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { abortActiveStream, hasActiveStream } from '@/lib/game/stream-lifecycle';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { speculativeEngine } from '@/lib/ai/speculation';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
const initial = useGameStore.getInitialState();
const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
function submit(text = '询问守卫') {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
}
async function send(event: Record<string, unknown>, index = streams.length - 1) {
  await act(async () => { streams[index].enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); });
}
beforeEach(async () => {
  streams.length = 0;
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  vi.stubGlobal('crypto', webcrypto);
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false,
    enableContentReview: false, aliceApiKey: '', keiApiKey: '' });
  localStorage.setItem('eidos_stream_mode', 'true');
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: crypto.randomUUID(),
    currentScene: null, currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime,
    sceneNarrative: '原有场景', history: [], availableActions: ['观察'], savedSegments: [], savedIsShowingSegments: false,
    worldLine: null, currentNode: null, allNodes: {},
    midoriSettings: { ...initial.midoriSettings, enabled: false }, momoiSettings: { ...initial.momoiSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  // This network boundary deliberately permits late chunks after abort to test request scoping.
  vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/api/game/action/stream')
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.push(controller); } }))
    : new Response('{}')));
});
afterEach(() => {
  cleanup(); abortActiveStream(); speculativeEngine.cancel();
  for (const stream of streams) { try { stream.close(); } catch {} }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
it('shows thinking then generating without showing private thought text', async () => {
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(streams).toHaveLength(1));
  await send({ type: 'activity', phase: 'thinking', reasoningChars: 99, elapsedMs: 100 });
  expect(screen.getByRole('status', { name: '生成状态' }).textContent).toContain('ALICE陷入了思考');
  await send({ type: 'activity', phase: 'generating', reasoningChars: 99, elapsedMs: 200 });
  expect(screen.getByRole('status', { name: '生成状态' }).textContent).toContain('ALICE正在讲故事');
});
it('shows an explicit quota failure, restores input, charges once and leaves world state untouched', async () => {
  const before = useGameStore.getState().createSnapshot();
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(streams).toHaveLength(1));
  await send({ type: 'usage', usage: { model: 'alice', promptTokens: 10, completionTokens: 8000, totalTokens: 8010,
    reasoningTokens: 8000, outputChars: 0, finishReason: 'length', errorCode: 'output_limit', success: false,
    callType: 'alice_stream', elapsedMs: 40 } });
  await send({ type: 'error', code: 'output_limit', message: '模型已用尽本次生成额度，尚未返回正文。' });
  expect(screen.getByRole('alert').textContent).toContain('已用尽本次生成额度');
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('询问守卫');
  const state = useGameStore.getState();
  expect(state.gameTime).toEqual(before.currentGameTime);
  expect(state.inventory).toEqual(before.inventory);
  expect(state.history).toHaveLength(0);
  expect(state.tokensUsed).toBe(8010);
  expect(state.aiCalls).toHaveLength(1);
  expect(state.isLoading).toBe(false);
});
it('does not automatically resend a failed initial action', async () => {
  useGameStore.setState({ availableActions: [] });
  render(React.createElement(GameScreen));
  await waitFor(() => expect(streams).toHaveLength(1));
  await send({ type: 'error', code: 'output_limit', message: '额度已耗尽，请重试。' });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(streams).toHaveLength(1);
  expect(screen.getByRole('alert').textContent).toContain('额度已耗尽');
});

it.each([true, false])('does not start a new initial observation over restored prose without suggestions, playing=%s', async playing => {
  const segments = [{ type: 'narration' as const, text: '已经生成的开场正文。' }];
  useGameStore.setState({ availableActions: [], savedSegments: segments, savedIsShowingSegments: playing });
  const nodeId = useGameStore.getState().currentNode?.id;
  vi.useFakeTimers();
  try {
    render(React.createElement(GameScreen));
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/game/action'))).toBe(false);
    expect(useGameStore.getState().isLoading).toBe(false);
    expect(useGameStore.getState().savedSegments).toEqual(segments);
    expect(useGameStore.getState().currentNode?.id).toBe(nodeId);
  } finally { cleanup(); vi.useRealTimers(); }
});
it('shows the server failure in ordinary mode without replacing the scene or committing an action', async () => {
  localStorage.setItem('eidos_stream_mode', 'false');
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: '模型没有返回正文，请重试。', code: 'empty_output',
    _tokenUsage: { model: 'alice', promptTokens: 10, completionTokens: 8000, totalTokens: 8010, success: false,
      callType: 'alice_action', elapsedMs: 40, errorCode: 'empty_output' } })));
  render(React.createElement(GameScreen)); submit();
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('模型没有返回正文');
  expect(useGameStore.getState().sceneNarrative).toBe('原有场景');
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(useGameStore.getState().tokensUsed).toBe(8010);
  expect(useGameStore.getState().aiCalls).toHaveLength(1);
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('询问守卫');
});
it.each([false, true])('does not restart the initial generation after Stop and remount=%s, but permits a new explicit action', async remount => {
  useGameStore.setState({ availableActions: [] });
  const view = render(React.createElement(GameScreen));
  await waitFor(() => expect(streams).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  if (remount) { view.unmount(); render(React.createElement(GameScreen)); }
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(streams).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
  submit('检查门锁');
  await waitFor(() => expect(streams).toHaveLength(2));
});
it('does not start automatic initialization after stopping a manually submitted first action', async () => {
  useGameStore.setState({ availableActions: [] });
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(streams).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  expect(streams).toHaveLength(1);
});
it('ignores old request activity and failure after another action replaces it', async () => {
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(streams).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  submit('检查门锁');
  await waitFor(() => expect(streams).toHaveLength(2));
  await send({ type: 'activity', phase: 'generating', elapsedMs: 1, reasoningChars: 0 }, 1);
  await send({ type: 'activity', phase: 'thinking', elapsedMs: 100, reasoningChars: 99 }, 0);
  await send({ type: 'error', message: '过期错误' }, 0);
  expect(screen.getByRole('status', { name: '生成状态' }).textContent).toContain('ALICE正在讲故事');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(useGameStore.getState().isLoading).toBe(true);
  expect(hasActiveStream()).toBe(true);
});
it('stopping a request clears status without an error or state commit', async () => {
  render(React.createElement(GameScreen)); submit();
  await waitFor(() => expect(streams).toHaveLength(1));
  await send({ type: 'activity', phase: 'thinking', elapsedMs: 1, reasoningChars: 2 });
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  await send({ type: 'error', message: '晚到错误' });
  expect(screen.queryByRole('status', { name: '生成状态' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(useGameStore.getState().sceneNarrative).toBe('原有场景');
});
