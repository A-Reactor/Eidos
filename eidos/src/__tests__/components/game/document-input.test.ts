// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
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
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it('stores dropped documents without submitting an action or adding boundary/personality events', async () => {
  render(React.createElement(GameScreen));
  const input = screen.getByRole('textbox', { name: '行动输入' });
  fireEvent.change(input, { target: { value: '保留我的行动草稿' } });
  const state = useGameStore.getState(), before = { realityArtifacts: structuredClone(state.realityArtifacts), boundaryEvents: structuredClone(state.boundaryEvents) };
  const s = currentDocumentScope(state)!;
  fireEvent.drop(input, { dataTransfer: { files: [new File(['文档末尾'], '证据.txt')] } });
  await screen.findByRole('button', { name: '证据.txt' });
  expect((input as HTMLTextAreaElement).value).toBe('保留我的行动草稿');
  expect(await loadDocuments(s)).toHaveLength(1);
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(useGameStore.getState().realityArtifacts).toEqual(before.realityArtifacts);
  expect(useGameStore.getState().boundaryEvents).toEqual(before.boundaryEvents);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/api/game/action'))).toBe(false);
});

it('inserts and deletes inline references without automatically submitting', async () => {
  render(React.createElement(GameScreen));
  const input = screen.getByRole('textbox', { name: '行动输入' });
  fireEvent.drop(input, { dataTransfer: { files: [new File(['内容'], '草稿.md')] } });
  fireEvent.click(await screen.findByRole('button', { name: '草稿.md' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '引用文档' })).toBeNull());
  expect((input as HTMLTextAreaElement).value).toBe('草稿.md');
  expect(screen.getByRole('link', { name: '草稿.md' })).toBeTruthy();
  expect(screen.queryByLabelText('本次行动引用')).toBeNull();
  fireEvent.change(input, { target: { value: '' } });
  expect(screen.queryByRole('link', { name: '草稿.md' })).toBeNull();
  expect(useGameStore.getState().history).toHaveLength(0);
});

it.each([false, true])('continues a file lookup through the real action screen with unchanged player text, streaming=%s', async streaming => {
  const state = useGameStore.getState();
  await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only', keiApiKey: '', autoAdvance: false, autoSelect: false, enableSpeculation: false });
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); sent.push(body);
    if (sent.length === 1) {
      const data = { workspaceRequest: { method: 'files.read', params: { path: body.workspaceContext.mounts[0].path } }, segments: [] };
      return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
    }
    return Response.json({ segments: [{ type: 'narration', text: '你核对了资料中的签名。' }], summary: '核对资料签名', timeSpent: { day: 0, hour: 0, minute: 0 },
      availableActions: [], itemsGained: [], itemsUsed: [], sceneChanges: [], worldImpacts: [], npcsReacted: [], cluesDiscovered: [], discoveredSecrets: [] });
  }));
  render(React.createElement(GameScreen));
  const input = screen.getByRole('textbox', { name: '行动输入' });
  fireEvent.drop(input, { dataTransfer: { files: [new File(['签名原文，资料尾部。'], '原件.txt')] } });
  fireEvent.click(await screen.findByRole('button', { name: '原件.txt' }));
  fireEvent.change(input, { target: { value: '核对原件.txt' } });
  fireEvent.change(input, { target: { value: '核对原件.txt资料中的签名' } });
  fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  expect(sent).toHaveLength(2);
  expect(sent.map(body => body.playerInput)).toEqual([useGameStore.getState().history[0].playerInput, useGameStore.getState().history[0].playerInput]);
  expect(String(sent[0].playerInput)).toContain('](document://');
  expect(useGameStore.getState().history[0].inputDocuments).toHaveLength(1);
  expect(JSON.stringify(sent[0].workspaceContext)).not.toContain('签名原文');
  expect(JSON.stringify(sent[1].workspaceContext)).toContain('签名原文，资料尾部。');
  expect((useGameStore.getState().history[0].playerInput)).toContain('原件.txt');
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '另一行动草稿' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'ArrowUp', altKey: true });
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('核对原件.txt资料中的签名');
  expect(screen.getByRole('textbox', { name: '行动输入' }).parentElement?.querySelector('a')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('textbox', { name: '行动输入' }), { key: 'ArrowDown', altKey: true });
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('另一行动草稿');
  expect(screen.getByRole('textbox', { name: '行动输入' }).parentElement?.querySelector('a')).toBeNull();
});

it('closes the resource console when a library document is referenced back into the composer', async () => {
  const { saveLocalDocument } = await import('@/lib/game/documents/ingest');
  const { DocumentsScreen } = await import('@/components/game/DocumentsScreen');
  const scope = currentDocumentScope(useGameStore.getState())!;
  await saveLocalDocument(scope, { title: '待引用的草稿', content: '原稿' });
  function Shell() { const phase = useGameStore(s => s.phase); return React.createElement(React.Fragment, null, React.createElement(GameScreen), phase === 'documents' && React.createElement(DocumentsScreen)); }
  render(React.createElement(Shell));
  fireEvent.click(screen.getByRole('button', { name: '打开资源与服务' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开文档管理' }));
  fireEvent.click(await screen.findByRole('button', { name: /待引用的草稿/ }));
  fireEvent.click(await screen.findByRole('button', { name: '引用到行动' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: '资源与服务' })).toBeNull());
  expect(screen.getByRole('link', { name: '待引用的草稿' })).toBeTruthy();
});
