import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi, callAiStream } from '@/lib/ai/client';
import type { TokenUsage } from '@/lib/ai/types';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
const usage: TokenUsage = { model: 'alice', promptTokens: 10, completionTokens: 10, cachedTokens: 0, totalTokens: 20, elapsedMs: 1, finishReason: 'stop' };
const context = { draftRoot: 'drafts/turn', mounts: [], nextOffset: null, results: [] };
function request(workspaceContext: unknown = context) {
  return new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    playerInput: '分析资料并整理报告', world, snapshot, recentHistory: [], workspaceContext, _settings: { aliceApiKey: 'offline-only' },
  }) });
}
beforeEach(() => { vi.mocked(callAi).mockReset(); vi.mocked(callAiStream).mockReset(); });

it('reports file work while streaming a hidden file command without showing its contents', async () => {
  const raw = JSON.stringify({ toolRequest: { method: 'files.write', params: { path: 'drafts/turn/a.txt', expectedVersion: null, text: '隐藏的文档正文' } } });
  vi.mocked(callAiStream).mockImplementation(async req => { for (const char of raw) req.onChunk(char); req.onDone(raw, usage); });
  const response = await stream(request());
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  expect(events.some(event => event.type === 'activity' && event.phase === 'files')).toBe(true);
  expect(events.filter(event => event.type === 'segments')).toEqual([]);
});

it.each([['JSON', action], ['SSE', stream]] as const)('returns an intermediate workspace request without game effects over %s', async (name, handler) => {
  const raw = JSON.stringify({ workspaceRequest: { method: 'files.write', params: { path: 'drafts/turn/report.md', expectedVersion: null, text: '# 草稿' } } });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  const response = await handler(request());
  const result = name === 'JSON' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'done');
  expect(result.workspaceRequest.params.text).toBe('# 草稿');
  expect(result.segments).toEqual([]);
  expect(result.timeSpent).toBeUndefined();
  const sent = name === 'JSON' ? vi.mocked(callAi).mock.calls[0][0] : vi.mocked(callAiStream).mock.calls[0][0];
  expect(sent.userMessage).toBe('分析资料并整理报告');
  expect(sent.systemPrompt).toContain('drafts/turn');
});

it.each([['JSON', action], ['SSE', stream]] as const)('validates structured file context before a paid %s request', async (_name, handler) => {
  const response = await handler(request({ ...context, results: [{ method: 'files.read', status: 'committed', text: 'x'.repeat(12001) }] }));
  expect(response.status).toBe(400);
  expect(callAi).not.toHaveBeenCalled();
  expect(callAiStream).not.toHaveBeenCalled();
});

it('returns a recoverable protocol receipt instead of executing mixed settlement fields', async () => {
  vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ workspaceRequest: { method: 'files.list', params: {} }, timeSpent: { day: 9, hour: 0, minute: 0 }, segments: [{ type: 'narration', text: '假结算' }] }), usage, elapsedMs: 1 });
  const response = await action(request());
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.toolError.message).toContain('工具');
  expect(result.segments).toEqual([]);
  expect(result.timeSpent).toBeUndefined();
  expect(result._tokenUsage.totalTokens).toBe(20);
});

it.each([['JSON', action], ['SSE', stream]] as const)('routes structured tools and malformed complete requests for correction over %s', async (name, handler) => {
  for (const toolRequest of [{ method: 'history.read', params: { query: '' } }, { method: 'web.search', params: { query: 'TypeScript 官方文档' } }, { method: 'web.open', params: { url: 'https://www.typescriptlang.org/docs/' } }, { method: 'worldline.backtrack', params: { target: '第2步', reason: '角色发动已声明的回溯能力' } }, { method: 'files.patch', params: { path: 'drafts/turn/a.txt' } }]) {
    const raw = JSON.stringify({ toolRequest });
    vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
    vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
    const response = await handler(request());
    const result = name === 'JSON' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'done');
    expect(result.timeSpent).toBeUndefined();
    if (toolRequest.method === 'files.patch') { expect(result.toolRequest).toBeUndefined(); expect(result.toolError.message).toContain('expectedVersion'); }
    else expect(result.toolRequest.method).toBe(toolRequest.method);
  }
});

