// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { hashAndStore } from '@/lib/game/cas-storage';
import * as cas from '@/lib/game/cas-storage';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import { abortActiveStream, hasActiveStream } from '@/lib/game/stream-lifecycle';
import { HOST_SHORTCUT_EVENT } from '@/lib/game/keyboard-shortcuts';
import { speculativeEngine } from '@/lib/ai/speculation';

vi.mock('@/lib/game/momoi/use-momoi-playback', () => ({ useMomoiPlayback: () => ({ isPlaying: false, isGenerating: false, replay() {}, stop() {} }) }));
vi.mock('@/lib/game/momoi/service-status', () => ({ useVoiceServiceMonitor() {}, voiceStatusLabel: () => '关闭' }));
vi.mock('@/lib/game/midori/image-manager', () => ({ ensureImage: async () => null }));

const oldSegments = [{ type: 'narration' as const, text: '旧记录的第一段。' }, { type: 'narration' as const, text: '旧记录的第二段。' }];
const response = { segments: [{ type: 'narration', text: '新的行动得到回应。' }], availableActions: ['继续观察'], timeSpent: { day: 0, hour: 0, minute: 1 } };
const requests: { input: string; resolve(value: Response): void; reject(error: Error): void }[] = [];
const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const activePage = (container: HTMLElement) => container.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing)')!;
const submit = (input: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: input } });
  fireEvent.click(screen.getByRole('button', { name: /发送/ }));
};
const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(async () => {
  localStorage.clear(); abortActiveStream(); speculativeEngine.cancel(); requests.length = 0;
  vi.stubGlobal('crypto', webcrypto);
  saveSettings({ ...loadSettings(), autoAdvance: false, autoSelect: false, enableSpeculation: false, enableContentReview: false, aliceApiKey: '' });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function (this: HTMLElement, options?: ScrollToOptions | number) { if (typeof options !== 'number') this.scrollTop = options?.top ?? 0; } });
  const { world, snapshot } = buildRiftCityStartState();
  const initial = useGameStore.getInitialState();
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: world, currentPlaythroughId: crypto.randomUUID(),
    currentScene: null, currentSceneId: snapshot.currentSceneId, gameTime: snapshot.currentGameTime, availableActions: ['继续观察'],
    midoriSettings: { ...initial.midoriSettings, enabled: false }, momoiSettings: { ...initial.momoiSettings, enabled: false } });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  const original = useGameStore.getState().currentNode!;
  const text = oldSegments.map(segment => segment.text).join('\n\n');
  const node = { ...original, playerInput: '上一次的行动', aiResponse: text, playerVisibleText: text, generationComplete: true,
    snapshotHash: await hashAndStore('snapshot', snapshot), segmentHash: await hashAndStore('segments', oldSegments), availableActions: ['继续观察'] };
  useGameStore.setState({ currentNode: node, allNodes: { [node.id]: node }, sceneNarrative: text, savedSegments: oldSegments,
    savedSegmentIndex: 1, savedIsShowingSegments: true, history: [] });
  vi.stubGlobal('fetch', vi.fn((url, init) => String(url).startsWith('/api/game/action')
    ? new Promise<Response>((resolve, reject) => requests.push({ input: JSON.parse(String(init?.body)).playerInput, resolve, reject }))
    : Promise.resolve(Response.json({}))));
});
afterEach(() => {
  cleanup(); abortActiveStream(); speculativeEngine.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

it.each([true, false])('opens a waiting page synchronously and fills that same page when the reply arrives, streaming=%s', async streaming => {
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  const before = useGameStore.getState();
  const view = render(React.createElement(GameScreen));
  const previous = activePage(view.container);
  submit('检查钟楼的门');
  const pending = activePage(view.container);
  expect(pending).not.toBe(previous);
  expect(pending.textContent).toContain('检查钟楼的门');
  expect(pending.textContent).not.toContain('旧记录');
  expect(pending.querySelector('[aria-label="行动回复状态"]')?.textContent).toContain('正在召唤ALICE');
  expect(view.container.querySelector('.is-outgoing')?.hasAttribute('inert')).toBe(true);
  expect(useGameStore.getState().currentNode?.id).toBe(before.currentNode?.id);
  expect(useGameStore.getState().history).toEqual([]);
  await waitFor(() => expect(requests).toHaveLength(1));
  if (streaming) {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
    await act(async () => { stream.enqueue(encode({ type: 'activity', phase: 'thinking', elapsedMs: 1 })); });
    expect(pending.querySelector('[aria-label="行动回复状态"]')?.textContent).toContain('思考');
    await act(async () => { stream.enqueue(encode({ type: 'segments', segments: response.segments })); });
    expect(activePage(view.container)).toBe(pending);
    expect(pending.textContent).toContain('新的行动得到回应。');
    expect(pending.querySelector('[aria-label="行动回复状态"]')?.textContent).toBe('ALICE陷入了思考');
    await act(async () => { stream.enqueue(encode({ type: 'done', ...response })); stream.close(); });
  } else await act(async () => requests[0].resolve(Response.json(response)));
  await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
  expect(activePage(view.container)).toBe(pending);
  expect(pending.querySelector('[aria-label="行动回复状态"]')).toBeNull();
  expect(useGameStore.getState().history).toHaveLength(1);
});

it.each(['json-error', 'json-network', 'json-http', 'json-empty', 'sse-http', 'sse-error', 'sse-incomplete', 'sse-partial', 'sse-empty'])('restores the previous paragraph, scroll and input after %s', async failure => {
  localStorage.setItem('eidos_stream_mode', JSON.stringify(failure.startsWith('sse')));
  const before = useGameStore.getState();
  const view = render(React.createElement(GameScreen));
  activePage(view.container).querySelector<HTMLElement>('.eidos-record-scroll')!.scrollTop = 240;
  submit('检查钟楼的门');
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => {
    if (failure === 'json-network') requests[0].reject(new TypeError('连接失败，请重试'));
    else if (failure === 'json-http') requests[0].resolve(Response.json({ message: '服务暂时不可用' }, { status: 503 }));
    else if (failure === 'json-empty') requests[0].resolve(Response.json({ segments: [], availableActions: [] }));
    else if (failure === 'sse-empty') requests[0].resolve(new Response(`data: ${JSON.stringify({ type: 'done', segments: [], availableActions: [] })}\n\n`));
    else if (failure === 'json-error' || failure === 'sse-http') requests[0].resolve(Response.json({ error: '模型暂时不可用，请重试' }, { status: 503 }));
    else {
      const partial = failure === 'sse-partial' ? `data: ${JSON.stringify({ type: 'segments', segments: [{ type: 'narration', text: '没有确认的半截回复。' }] })}\n\n` : '';
      requests[0].resolve(new Response(partial + (failure === 'sse-incomplete' ? '' : `data: ${JSON.stringify({ type: 'error', message: '回复中断，请重试' })}\n\n`)));
    }
  });
  await screen.findByRole('alert');
  const restored = activePage(view.container);
  expect(restored.textContent).toContain('旧记录的第二段。');
  expect(restored.textContent).not.toContain('没有确认的半截回复。');
  expect(restored.querySelector<HTMLElement>('.eidos-record-scroll')?.scrollTop).toBe(240);
  expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step');
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('检查钟楼的门');
  expect(useGameStore.getState().currentNode?.id).toBe(before.currentNode?.id);
  expect(useGameStore.getState().gameTime).toEqual(before.gameTime);
  expect(useGameStore.getState().allNodes).toEqual(before.allNodes);
  expect(useGameStore.getState().history).toHaveLength(0);
  expect(useGameStore.getState().savedSegments).toEqual(oldSegments);
  expect(useGameStore.getState().isLoading).toBe(false);
  submit('重新检查门锁');
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(activePage(view.container).textContent).toContain('重新检查门锁');
  await act(async () => requests[1].resolve(failure.startsWith('sse') ? new Response(`data: ${JSON.stringify({ type: 'done', ...response })}\n\n`) : Response.json(response)));
  await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
  expect(useGameStore.getState().history).toHaveLength(1);
});

it.each([false, true])('returns to the original record on Stop and preserves edits typed during the wait, partial=%s', async partial => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const before = useGameStore.getState();
  const view = render(React.createElement(GameScreen));
  submit('检查钟楼的门');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  if (partial) await act(async () => { stream.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '尚未确认的回复。' }] })); });
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '我想改成检查窗户' } });
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('我想改成检查窗户');
  await act(async () => { stream.enqueue(encode({ type: 'done', ...response })); stream.close(); });
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect(useGameStore.getState().currentNode?.id).toBe(before.currentNode?.id);
  expect(useGameStore.getState().history).toHaveLength(0);
});

