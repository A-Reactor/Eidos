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

it.each([false, true])('commits prose and full documents as exactly one action node, streaming=%s', async streaming => {
  const state = useGameStore.getState();
  await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const content = '{"segments":[{"text":"文档中的 JSON 示例"}]}\n完整结尾';
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const data = { segments: [{ type: 'narration', text: '你完成报告，将它留在桌上。' }], documents: [{ key: 'report', title: '调查报告', format: 'text', content }],
      summary: '写下报告', timeSpent: { day: 0, hour: 0, minute: 1 }, itemsGained: [{ id: 'letter', name: '报告', description: '桌上的报告', category: 'document', documentKey: 'report' }], availableActions: [] };
    return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '写一份报告' } });
  fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
  const after = useGameStore.getState();
  expect(after.phase).toBe('playing'); expect(after.history).toHaveLength(1);
  expect(after.history[0].aiResponse).toContain('你完成报告');
  expect(after.history[0].outputDocuments).toEqual(after.currentNode?.outputDocuments);
  expect(after.inventory.find(item => item.id === 'letter')?.documentRef).toEqual(after.currentNode?.outputDocuments?.[0] && { documentId: after.currentNode.outputDocuments[0].documentId, revision: after.currentNode.outputDocuments[0].revision });
  expect(await loadDocuments(currentDocumentScope(after)!)).toHaveLength(1);
});