it.each([['JSON', action], ['SSE', stream]] as const)('accepts metadata-only completion after earlier narrative over %s', async (name, handler) => {
  const raw = JSON.stringify({ segments: [], summary: '正文已在工具调用前输出', timeSpent: { day: 0, hour: 0, minute: 0 } });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  const response = await handler(request({ ...context, narrative: [{ type: 'narration', text: '她把文件放回桌面。' }] }));
  expect(response.status).toBe(200);
  const result = name === 'JSON' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(e => e.type === 'done');
  expect(result).toBeDefined();
  expect(result.summary).toBe('正文已在工具调用前输出');
  expect(result.error).toBeUndefined();
});

it.each([['JSON', action], ['SSE', stream]] as const)('preserves ordinary segments before a file command over %s without leaking file text', async (name, handler) => {
  const raw = JSON.stringify({ segments: [{ type: 'narration', text: '她走到窗边。' }], workspaceRequest: { method: 'files.write', params: { path: 'drafts/turn/note.txt', expectedVersion: null, text: '文件专用正文，含 segments 和 text 字样。' } } });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { for (const char of raw) req.onChunk(char); req.onDone(raw, usage); });
  const response = await handler(request());
  expect(response.status).toBe(200);
  if (name === 'JSON') {
    const result = await response.json();
    expect(result.segments).toEqual([{ type: 'narration', text: '她走到窗边。' }]);
    expect(result.workspaceRequest.params.text).toContain('文件专用正文');
  } else {
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const paragraphs = events.filter(e => e.type === 'segments').flatMap(e => e.segments);
    expect(paragraphs.some(s => s.text === '她走到窗边。')).toBe(true);
    expect(paragraphs.some(s => s.text.includes('文件专用正文'))).toBe(false);
    expect(events.find(e => e.type === 'done').workspaceRequest.params.text).toContain('文件专用正文');
  }
});

it.each([['JSON', action], ['SSE', stream]] as const)('accepts neutral template fields but never executes an incomplete file command over %s', async (name, handler) => {
  const complete = JSON.stringify({ workspaceRequest: { method: 'files.write', params: { path: 'drafts/turn/a.txt', expectedVersion: null, text: '完整文件正文' } },
    segments: [], itemsGained: [], itemsUsed: [], sceneChanges: [], worldImpacts: [], timeSpent: { day: 0, hour: 0, minute: 0 }, document: null, documents: [], narrative: '', dialogue: null });
  const setModel = (raw: string) => {
    vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
    vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  };
  setModel(complete);
  let response = await handler(request());
  const read = async (response: Response) => name === 'JSON' ? [await response.json()] : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  let events = await read(response);
  expect(events.some(e => e.workspaceRequest?.params.text === '完整文件正文')).toBe(true);
  expect(events.some(e => e.timeSpent !== undefined || e.itemsGained !== undefined)).toBe(false);
  setModel('{"workspaceRequest":{"method":"files.write","params":{"path":"drafts/turn/a.txt","expectedVersion":null,"text":"未完成文件');
  response = await handler(request()); events = await read(response);
  expect(events.some(e => e.workspaceRequest)).toBe(false);
  expect(events.some(e => e.toolError?.kind === 'format' && /文件.*不完整/.test(e.toolError.message))).toBe(true);
  expect(events.some(e => e.document)).toBe(false);
});

it.each([['JSON', action], ['SSE', stream]] as const)('preserves malformed terminal documents for host correction rather than aborting %s', async (name, handler) => {
 const raw=JSON.stringify({segments:[{type:'narration',text:'她完成草稿。'}],documents:[{key:'report',title:'报告',format:'text',artifactRef:{path:'drafts/turn/report.txt',version:'not-a-real-version'}}]});
 vi.mocked(callAi).mockResolvedValue({content:raw,usage,elapsedMs:1});
 vi.mocked(callAiStream).mockImplementation(async req=>{req.onChunk(raw);req.onDone(raw,usage);});
 const response=await handler(request());
 const result=name==='JSON'?await response.json():(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).find(e=>e.type==='done');
 expect(response.status).toBe(200);
 expect(result?.documents?.[0].artifactRef.version).toBe('not-a-real-version');
 expect(result?._tokenUsage.totalTokens).toBe(20);
});