it('restores the actual origin after replacing a waiting request and stopping the replacement', async () => {
  localStorage.setItem('eidos_stream_mode', 'false');
  const view = render(React.createElement(GameScreen));
  submit('先检查门锁');
  await waitFor(() => expect(requests).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  submit('改为检查窗户');
  await waitFor(() => expect(requests).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('改为检查窗户');
  await act(async () => { requests[0].resolve(Response.json(response)); requests[1].resolve(Response.json(response)); });
  expect(useGameStore.getState().history).toHaveLength(0);
});

it.each([false, true])('shows a cached child on the waiting page unless stopped while reading its snapshot, stopped=%s', async stopped => {
  const state = useGameStore.getState(), parent = state.currentNode!;
  const lines = [{ type: 'narration' as const, text: '缓存节点的正文。' }];
  const child = { ...parent, id: 'cached-child', parentId: parent.id, childIds: [], playerInput: '检查缓存节点', stepNumber: parent.stepNumber + 1,
    aiResponse: lines[0].text, playerVisibleText: lines[0].text, segmentHash: await hashAndStore('segments', lines) };
  useGameStore.setState({ allNodes: { [parent.id]: { ...parent, childIds: [child.id] }, [child.id]: child }, currentNode: { ...parent, childIds: [child.id] } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const originalLoad = cas.loadBlob;
  let reading = false;
  vi.spyOn(cas, 'loadBlob').mockImplementation(async hash => {
    if (hash === child.snapshotHash) { reading = true; await gate; }
    return originalLoad(hash);
  });
  const matching = vi.spyOn(useGameStore.getState(), 'tryMatchChildNode');
  const view = render(React.createElement(GameScreen));
  submit('检查缓存节点');
  await waitFor(() => expect(reading).toBe(true));
  const pending = activePage(view.container);
  expect(pending.querySelector('[aria-label="行动回复状态"]')).not.toBeNull();
  if (stopped) fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  await act(async () => { release(); await matching.mock.results[0].value; });
  if (stopped) {
    expect(useGameStore.getState().currentNode?.id).toBe(parent.id);
    expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
    expect((screen.getByRole('textbox', { name: '行动输入' }) as HTMLTextAreaElement).value).toBe('检查缓存节点');
  } else {
    await waitFor(() => expect(useGameStore.getState().currentNode?.id).toBe(child.id));
    expect(activePage(view.container)).toBe(pending);
    expect(pending.textContent).toContain('缓存节点的正文。');
  }
  expect(useGameStore.getState().isLoading).toBe(false);
  expect(requests).toHaveLength(0);
});

it('returns to the same historical paragraph when an action submitted from history fails', async () => {
  localStorage.setItem('eidos_stream_mode', 'false');
  const state = useGameStore.getState(), past = state.currentNode!;
  const now = { ...past, id: 'live-child', parentId: past.id, childIds: [], stepNumber: past.stepNumber + 1 };
  useGameStore.setState({ currentNode: now, allNodes: { [past.id]: { ...past, childIds: [now.id] }, [now.id]: now } });
  await useGameStore.getState().openReadingNode(past.id);
  useGameStore.getState().setReadingSegment(1);
  const view = render(React.createElement(GameScreen));
  fireEvent.click(activePage(view.container).querySelector('[data-record-segment="1"] [data-reading-text]')!);
  submit('检查旧段落里的线索');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(useGameStore.getState().readingView).toBeNull();
  await act(async () => requests[0].resolve(Response.json({ error: '请求失败，请重试' })));
  await screen.findByRole('alert');
  expect(useGameStore.getState().readingView).toMatchObject({ nodeId: past.id, segmentIndex: 1 });
  expect(screen.getByRole('button', { name: '播放第 2 段' }).getAttribute('aria-current')).toBe('step');
  expect(useGameStore.getState().currentNode?.id).toBe(now.id);
  expect(useGameStore.getState().history).toHaveLength(0);
});


it.each([
  [true, 'settings', false], [false, 'settings', false],
  [true, 'audio', false], [false, 'audio', false],
  [true, 'settings', true], [false, 'settings', true],
] as const)('keeps a pending action alive on an internal page: streaming=%s, page=%s, fails=%s', async (streaming, phase, fails) => {
  localStorage.setItem('eidos_stream_mode', JSON.stringify(streaming));
  render(React.createElement(GameScreen));
  submit('等待时检查资料');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  if (streaming) {
    await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
    await act(async () => stream.enqueue(encode({ type: 'segments', segments: response.segments })));
  }
  const saved = useGameStore.getState().savedSegments;
  fireEvent.change(screen.getByRole('textbox', { name: '行动输入' }), { target: { value: '下一步的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '播放与快捷设置' }));
  fireEvent.click(screen.getByRole('button', { name: phase === 'settings' ? '系统设置' : '对话语音设置' }));
  await waitFor(() => expect(useGameStore.getState().phase).toBe(phase));
  expect(useGameStore.getState().isLoading).toBe(true);
  expect(useGameStore.getState().savedSegments).toEqual(saved);
  expect(useGameStore.getState().pendingInput).toBe('下一步的草稿');
  if (streaming) expect(hasActiveStream()).toBe(true);
  await act(async () => {
    if (streaming) { stream.enqueue(encode(fails ? { type: 'error', message: '测试失败' } : { type: 'done', ...response })); stream.close(); }
    else requests[0].resolve(Response.json(fails ? { error: '测试失败' } : response));
  });
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(useGameStore.getState().phase).toBe(phase);
  expect(useGameStore.getState().history).toHaveLength(fails ? 0 : 1);
  act(() => useGameStore.getState().goBack());
  expect(useGameStore.getState().phase).toBe('playing');
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '行动输入' }).value).toBe('下一步的草稿');
  if (fails) expect(screen.getByRole('alert').textContent).toContain('测试失败');
  else await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
});


it('focuses the input by shortcut while a reply is pending and still blocks leaving the world', async () => {
  render(React.createElement(GameScreen));
  submit('继续等待');
  await waitFor(() => expect(requests).toHaveLength(1));
  screen.getByRole<HTMLElement>('textbox', { name: '行动输入' }).blur();
  act(() => window.dispatchEvent(new CustomEvent(HOST_SHORTCUT_EVENT, { detail: 'focusInput' })));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '行动输入' }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'EIDOS' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'EIDOS' }));
  expect(useGameStore.getState().phase).toBe('playing');
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
});


