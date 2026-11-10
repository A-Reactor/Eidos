// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { saveLocalDocument } from '@/lib/game/documents/ingest';
import { loadDocuments, stageDocumentRevision } from '@/lib/game/documents/repository';
import { storeResource } from '@/lib/game/workspace/resources';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { speculativeEngine } from '@/lib/ai/speculation';
const panelProbe = vi.hoisted(() => ({ draftIndex: undefined as number | undefined }));
vi.mock('@/components/game/ActionRecordPanel', async original => {
  const actual = await original<typeof import('@/components/game/ActionRecordPanel')>();
  return { ...actual, ActionRecordPanel: (props: React.ComponentProps<typeof actual.ActionRecordPanel>) => {
    panelProbe.draftIndex = props.draftIndex;
    return React.createElement(actual.ActionRecordPanel, props);
  } };
});
vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));
const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
const streamResponse = (value: unknown) => new Response(encode(value), { headers: { 'Content-Type': 'text/event-stream' } });
beforeEach(() => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel(); panelProbe.draftIndex = undefined;
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: world, currentPlaythroughId: crypto.randomUUID(), phase: 'playing', currentSceneId: snapshot.currentSceneId,
    sandboxMode: true, sandboxDossierId: '002', midoriSettings: { ...useGameStore.getState().midoriSettings, enabled: false }, momoiSettings: { ...useGameStore.getState().momoiSettings, enabled: false } });
  localStorage.setItem('eidos_stream_mode', 'true'); saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, aliceApiKey: 'offline-only', keiApiKey: '' });
});
afterEach(() => { cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });
it('keeps ordinary narration around hidden file calls, then merges at its result paragraph once', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const scope = currentDocumentScope(useGameStore.getState())!, doc = await saveLocalDocument(scope, { title: '旧稿', content: '原始正文', format: 'text' });
  const path = `library/${doc.documentId}/source.txt`, opening = '门外传来脚步声。', middle = '她认出了纸上的字迹。';
  let releaseRead!: (response: Response) => void, terminal!: ReadableStreamDefaultController<Uint8Array>, operation = '';
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    requests.push(String(url)); const body = JSON.parse(String(options?.body));
    if (requests.length === 1) {
      useGameStore.setState({ worldFlags: { ...useGameStore.getState().worldFlags, lateContextFlag: true } });
      return new Response(new ReadableStream({ start(c) {
      c.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: opening }], lastIsDraft: false }));
      c.enqueue(encode({ type: 'done', workspaceRequest: { method: 'files.read', params: { path } } })); c.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    expect(body.snapshot.worldFlags.lateContextFlag).toBeUndefined();
    if (requests.length === 2) return new Promise<Response>(resolve => { releaseRead = resolve; });
    operation = body.workspaceContext.results.at(-1).operationId;
    return new Response(new ReadableStream({ start(c) { terminal = c; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '修改旧稿' } }); fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await waitFor(() => expect(releaseRead).toBeTypeOf('function'));
  expect(await screen.findByText(opening)).toBeTruthy(); expect(useGameStore.getState().history).toHaveLength(0);
  await act(async () => releaseRead(new Response(new ReadableStream({ start(c) {
    c.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: middle }], lastIsDraft: false }));
    c.enqueue(encode({ type: 'done', workspaceRequest: { method: 'files.patch', params: { path, expectedVersion: doc.revision, oldText: '原始', newText: '修改' } } })); c.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } })));
  await waitFor(() => expect(terminal).toBeTruthy());
  const tail = [{ type: 'narration', text: `她收好[旧稿](document:${doc.documentId})。`, workspaceEffects: [operation] }];
  await act(async () => terminal.enqueue(encode({ type: 'segments', segments: tail, lastIsDraft: false })));
  expect(screen.queryByText('她收好')).toBeNull(); expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
  await act(async () => { terminal.enqueue(encode({ type: 'done', summary: '改稿', workspaceEffects: [operation], availableActions: ['继续'], timeSpent: { day: 0, hour: 0, minute: 1 } })); terminal.close(); });
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
  expect(useGameStore.getState().history[0].aiResponse).toContain(opening);
  expect(useGameStore.getState().history[0].aiResponse).toContain(middle);
  expect(useGameStore.getState().history[0].aiResponse.split(opening)).toHaveLength(2);
  expect(useGameStore.getState().history[0].aiResponse.split(middle)).toHaveLength(2);
  expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
  expect(requests).toEqual(Array(3).fill('/api/game/action/stream'));
  fireEvent.click(screen.getByRole('button', { name: '播放第 3 段' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(2));
  expect((await loadDocuments(scope))[0].currentRevision).not.toBe(doc.revision);
  expect(useGameStore.getState().history).toHaveLength(1);
});

