// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import * as documentRepository from '@/lib/game/documents/repository';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
beforeEach(() => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel();
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), phase: 'playing',
    currentSceneId: snapshot.currentSceneId, currentScene: null, savedSegments: [], savedIsShowingSegments: false, currentNode: null, allNodes: {},
    midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, aliceApiKey: '' });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it.each([false, true])('does not publish documents when stopped during artifact storage, streaming=%s', async streaming => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming)); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = documentRepository.saveDocument;
  const writing = vi.spyOn(documentRepository, 'saveDocument').mockImplementation(async (s, input) => { await gate; return original(s, input); });
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const data = { segments: [{ type: 'narration', text: '你准备把报告留在桌上。' }], documents: [{ key: 'report', title: '取消的产物', format: 'text', content: '取消后不能发布的全文' }], timeSpent: { day: 0, hour: 0, minute: 1 }, availableActions: [] };
    return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '生成报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(writing).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' })); release();
  await waitFor(() => expect(vi.mocked(writing).mock.settledResults).toHaveLength(1));
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(await loadDocuments(scope)).toEqual([]);
  expect(screen.queryByRole('button', { name: '重试文档保存' })).toBeNull();
});

it('preserves plugin changes made while local document preparation is awaiting storage', async () => {
  const { parsePluginFile } = await import('@/lib/game/plugins/manifest');
  const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'background', name: '后台资料', description: '可保存的资料', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>资料</p>', reading: 'inherit' } });
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, gameplayPlugins: plugin }, gameplayModState: { background: { preserved: '原值' } } });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = documentRepository.saveDocument;
  const writing = vi.spyOn(documentRepository, 'saveDocument').mockImplementation(async (s, input) => { await gate; return original(s, input); });
  vi.stubGlobal('fetch', vi.fn(async url => !String(url).includes('/api/game/action') ? Response.json({}) : Response.json({ segments: [{ type: 'narration', text: '你把报告留在桌上。' }], documents: [{ key: 'report', title: '报告', format: 'text', content: '全文' }], timeSpent: { day: 0, hour: 0, minute: 1 }, availableActions: [] })));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '生成报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(writing).toHaveBeenCalledTimes(1));
  act(() => { useGameStore.setState({ gameplayModState: { ...useGameStore.getState().gameplayModState, background: { preserved: '后台已保存' } } }); release(); });
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  expect(useGameStore.getState().gameplayModState.background).toEqual({ preserved: '后台已保存' });
});