it.each([false, true])('browses accepted records during generation without changing the request, returnToPending=%s', async returnToPending => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const origin = useGameStore.getState().currentNode!;
  const view = render(React.createElement(GameScreen));
  submit('继续检查门锁');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(origin.id));
  expect(activePage(view.container).textContent).toContain('上一次的行动');
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect(activePage(view.container).querySelector('[aria-label="行动回复状态"]')).toBeNull();
  expect(useGameStore.getState().currentNode?.id).toBe(origin.id);
  expect(hasActiveStream()).toBe(true);
  if (returnToPending) {
    fireEvent.click(screen.getByRole('button', { name: '下一行动记录' }));
    expect(useGameStore.getState().readingView).toBeNull();
    expect(activePage(view.container).textContent).toContain('继续检查门锁');
    expect(activePage(view.container).querySelector('[aria-label="行动回复状态"]')).not.toBeNull();
  }
  await act(async () => { stream.enqueue(encode({ type: 'done', ...response })); stream.close(); });
  await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
  expect(useGameStore.getState().history).toHaveLength(1);
  if (!returnToPending) {
    expect(useGameStore.getState().readingView?.nodeId).toBe(origin.id);
    expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
    fireEvent.click(screen.getByRole('button', { name: '下一行动记录' }));
    await waitFor(() => expect(useGameStore.getState().readingView).toBeNull());
    expect(activePage(view.container).textContent).toContain('新的行动得到回应。');
  }
});


