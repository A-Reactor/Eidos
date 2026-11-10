// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { db, store } = vi.hoisted(() => ({ db: new Map<string, unknown>(), store: { addTokenUsage: vi.fn(), setPhase: vi.fn(), setCurrentWorld: vi.fn(), addPlayerWorld: vi.fn(), addSandboxWorld: vi.fn(), createPlaythrough: vi.fn().mockResolvedValue('pt'), setCurrentPlaythrough: vi.fn(), initWorldLine: vi.fn().mockResolvedValue('wl'), sandboxMode: false, sandboxDossierId: null, midoriSettings: { enabled: false } } }));
vi.mock('@/store/game-store', () => ({ useGameStore: (selector?: (state: typeof store) => unknown) => selector ? selector(store) : store }));
vi.mock('@/lib/game/storage', () => ({ saveToDB: async (key: string, value: unknown) => { db.set(key, structuredClone(value)); }, loadFromDB: async (key: string) => db.get(key) ?? null }));
import { WorldCreateScreen } from '@/components/game/WorldCreateScreen';
import { runSourceTask } from '@/lib/ai/source-reconstruction/runner';
import { WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
const text = '城市建立在裂隙边缘，调查员林记录异常，并留下第一份档案。';
function stream(result: Record<string, unknown>) { return new Response(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }); }
const world = { id: 'w', name: '雨港', subtitle: '', overview: '雨港', regions: {}, npcs: {}, contradictions: [], history: [], timeline: [], clues: [], systemPromptBase: '', identityPrompt: '', createdAt: 1 };
beforeEach(() => {
  db.clear(); localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url === '/api/world/source/task') {
      const result = await runSourceTask(body.task, { call: async () => JSON.stringify(body.task.stage === 'brief' ? { fields: Object.fromEntries(WORLD_BRIEF_FIELDS.map(key => [key, { text: key === 'name' ? '雨港' : '原文设定', factRefs: [] }])), issues: [] } : body.task.stage === 'verify' ? { issues: [] } : { summary: '雨港', claims: [], entities: [], unresolved: [], styleCandidates: [] }) });
      return stream({ result });
    }
    if (url === '/api/world/create/stream') return stream({ world, truncated: false });
    if (url === '/api/world/source/seeds') return stream({ seeds: [] });
    throw new Error(`Unexpected endpoint: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup() {
  render(React.createElement(WorldCreateScreen));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '资料建档' }));
}
it('keeps text entry accessible and prevents generating empty text worlds', async () => {
  await setup();
  expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('资料正文')).toBeTruthy();
  const tabs = screen.getAllByRole('button').map(button => button.textContent);
  expect(tabs.indexOf('资料档案')).toBeLessThan(tabs.indexOf('世界生成稿'));
  expect(screen.getByRole('button', { name: '拖入或选择文本资料' })).toBeTruthy();
});
it('builds an editable brief then compiles through the shared endpoint with player overrides', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('资料正文'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '梳理文本，生成编辑稿' }));
  await waitFor(() => expect(screen.getByLabelText('重要人物')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('重要人物'), { target: { value: '林是一位医师' } });
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  const calls = vi.mocked(fetch).mock.calls;
  const payload = JSON.parse(String(calls.find(([url]) => url === '/api/world/create/stream')![1]!.body));
  expect(payload.brief.fields.npcs).toMatchObject({ text: '林是一位医师', policy: 'custom' });
  expect(payload.sourceDossier.summary).toBe('雨港');
  expect(JSON.stringify(payload)).not.toContain(text);
  expect(calls.every(([url]) => !String(url).includes('from-source') && !String(url).endsWith('/extract'))).toBe(true);
  expect(calls.some(([url]) => String(url).includes('/timeline/'))).toBe(false);
});
it('resumes verified reading tasks after a transport failure without rereading completed text', async () => {
  await setup();
  const implementation = vi.mocked(fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    const body = JSON.parse(String(args[1]?.body ?? '{}'));
    if (body.task?.stage === 'brief' && fail) { fail = false; throw new Error('offline'); }
    return implementation(...args);
  });
  fireEvent.change(screen.getByLabelText('资料正文'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  await waitFor(() => expect(screen.getAllByText(/offline/)[0]).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '继续上次生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  const reads = vi.mocked(fetch).mock.calls.filter(([, init]) => JSON.parse(String(init?.body ?? '{}')).task?.stage === 'extract');
  expect(reads).toHaveLength(1);
});
it('finishes a verified world with a visible warning when optional personality initialization fails', async () => {
  await setup();
  const implementation = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (...args) => {
    if (args[0] === '/api/world/source/seeds') throw new Error('UZQ unavailable');
    return implementation(...args);
  });
  fireEvent.change(screen.getByLabelText('资料正文'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '生成' }));
  await screen.findByRole('button', { name: '进入这个世界' });
  expect(screen.getByText(/人物预设初始化暂未完成/)).toBeTruthy();
});
it('saves edited brief choices before generation so material exports and reloads contain player edits', async () => {
  await setup();
  fireEvent.change(screen.getByLabelText('资料正文'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '梳理文本，生成编辑稿' }));
  await waitFor(() => expect(screen.getByLabelText('重要人物')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('重要人物'), { target: { value: '林是医师，必须保留' } });
  await waitFor(() => expect((db.get('world-creation-draft:main') as import('@/lib/game/creation-materials').CreationDraft).brief?.fields.npcs.text).toBe('林是医师，必须保留'));
});

it('pins concept fields beside their heading and separates style selection from its information dialog', async () => {
  render(React.createElement(WorldCreateScreen));
  await waitFor(() => expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '重要人物：AI 重新整理' }));
  expect(screen.getByRole('button', { name: '重要人物：保留填写内容' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '文风写法' }));
  const detailButton = screen.getAllByRole('button', { name: /^查看.*详情$/ })[1];
  const label = detailButton.getAttribute('aria-label')!.replace(/^查看|详情$/g, '');
  fireEvent.click(detailButton);
  expect(screen.getByRole('dialog', { name: label })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  const choice = screen.getByRole('button', { name: label });
  fireEvent.click(choice);
  expect(choice.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('dialog')).toBeNull();
});
