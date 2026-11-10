// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorldCreateScreen } from '@/components/game/WorldCreateScreen';
import { useGameStore } from '@/store/game-store';
import { loadFromDB, saveToDB } from '@/lib/game/storage';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { CreationDraft } from '@/lib/game/creation-materials';
import { createWorldCreationSession, type WorldCreationSession } from '@/lib/game/world-creation-session';

const { downloads } = vi.hoisted(() => ({ downloads: [] as Blob[] }));
vi.mock('@/lib/game/save-file', () => ({ saveFile: async (factory: () => Promise<Blob>) => { downloads.push(await factory()); return 'saved'; } }));
const key = 'world-creation-draft:main';
const world = () => structuredClone(buildRiftCityStartState().world);
const sse = (events: object[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
const completeWorld = () => sse([{ type: 'done', world: world() }]);
const session = (extra: Partial<WorldCreationSession> = {}): WorldCreationSession => ({ ...createWorldCreationSession(), ...extra });
async function draft(): Promise<CreationDraft> {
  let saved!: CreationDraft;
  await act(async () => { saved = await loadFromDB(key) as CreationDraft; });
  return saved;
}
async function start() {
  render(React.createElement(WorldCreateScreen));
  const generate = await screen.findByRole('button', { name: '生成' });
  await waitFor(() => expect(generate).toHaveProperty('disabled', false));
  fireEvent.click(generate);
}
async function exportDraft() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '导出生成材料' })); });
  await waitFor(() => expect(downloads).toHaveLength(1));
  let text = '';
  await act(async () => { text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
    reader.readAsText(downloads[0]);
  }); });
  return JSON.parse(text).draft as CreationDraft;
}
beforeEach(async () => {
  localStorage.clear(); downloads.length = 0;
  useGameStore.setState({ ...useGameStore.getInitialState(), phase: 'world_create' });
  await saveToDB(key, null); await saveToDB(`${key}:presets`, []);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('continues one conversation across interruptions and exports its committed fields and transcript', async () => {
  const accepted = session({ fields: { name: '雨港', timeline: [] }, messages: [{ role: 'assistant', content: '已提交的第一轮' }, { role: 'user', content: '字段已保存' }] });
  const fetch = vi.fn().mockResolvedValueOnce(sse([{ type: 'delta', delta: '{"name":' }, { type: 'error', message: '模拟断流' }]))
    .mockResolvedValueOnce(sse([{ type: 'checkpoint', conversation: accepted }, { type: 'delta', delta: '{"toolRequest":' }, { type: 'error', message: '后续连接失败' }]))
    .mockResolvedValueOnce(completeWorld());
  vi.stubGlobal('fetch', fetch);
  await start();
  fireEvent.click(await screen.findByRole('button', { name: '继续上次生成' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: '继续上次生成' });
  expect(JSON.parse(fetch.mock.calls[1][1].body).conversation.pendingText).toBe('{"name":');
  const saved = await exportDraft();
  expect(saved.completed).toEqual([]);
  expect(saved.conversation?.fields).toEqual({ name: '雨港', timeline: [] });
  expect(saved.conversation?.pendingText).toBe('{"toolRequest":');
  expect(saved.raw.world).toContain('已提交的第一轮');
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  expect(fetch.mock.calls.every(call => call[0] === '/api/world/create/stream')).toBe(true);
  expect(JSON.parse(fetch.mock.calls[2][1].body).conversation.messages).toEqual(accepted.messages);
  expect((await draft()).completed).toEqual([0]);
});

it('retains earlier failed operations in the conversation when a correction is interrupted', async () => {
  const original = '{"regions":{"broken":{}}}';
  const fetch = vi.fn().mockResolvedValueOnce(sse([{ type: 'delta', delta: original }, { type: 'error', message: '地图不完整' }]))
    .mockResolvedValueOnce(sse([{ type: 'checkpoint', conversation: session({ fields: { name: '雨港' }, messages: [{ role: 'assistant', content: original }, { role: 'user', content: '地图引用无效' }] }) }, { type: 'delta', delta: '{"name":"修正中' }, { type: 'error', message: '修正时断流' }]))
    .mockResolvedValueOnce(completeWorld());
  vi.stubGlobal('fetch', fetch);
  await start();
  fireEvent.click(await screen.findByRole('button', { name: '继续上次生成' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: '继续上次生成' });
  const saved = await draft();
  expect(saved.conversation?.pendingText).toBe('{"name":"修正中');
  expect(saved.raw.world).toContain(original);
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  expect(JSON.parse(fetch.mock.calls[2][1].body).conversation.pendingText).toBe('{"name":"修正中');
});

it('stops a waiting stream promptly and retains its prefix for continuing', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn(async (url: string) => url.includes('/stop') ? Response.json({ ok: true }) : completeWorld());
  fetch.mockImplementationOnce(async () => new Response(new ReadableStream({ start(stream) { controller = stream; } })));
  vi.stubGlobal('fetch', fetch);
  await start();
  await waitFor(() => expect(controller).toBeDefined());
  await act(async () => controller.enqueue(new TextEncoder().encode('data: {"type":"delta","delta":"{\\"name\\":"}\n\n')));
  fireEvent.click(screen.getByRole('button', { name: '停止生成（保留已有内容）' }));
  await screen.findByRole('button', { name: '继续上次生成' });
  expect((await draft()).raw.world).toBe('{"name":');
  expect((await draft()).conversation?.pendingText).toBe('{"name":');
  fetch.mockResolvedValueOnce(completeWorld());
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
});

it('fills section status from response chunks before a checkpoint or done, without another request', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn(async () => new Response(new ReadableStream({ start(stream) { controller = stream; } })));
  vi.stubGlobal('fetch', fetch);
  await start();
  await waitFor(() => expect(controller).toBeDefined());
  await act(async () => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'delta', delta: '{"toolRequest":{"method":"world.finish","params":{"fields":{"name":"雨港","subtitle":"渡口","regions":{' })}\n\n`)));
  expect(screen.getByLabelText('名称：已填充')).toBeTruthy();
  expect(screen.getByLabelText('地图：正在填充')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: '世界内容' }).getAttribute('aria-valuenow')).toBe('11');
  expect(fetch).toHaveBeenCalledOnce();
  expect(screen.queryByText(/当前内容只读|材料保存在本机|持续接收中/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '停止生成（保留已有内容）' }));
  await screen.findByRole('button', { name: '继续上次生成' });
});

it('retries the unfinished operation while preserving submitted fields and old material', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(sse([{ type: 'checkpoint', conversation: session({ fields: { name: '雨港', timeline: [] } }) }, { type: 'delta', delta: '{"toolRequest":' }, { type: 'error', message: '连接中断' }]))
    .mockResolvedValueOnce(completeWorld());
  vi.stubGlobal('fetch', fetch);
  await start();
  fireEvent.click(await screen.findByRole('button', { name: '重新尝试（保留已有内容）' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  expect(fetch.mock.calls[1][0]).toBe('/api/world/create/stream');
  expect(JSON.parse(fetch.mock.calls[1][1].body).conversation).toMatchObject({ fields: { name: '雨港', timeline: [] }, pendingText: '' });
  const saved = await draft();
  expect(Object.entries(saved.raw).some(([name, text]) => name.startsWith('world（重做前') && text.includes('{"toolRequest":'))).toBe(true);
});