it('has no previous pending record when the world has no accepted prose yet', async () => {
  const node = { ...useGameStore.getState().currentNode!, aiResponse: '', playerVisibleText: '', segmentHash: '' };
  useGameStore.setState({ currentNode: node, allNodes: { [node.id]: node }, savedSegments: [], savedIsShowingSegments: false, sceneNarrative: '' });
  render(React.createElement(GameScreen));
  submit('观察新世界');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '上一行动记录' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
});

async function seedExistingBranch(atChild = false) {
  const state = useGameStore.getState(), parent = state.currentNode!;
  const lines = [{ type: 'narration' as const, text: '原有子分支的独立正文。' }];
  const child = { ...parent, id: 'existing-branch', parentId: parent.id, childIds: [], stepNumber: parent.stepNumber + 1,
    actionId: 'existing-action', playerInput: '原先走向左门', aiResponse: lines[0].text, playerVisibleText: lines[0].text,
    segmentHash: await hashAndStore('segments', lines) };
  const source = { ...parent, childIds: [child.id] };
  useGameStore.setState({ allNodes: { [parent.id]: source, [child.id]: child }, currentNode: atChild ? child : source,
    worldLine: { ...state.worldLine!, currentNodeId: atChild ? child.id : parent.id, allNodeIds: [parent.id, child.id] },
    ...(atChild ? { savedSegments: lines, savedSegmentIndex: 0, savedIsShowingSegments: false, sceneNarrative: child.aiResponse } : {}) });
  return { parent: source, child };
}