it('streams read-only follow-up prose before completion and preserves the reading cursor on acceptance', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  let terminal!: ReadableStreamDefaultController<Uint8Array>; let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    if (++calls === 1) return streamResponse({ type: 'done', segments: [{ type: 'narration', text: '她抬头看向门口。' }], workspaceRequest: { method: 'files.list', params: {} } });
    return new Response(new ReadableStream({ start(c) { terminal = c; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '检查文档目录' } }); fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await waitFor(() => expect(terminal).toBeTruthy());
  await act(async () => terminal.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '目录的最后一项留着空白。' }], lastIsDraft: true })));
  expect(screen.getByRole('button', { name: '播放第 2 段' })).toBeTruthy();
  expect(useGameStore.getState().history).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  const usage = { model: 'alice', promptTokens: 11, completionTokens: 7, totalTokens: 18, elapsedMs: 20 };
  await act(async () => { terminal.enqueue(encode({ type: 'usage', usage })); terminal.enqueue(encode({ type: 'done', _tokenUsage: usage, summary: '核对目录', availableActions: ['继续'], timeSpent: { day: 0, hour: 0, minute: 0 } })); terminal.close(); });
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step');
  expect(useGameStore.getState().history[0].aiResponse).toContain('她抬头看向门口。');
  expect(useGameStore.getState().tokensUsed).toBe(18);
  expect(panelProbe.draftIndex).toBeUndefined();
});
it('restores prior reading when the player stops narration interrupted by hidden file work', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  useGameStore.setState({ savedSegments: [{ type: 'narration', text: '原有段落。' }], savedIsShowingSegments: true, savedSegmentIndex: 0 });
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    if (++calls === 1) return streamResponse({ type: 'done', segments: [{ type: 'narration', text: '她暂时摊开纸张。' }], workspaceRequest: { method: 'files.list', params: {} } });
    return new Response(new ReadableStream({ start(c) { c.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '未完成的续写。' }], lastIsDraft: true })); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '核对文件' } }); fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await screen.findByText('她暂时摊开纸张。');
  await waitFor(() => expect(panelProbe.draftIndex).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  await waitFor(() => expect(screen.queryByText('她暂时摊开纸张。')).toBeNull());
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(panelProbe.draftIndex).toBeUndefined();
  expect(useGameStore.getState().savedSegments.some(segment => segment.text.includes('暂时摊开'))).toBe(false);
});
it('rejects false file reports after a denied write while retaining the earlier ordinary prose', async () => {
  useGameStore.setState({ sandboxMode: false });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const scope = currentDocumentScope(useGameStore.getState())!, doc = await saveLocalDocument(scope, { title: '只读稿', content: '原文', format: 'text' }); let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    if (++calls === 1) return streamResponse({ type: 'done', segments: [{ type: 'narration', text: '她把笔放在一边。' }], workspaceRequest: { method: 'files.write', params: { path: `library/${doc.documentId}/source.txt`, expectedVersion: doc.revision, text: '新稿' } } });
    return new Response(new ReadableStream({ start(c) { c.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '文件已经修改完毕。' }], lastIsDraft: false })); c.enqueue(encode({ type: 'done', summary: '假完成', timeSpent: { day: 0, hour: 0, minute: 0 } })); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '修改只读稿' } }); fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(screen.queryByText('文件已经修改完毕。')).toBeNull();
  expect(useGameStore.getState().history[0].aiResponse).toContain('她把笔放在一边。');
  expect(useGameStore.getState().history).toHaveLength(1); expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
});

it('keeps streamed narration separate from the parent file branch and restores parent playback when stopped', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  const scope = currentDocumentScope(useGameStore.getState())!, doc = await saveLocalDocument(scope, { title: '旧节点的文件', content: '当前正文', format: 'text' });
  const resource = await storeResource({ name: 'later.txt', mimeType: 'text/plain', text: '旧节点未播放的修改' });
  const link = await stageDocumentRevision(scope, { documentId: doc.documentId, revision: doc.revision }, resource);
  const root = useGameStore.getState().currentNode!;
  const parent = { ...root, workspaceBranch: { id: 'unplayed-parent', scope, baseNodeId: root.parentId,
    documents: [{ link, resource, beforeRevision: doc.revision, segmentIndex: 1 }], effects: [], outputs: [], mergedThrough: 0 } };
  useGameStore.setState({ currentNode: parent, allNodes: { ...useGameStore.getState().allNodes, [parent.id]: parent },
    savedSegments: [{ type: 'narration', text: '旧节点第一段。' }, { type: 'narration', text: '旧节点未播放段。' }], savedSegmentIndex: 0, savedIsShowingSegments: true });
  let initial!: ReadableStreamDefaultController<Uint8Array>, calls = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const first = ++calls === 1;
    return new Response(new ReadableStream({ start(c) { if (first) initial = c; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '转身观察门口' } }); fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await waitFor(() => expect(initial).toBeTruthy());
  await act(async () => initial.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '门锁轻轻响了一下。' }, { type: 'narration', text: '走廊里亮起一盏灯。' }], lastIsDraft: false })));
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step'));
  expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0);
  expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
  await act(async () => { initial.enqueue(encode({ type: 'done', workspaceRequest: { method: 'files.list', params: {} } })); initial.close(); });
  await waitFor(() => expect(calls).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  expect(useGameStore.getState().history).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(1));
  expect((await loadDocuments(scope))[0].currentRevision).toBe(link.revision);
});
