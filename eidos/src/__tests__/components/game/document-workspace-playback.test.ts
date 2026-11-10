// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { loadDocuments } from '@/lib/game/documents/repository';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import type { WorkspacePromptContext } from '@/lib/game/workspace/context';
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.unstubAllGlobals(); });

it.each([{ sandbox: false, grant: false }, { sandbox: false, grant: true }, { sandbox: true, grant: false }])('honors write permission and playback merge, sandbox=$sandbox grant=$grant', async ({ sandbox, grant }) => {
  useGameStore.setState({ sandboxMode: sandbox, sandboxDossierId: sandbox ? '002' : null });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!;
  const { saveLocalDocument } = await import('@/lib/game/documents/ingest');
  const doc = await saveLocalDocument(scope, { title: '未引用的旧稿', content: '原始正文', format: 'text' });
  if (grant) useGameStore.setState({ documentDraft: { scope, links: [{ ...doc, allowWrite: true }] } });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)), last = body.workspaceContext.results.at(-1);
    if (!last) {
      const file = body.workspaceContext.mounts.find((entry: { path: string }) => entry.path.startsWith('library/'));
      return Response.json({ workspaceRequest: { method: 'files.write', params: { path: file.path, text: '完整的修改正文', expectedVersion: file.version } } });
    }
    return Response.json({ segments: [{ type: 'narration', text: '她打开书桌。' }, { type: 'narration', text: `她完成了[旧稿](document:${doc.documentId})。`, workspaceEffects: last.operationId ? [last.operationId] : [] }, { type: 'narration', text: '她继续整理书架。' }], workspaceEffects: last.operationId ? [last.operationId] : [], timeSpent: { day: 0, hour: 0, minute: 1 }, availableActions: [] });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: grant ? '修改未引用的旧稿' : '修改资料库里的旧稿' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  if (!sandbox && !grant) {
    await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
    expect(useGameStore.getState().history).toHaveLength(1);
    expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
    expect(screen.queryByText('她完成了旧稿。')).toBeNull();
    return;
  }
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
  expect((await loadDocuments(scope))[0].currentRevision).toBe(doc.revision);
  expect(screen.queryByRole('link', { name: '旧稿' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(1));
  expect((await loadDocuments(scope))[0].currentRevision).not.toBe(doc.revision);
  // The merge updates storage before playSegment finishes awaiting persistence.
  await waitFor(() => expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step'));
  // The record is stable while the stage is still typing; both use the same document preview.
  fireEvent.click(within(screen.getByRole('region', { name: '行动记录' })).getByRole('link', { name: '旧稿' }));
  expect(await screen.findByText('完整的修改正文')).toBeTruthy();
  vi.useFakeTimers();
  act(() => saveSettings({ ...loadSettings(), autoAdvance: true, autoAdvanceDelay: 500 }));
  // One full advance interval verifies the pause without running unrelated timer cycles.
  act(() => { vi.advanceTimersByTime(600); });
  expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step');
  expect(screen.queryByText('她继续整理书架。')).toBeNull();
  vi.useRealTimers();
});

it('previews a recommendation without submitting, then passes its reference and honors explicit rename permission', async () => {
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!;
  const { saveLocalDocument } = await import('@/lib/game/documents/ingest');
  const { referenceText } = await import('@/lib/game/documents/composer');
  const doc = await saveLocalDocument(scope, { title: '引用测试备忘.txt', content: '签名原文', format: 'text' });
  const action = `将${referenceText(doc)}更名为清单.txt`;
  const currentNode = { ...useGameStore.getState().currentNode!, availableActions: [action] };
  useGameStore.setState({ availableActions: [action], currentNode, allNodes: { [currentNode.id]: currentNode } });
  const requests: Array<{ workspaceContext: WorkspacePromptContext }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    const body = JSON.parse(String(options?.body)); requests.push(body);
    const last = body.workspaceContext.results.at(-1);
    if (!last) {
      const file = body.workspaceContext.mounts.find((entry: { path: string }) => entry.path.startsWith('library/'));
      return Response.json({ workspaceRequest: { method: 'files.rename', params: { path: file.path, expectedVersion: file.version, newName: '清单.txt' } } });
    }
    if (last.status === 'denied') return Response.json({ fileOutcome: 'failed', segments: [{ type: 'narration', text: '未获得更名授权。' }] });
    return Response.json({ segments: [{ type: 'narration', text: `已将[清单](document:${doc.documentId})放回桌面。`, workspaceEffects: [last.operationId] }], timeSpent: { day: 0, hour: 0, minute: 0 }, availableActions: [`核对[清单](document:${doc.documentId})`] });
  }));
  render(React.createElement(GameScreen));
  const recommendations = screen.getByLabelText('推荐行动');
  expect(recommendations.textContent).not.toContain('document:');
  fireEvent.click(within(recommendations).getByRole('link', { name: '引用测试备忘.txt' }));
  expect(await screen.findByText('签名原文')).toBeTruthy(); expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '关闭文档预览' }));
  fireEvent.click(within(recommendations).getByRole('button', { name: '将引用测试备忘.txt更名为清单.txt' }));
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(requests[0].workspaceContext.mounts).toContainEqual(expect.objectContaining({ selected: true, writable: false }));
  expect(useGameStore.getState().history).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '引用文档' }));
  fireEvent.click(await screen.findByRole('button', { name: '允许本次修改 引用测试备忘.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '引用测试备忘.txt' }));
  fireEvent.click(screen.getByRole('button', { name: /^(发送行动|中断并发送)$/ }));
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(2));
  await waitFor(async () => expect((await loadDocuments(scope))[0].title).toBe('清单.txt'));
  expect(useGameStore.getState().availableActions[0]).toContain('](document://');
  expect(requests[2].workspaceContext.mounts).toContainEqual(expect.objectContaining({ selected: true, writable: true }));
});