it('does not borrow existing child branches for the provisional reply page', async () => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const { parent, child } = await seedExistingBranch();
  const view = render(React.createElement(GameScreen));
  submit('这次改走右门');
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(activePage(view.container).textContent).toContain('这次改走右门');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一行动记录' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '下一行动记录' }));
  expect(useGameStore.getState().readingView).toBeNull();
  expect(useGameStore.getState().allNodes[parent.id].childIds).toEqual([child.id]);
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
});

it('returns a pending historical branch to its actual source and keeps streaming separate from old children', async () => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const { parent, child } = await seedExistingBranch(true);
  await useGameStore.getState().openReadingNode(parent.id);
  const view = render(React.createElement(GameScreen));
  submit('这次改走右门');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  await act(async () => stream.enqueue(encode({ type: 'segments', segments: [{ type: 'narration', text: '右门的新分支还在生成。' }], lastIsDraft: true })));
  fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(parent.id));
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect(activePage(view.container).textContent).not.toContain('原有子分支的独立正文。');
  expect(useGameStore.getState().currentNode?.id).toBe(child.id);
  fireEvent.click(screen.getByRole('button', { name: '下一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().readingView).toBeNull());
  expect(activePage(view.container).textContent).toContain('右门的新分支还在生成。');
  expect(activePage(view.container).textContent).toContain('这次改走右门');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一行动记录' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(parent.id));
  await act(async () => { stream.enqueue(encode({ type: 'done', ...response })); stream.close(); });
  await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
  const state = useGameStore.getState();
  expect(state.currentNode!.parentId).toBe(parent.id);
  expect(state.currentNode!.entry).toMatchObject({ originNodeId: child.id, sourceNodeId: parent.id });
  expect(Object.values(state.allNodes).filter(n=>n.id.startsWith('observer_'))).toHaveLength(0);
  expect(state.allNodes[child.id].aiResponse).toBe('原有子分支的独立正文。');
  expect(state.readingView?.nodeId).toBe(parent.id);
  expect(activePage(view.container).textContent).toContain('旧记录的第二段。');
  expect(activePage(view.container).textContent).not.toContain('新的行动得到回应。');
  act(() => useGameStore.getState().closeReadingView());
  expect(activePage(view.container).textContent).toContain('新的行动得到回应。');
  expect(activePage(view.container).textContent).not.toContain('旧记录的第二段。');
});

it.each(['error', 'stop'])('keeps an intentionally browsed old branch when the pending action ends with %s', async outcome => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const { parent, child } = await seedExistingBranch();
  const view = render(React.createElement(GameScreen));
  submit('这次改走右门');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
  await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(parent.id));
  fireEvent.click(screen.getByRole('button', { name: /原先走向左门/ }));
  await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(child.id));
  if (outcome === 'stop') fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  await act(async () => {
    stream.enqueue(encode(outcome === 'stop' ? { type: 'done', ...response } : { type: 'error', message: '测试生成失败' })); stream.close();
  });
  await waitFor(() => expect(useGameStore.getState().isLoading).toBe(false));
  expect(useGameStore.getState().readingView?.nodeId).toBe(child.id);
  expect(activePage(view.container).textContent).toContain('原有子分支的独立正文。');
  expect(useGameStore.getState().currentNode?.id).toBe(parent.id);
  expect(useGameStore.getState().allNodes[parent.id].childIds).toEqual([child.id]);
  expect(useGameStore.getState().history).toHaveLength(0);
});