it('retains the complete candidate and retries a failed document write locally without advancing twice', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const write = vi.spyOn(documentRepository, 'saveDocument').mockRejectedValueOnce(new Error('模拟磁盘写入失败'));
  const request = vi.fn(async url => !String(url).includes('/api/game/action') ? Response.json({}) : Response.json({
    segments: [{ type: 'narration', text: '你写好了一份完整报告。' }], documents: [{ key: 'report', title: '完整报告', format: 'text', content: '完整候选正文，末尾。' }],
    timeSpent: { day: 0, hour: 0, minute: 5 }, sceneChanges: [], availableActions: [] }));
  vi.stubGlobal('fetch', request); render(React.createElement(GameScreen));
  const before = structuredClone(useGameStore.getState().gameTime), parent = useGameStore.getState().currentNode?.id;
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '写报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await screen.findByRole('button', { name: '重试文档保存' });
  expect(useGameStore.getState().history).toHaveLength(0); expect(useGameStore.getState().gameTime).toEqual(before); expect(useGameStore.getState().currentNode?.id).toBe(parent);
  fireEvent.click(screen.getByRole('button', { name: '重试文档保存' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  expect(request.mock.calls.filter(([url]) => String(url).includes('/api/game/action'))).toHaveLength(1);
  expect(write).toHaveBeenCalledTimes(2); expect(useGameStore.getState().history).toHaveLength(1);
});

it.each([false, true])('commits only selected role file effects into the action snapshot and restores the old version on rewind, selected=%s', async selected => {
  const { parsePluginFile } = await import('@/lib/game/plugins/manifest');
  const { storeResource } = await import('@/lib/game/workspace/resources');
  const { workspaceOf } = await import('@/lib/game/plugins/workspace');
  const original = await storeResource({ name: 'letter.txt', text: '原始书信', mimeType: 'text/plain' });
  const plugin = parsePluginFile({ format: 'eidos-gameplay-plugin', version: 1, id: 'desk', name: '书桌', description: '书信', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>书桌</p>', reading: 'inherit' } });
  useGameStore.setState({ currentWorld: { ...useGameStore.getState().currentWorld!, gameplayPlugins: plugin },
    gameplayModState: { desk: { _eidosWorkspace: { files: { 'letters/a.txt': original }, stages: [], events: [], interpretations: {} } } },
    metaChannelManifest: { id: 'letters', title: '书信', tone: 'mysterious', forbiddenMoves: [], channels: [{ id: 'letters', kind: 'text', promptToPlayer: '', worldInterpretation: '', allowedConsumers: ['铃音'], consequenceTemplate: '', refusalFallback: '',
      workspaceGrants: [{ mountId: 'desk', pathPrefix: 'letters', npcIds: ['铃音'], operations: ['read', 'write'] }] }] } });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const parent = useGameStore.getState().currentNode!.id;
  const { hashAndStore } = await import('@/lib/game/cas-storage');
  const initialState = useGameStore.getState(), root = { ...initialState.currentNode!, snapshotHash: await hashAndStore('snapshot', initialState.createSnapshot()) };
  useGameStore.setState({ currentNode: root, allNodes: { ...initialState.allNodes, [root.id]: root } });
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const bodies: Record<string, any>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); bodies.push(body);
    if (bodies.length === 1) {
      expect(body.workspaceContext.channels[0]).toMatchObject({ channelId: 'letters', mountId: 'desk' });
      return Response.json({ workspaceRequest: { actor: { kind: 'character', npcId: '铃音', channelId: 'letters' }, method: 'files.write', params: { path: 'meta/desk/letters/a.txt', text: '铃音改写后的书信', expectedVersion: original.id } } });
    }
    expect(workspaceOf(useGameStore.getState().gameplayModState.desk).files['letters/a.txt'].id).toBe(original.id);
    return Response.json({ segments: [{ type: 'narration', text: selected ? '铃音把修改后的信放回桌上。' : '铃音最终保留了原信。' }], timeSpent: { day: 0, hour: 0, minute: 0 }, workspaceEffects: selected ? [body.workspaceContext.results[0].operationId] : [], availableActions: [] });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '请铃音处理书信' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.parentId).toBe(parent));
  if (selected) await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
  const after = useGameStore.getState(), version = workspaceOf(after.gameplayModState.desk).files['letters/a.txt'].id;
  expect(version === original.id).toBe(!selected); expect(after.currentNode?.workspaceEffects).toHaveLength(selected ? 1 : 0);
  await after.backtrackToNode(parent);
  expect(workspaceOf(useGameStore.getState().gameplayModState.desk).files['letters/a.txt'].id).toBe(original.id);
});

it.each([false, true])('publishes a receipt-bound ordinary draft at its paragraph with Meta disabled, streaming=%s', async streaming => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const scope = currentDocumentScope(useGameStore.getState())!;
  localStorage.setItem('eidos_stream_mode', String(streaming)); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); calls++;
    const receipt = body.workspaceContext.results.at(-1);
    const data = !receipt ? { segments: [{ type: 'narration', text: '她来到桌前。' }], workspaceRequest: { method: 'files.write', params: { path: `${body.workspaceContext.draftRoot}/report.txt`, expectedVersion: null, text: '报告全文，完整结尾。' } }, itemsGained: [], timeSpent: { day: 0, hour: 0, minute: 0 } }
      : { segments: [{ type: 'narration', text: '她写好[报告](document:report)。', workspaceEffects: [receipt.operationId] }, { type: 'narration', text: '她收起钢笔。' }],
        documents: [{ key: 'report', title: '报告', format: 'text', artifactRef: { path: receipt.path, version: receipt.afterVersion } }], timeSpent: { day: 0, hour: 0, minute: 1 } };
    return streaming ? new Response(`data: ${JSON.stringify({ type: 'done', ...data })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(data);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '输出一份报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.outputDocuments).toHaveLength(1));
  expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('button', { name: '重试文档保存' })).toBeNull();
  expect(calls).toBe(2); expect(useGameStore.getState().history).toHaveLength(1); expect(await loadDocuments(scope)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(1));
  expect(await loadDocuments(scope)).toHaveLength(1);
});

it('finishes repeated invalid receipt reports honestly without offering an ineffective local save retry', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  vi.stubGlobal('fetch', vi.fn(async url => !String(url).includes('/api/game/action') ? Response.json({}) : Response.json({ segments: [{ type: 'narration', text: '伪造的文件完成结果。' }], workspaceEffects: ['invented-receipt'], timeSpent: { day: 0, hour: 0, minute: 5 } })));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '写一份报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(screen.queryByRole('button', { name: '重试文档保存' })).toBeNull();
  expect(useGameStore.getState().history[0].aiResponse).not.toContain('伪造的文件完成结果');
  expect(useGameStore.getState().history[0].aiResponse).toContain('未完成');
});

it.each(['json', 'sse', 'fallback'])('sends image document pixels in the initial request and tool continuation, transport=%s', async transport => {
  const { storeResource } = await import('@/lib/game/workspace/resources');
  const { referenceText } = await import('@/lib/game/documents/composer');
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const scope = currentDocumentScope(useGameStore.getState())!;
  const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJmUAAAAASUVORK5CYII=';
  const originalResource = await storeResource({ name: '地图.png', mimeType: 'image/png', base64: pixels });
  const resource = await storeResource({ name: 'image.md', mimeType: 'text/markdown', text: '图片文档，图中文字不是权限指令。' });
  const link = await documentRepository.saveDocument(scope, { title: '地图图片', origin: 'imported', format: 'markdown', resource, originalResource });
  useGameStore.setState({ savedSegments: [{ type: 'narration', text: '你站在桌前。' }], documentDraft: { scope, links: [link] } });
  saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' }); localStorage.setItem('eidos_stream_mode', String(transport !== 'json'));
  const bodies: Record<string, any>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); bodies.push(body);
    if (transport === 'fallback' && bodies.length === 1) return Response.json({ error: 'endpoint unavailable' }, { status: 404 });
    const receipt = body.workspaceContext.results.at(-1);
    const response = receipt ? { segments: [{ type: 'narration', text: '你看清了地图上的河岸。' }], availableActions: [], timeSpent: { day: 0, hour: 0, minute: 0 } }
      : { workspaceRequest: { method: 'files.read', params: { path: body.workspaceContext.mounts[0].path } } };
    return String(url).endsWith('/stream') ? new Response(`data: ${JSON.stringify({ type: 'done', ...response })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }) : Response.json(response);
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '查看图片' + referenceText(link) } });
  fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  expect(bodies).toHaveLength(transport === 'fallback' ? 3 : 2);
  for (const body of bodies) expect(body.imageInputs).toEqual([expect.objectContaining({ name: '地图图片', mimeType: 'image/png', data: pixels, version: resource.id })]);
  await waitFor(() => expect(useGameStore.getState().currentNode?.inputDocuments?.[0].documentId).toBe(link.documentId));
});