it('resolves a playback conflict through the real UI without regenerating the action', async () => {
  useGameStore.setState({ sandboxMode: true, sandboxDossierId: '002' });
  const state = useGameStore.getState(); await state.initWorldLine(state.currentPlaythroughId!, state.currentWorld!.id);
  localStorage.setItem('eidos_stream_mode', 'false'); saveSettings({ ...loadSettings(), aliceApiKey: 'offline-only' });
  const scope = currentDocumentScope(useGameStore.getState())!;
  const { saveLocalDocument } = await import('@/lib/game/documents/ingest');
  const doc = await saveLocalDocument(scope, { title: '报告.txt', content: '基础正文', format: 'text' });
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    if (!String(url).includes('/api/game/action')) return Response.json({});
    calls++; const body = JSON.parse(String(options?.body)), last = body.workspaceContext.results.at(-1);
    if (!last) return Response.json({ workspaceRequest: { method: 'files.write', params: { path: `library/${doc.documentId}/source.txt`, text: '模型的候选正文', expectedVersion: doc.revision } } });
    await saveLocalDocument(scope, { title: '玩家报告.txt', content: '玩家的当前正文', previous: doc, format: 'text' });
    return Response.json({ segments: [{ type: 'narration', text: '拿起资料。' }, { type: 'narration', text: `收好[报告](document:${doc.documentId})。`, workspaceEffects: [last.operationId] }], workspaceEffects: [last.operationId], timeSpent: { day: 0, hour: 0, minute: 1 }, availableActions: [] });
  }));
  render(React.createElement(GameScreen));
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '核对报告' } }); fireEvent.click(screen.getByRole('button', { name: '发送行动' }));
  await waitFor(() => expect(useGameStore.getState().currentNode?.workspaceBranch?.mergedThrough).toBe(0));
  fireEvent.click(screen.getByRole('button', { name: '播放第 2 段' }));
  await screen.findByRole('button', { name: '处理文件冲突' });
  expect(screen.getByRole('status', { name: '文件合并状态' }).textContent).toContain('合并受阻');
  fireEvent.click(screen.getByRole('button', { name: '处理文件冲突' }));
  await screen.findByText('模型的候选正文', { exact: false });
  fireEvent.click(screen.getByRole('button', { name: '编辑合并结果' }));
  fireEvent.change(screen.getByRole('textbox', { name: '合并后名称' }), { target: { value: '共同报告.txt' } });
  fireEvent.change(screen.getByRole('textbox', { name: '合并后正文' }), { target: { value: '保留玩家内容。\n也保留模型内容。' } });
  fireEvent.click(screen.getByRole('button', { name: '保存合并并重试' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '处理文件冲突' })).toBeNull());
  await waitFor(async () => expect((await loadDocuments(scope))[0].title).toBe('共同报告.txt'));
  expect(useGameStore.getState().history).toHaveLength(1); expect(calls).toBe(2);
  expect(screen.getByText('+2 -1', { exact: true })).toBeTruthy();
  expect(useGameStore.getState().currentNode?.workspaceBranch?.resolutions).toHaveLength(1);
});