it('keeps the historical source when replacing an unfinished historical action', async () => {
  localStorage.setItem('eidos_stream_mode', 'false');
  const { parent, child } = await seedExistingBranch(true);
  await useGameStore.getState().openReadingNode(parent.id);
  render(React.createElement(GameScreen));
  submit('这次改走右门');
  await waitFor(() => expect(requests).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
  submit('还是检查右门门锁');
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1].resolve(Response.json(response)));
  await waitFor(() => expect(useGameStore.getState().currentNode?.aiResponse).toBe('新的行动得到回应。'));
  const state = useGameStore.getState();
  expect(state.currentNode!.parentId).toBe(parent.id);
  expect(state.currentNode!.entry).toMatchObject({ originNodeId: child.id, sourceNodeId: parent.id });
  expect(Object.values(state.allNodes).filter(n=>n.id.startsWith('observer_'))).toHaveLength(0);
  expect(state.allNodes[child.id].aiResponse).toBe('原有子分支的独立正文。');
  const ids = Object.keys(state.allNodes);
  await act(async () => requests[0].resolve(Response.json({ ...response, segments: [{ type: 'narration', text: '旧请求的迟到正文。' }] })));
  expect(Object.keys(useGameStore.getState().allNodes)).toEqual(ids);
  expect(useGameStore.getState().currentNode?.playerInput).toBe('还是检查右门门锁');
});

it.each([false, true])('retains streamed branch prose after a metadata-only completion and later read-only visits, browsing=%s', async browsing => {
  localStorage.setItem('eidos_stream_mode', 'true');
  const { parent, child } = await seedExistingBranch(true);
  await useGameStore.getState().openReadingNode(parent.id);
  const view = render(React.createElement(GameScreen));
  submit('原先走向左门');
  await waitFor(() => expect(requests).toHaveLength(1));
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  await act(async () => requests[0].resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }))));
  const fresh = [{ type: 'narration' as const, text: '同样选择在新分支得到了不同的回应。' }];
  await act(async () => stream.enqueue(encode({ type: 'segments', segments: fresh })));
  expect(activePage(view.container).textContent).toContain(fresh[0].text);
  if (browsing) {
    fireEvent.click(screen.getByRole('button', { name: '上一行动记录' }));
    await waitFor(() => expect(useGameStore.getState().readingView?.nodeId).toBe(parent.id));
  }
  await act(async () => {
    stream.enqueue(encode({ type: 'done', availableActions: ['继续观察'], timeSpent: { day: 0, hour: 0, minute: 1 } }));
    stream.close();
  });
  await waitFor(() => {
    expect(useGameStore.getState().currentNode?.id).not.toBe(child.id);
    expect(useGameStore.getState().currentNode?.playerInput).toBe('原先走向左门');
    expect(useGameStore.getState().isLoading).toBe(false);
  });
  const state = useGameStore.getState(), generated = state.currentNode!;
  expect(generated.id).not.toBe(child.id);
  expect(generated.aiResponse).toBe('同样选择在新分支得到了不同的回应。');
  expect(await cas.loadBlob(generated.segmentHash)).toEqual(fresh);
  expect(await cas.loadBlob(generated.snapshotHash)).toMatchObject({ sceneNarrative: fresh[0].text });
  expect(generated.parentId).toBe(parent.id);
  expect(generated.entry).toMatchObject({sourceNodeId:parent.id,originNodeId:child.id});
  expect(state.allNodes[child.id].aiResponse).toBe('原有子分支的独立正文。');
  if (browsing) expect(state.readingView?.nodeId).toBe(parent.id);
  else expect(activePage(view.container).textContent).toContain(fresh[0].text);
  await act(async () => {
    useGameStore.getState().setNodeReadText(generated.id, generated.aiResponse);
    await useGameStore.getState().openReadingNode(parent.id);
    await useGameStore.getState().openReadingNode(generated.id, generated.id);
  });
  expect(activePage(view.container).textContent).toContain(fresh[0].text);
  expect(activePage(view.container).textContent).not.toContain('旧记录的第二段。');
  await act(async () => { await useGameStore.getState().persistWorldLineData(); await useGameStore.getState().loadWorldLine(state.worldLine!.id); });
  expect(useGameStore.getState().allNodes[generated.id].aiResponse).toBe(fresh[0].text);
  expect(requests).toHaveLength(1);
});
