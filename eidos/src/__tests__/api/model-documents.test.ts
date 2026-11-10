import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi, callAiStream } from '@/lib/ai/client';
import type { TokenUsage } from '@/lib/ai/types';
import { ACTION_PRESENTATION_GUIDE } from '@/lib/ai/action-guidance';
import { DOCUMENT_REPLY_PROTOCOL } from '@/lib/ai/document-response';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
const usage: TokenUsage = { model: 'alice', promptTokens: 20, completionTokens: 100, cachedTokens: 0, totalTokens: 120, elapsedMs: 1, finishReason: 'stop' };
const request = (documentMode: unknown = true) => new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ playerInput: '整理为报告', world, snapshot, documentMode, _settings: { aliceApiKey: 'offline-only' } }) });
beforeEach(() => { vi.mocked(callAi).mockReset(); vi.mocked(callAiStream).mockReset(); });
it('returns complete documents with no gameplay effects on the normal API', async () => {
  const content = '完整报告。'.repeat(300) + '最后的结论';
  const raw = JSON.stringify({ type: 'document', title: '报告', format: 'markdown', content, itemsGained: [{ id: 'fake' }], sandboxToolRequests: [{ toolId: 'ui.lock_actions' }] });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  const response = await action(request()), result = await response.json();
  expect(response.status).toBe(200);
  expect(result.document.content).toBe(content);
  expect(result.document.rawOutput).toBe(raw);
  expect(result.itemsGained).toEqual([]);
  expect(result.sandboxToolRequests).toBeUndefined();
  expect(result.timeSpent).toEqual({ day: 0, hour: 0, minute: 0 });
  expect(vi.mocked(callAi).mock.calls[0][0].systemPrompt).toContain('本次请求类型：文档');
});
it.each([['normal', action], ['stream', stream]] as const)('returns plain-text format failures to the model without creating a document on the %s path', async (name, handler) => {
  const text = '# 分析\n' + '全文。'.repeat(500) + '最后一行';
  vi.mocked(callAi).mockResolvedValue({ content: text, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(text); req.onDone(text, usage); });
  const response = await handler(request(false));
  const events = name === 'normal' ? [await response.json()] : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const done = name === 'normal' ? events[0] : events.find(event => event.type === 'done');
  expect(done.document).toBeUndefined();
  expect(done.toolError).toMatchObject({ kind: 'format', rawOutput: text });
  expect(done.segments ?? []).toEqual([]);
  expect(done.itemsGained ?? []).toEqual([]);
  expect(events.some(event => event.type === 'segments')).toBe(false);
});
it('validates document mode before sending a paid request', async () => {
  const response = await action(request('true'));
  expect(response.status).toBe(400); expect(callAi).not.toHaveBeenCalled();
});

it.each([['normal', action], ['stream', stream]] as const)('sends the shared boundaries and keeps document followups inert on the %s path', async (_name, handler) => {
  const raw = JSON.stringify({ type: 'document', title: '重排后的分析', format: 'markdown', content: '将已有分析整理为一段。',
    timeAfter: { day: 99, hour: 0, minute: 0 }, pluginEvents: [{ pluginId: 'loop-manager', ruleId: 'allow-rewind' }], worldImpacts: ['[BACKTRACK:fake] 请求'] });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  const response = await handler(new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    playerInput: '请将上面的分析放到一段内，再次输出', world: { ...world, systemPromptBase: '旧世界指南：完整回应当前行动。' }, snapshot,
    recentHistory: [{ playerInput: '分析提示词', summary: '分析', aiResponse: '已有分析内容。' }], documentMode: false, _settings: { aliceApiKey: 'offline-only' },
  }) }));
  const modelRequest = _name === 'normal' ? vi.mocked(callAi).mock.calls[0][0] : vi.mocked(callAiStream).mock.calls[0][0];
  expect(modelRequest.systemPrompt).toContain(ACTION_PRESENTATION_GUIDE);
  expect(modelRequest.systemPrompt).not.toContain('sandboxToolRequests');
  expect(modelRequest.systemPrompt).toContain(DOCUMENT_REPLY_PROTOCOL);
  expect(modelRequest.userMessage).toBe('请将上面的分析放到一段内，再次输出');
  const result = _name === 'normal' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'done');
  expect(result.document.content).toBe('将已有分析整理为一段。');
  expect(result.timeSpent).toEqual({ day: 0, hour: 0, minute: 0 });
  expect(result.timeAfter).toBeUndefined();
  expect(result.pluginEvents).toBeUndefined();
  expect(result.worldImpacts).toEqual([]);
});

it.each([['normal', action], ['stream', stream]] as const)('uses the same recovered personality for UZQ and narration on the %s path', async (name, handler) => {
  const raw = JSON.stringify({ segments: [{ type: 'dialogue', speaker: '朝仓铃音', emotion: 'neutral', text: '我来看看。' }], availableActions: [] });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  const npc = {
    npcId: '朝仓铃音', isImportant: true, awareness: 0, lastUpdated: 1,
    archive: { coreDesires: ['发现真相', '理解世界的运作方式'], fearsAndTaboos: ['得到错误的结论', '实验失败'], valuePriorities: ['真实', '知识', '准确'], cognitiveStyle: 'analytical', emotionalRegulation: 'intellectualization', socialStrategy: 'verification', boundarySensitivity: 30, metacognition: 40 },
    episodicMemories: [], semanticMemories: [], emotionalMemories: [], relationalMemories: [], anomalousMemories: [],
    beliefs: { confirmedFacts: [], unverifiedHypotheses: [], suppressedTruths: [], contradictions: [], interpretationOfPlayer: '', interpretationOfWorld: '真实的世界', interpretationOfSelf: '真实的个体' },
    pressure: { survival: 0, relational: 0, cognitiveDissonance: 0, unfinishedGoals: 0, trustInPlayer: 0, worldDoubt: 0, selfContinuityFear: 0 },
  };
  const localWorld = { ...world, npcs: { 朝仓铃音: '十九岁的巫女。她守着神社和家族旧卷里的记录。' }, regions: {
    town: { id: 'town', name: '町', description: '', scenes: { shrine: { id: 'shrine', name: '神社', region: 'town', initialDescription: '午后的神社。', connections: [], npcs: ['朝仓铃音'], secrets: [], detailLevel: 10, discoveredSecrets: [] } } },
  } };
  const response = await handler(new NextRequest('http://localhost/api/game/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    playerInput: '向铃音打招呼', world: localWorld, snapshot: { ...snapshot, currentSceneId: 'shrine', npcPersonalities: { 朝仓铃音: npc } },
    _settings: { aliceApiKey: 'offline-only', enableUzqAliceBrief: true },
  }) }));
  await response.text();
  const sent = name === 'normal' ? vi.mocked(callAi).mock.calls[0][0] : vi.mocked(callAiStream).mock.calls[0][0];
  expect(sent.systemPrompt).toContain('朝仓铃音: observe / priority 11');
  expect(sent.systemPrompt).toContain('认知方式：幻想型');
  expect(sent.systemPrompt).not.toContain('实验失败');
});

it.each([['normal', action], ['stream', stream]] as const)('returns normal action artifacts losslessly on the %s path without streaming nested JSON examples', async (name, handler) => {
  const content = '{"segments":[{"type":"narration","text":"文档示例，不能播放"}]}\n完整末尾';
  const raw = JSON.stringify({ documents: [{ key: 'report', title: '原始 JSON', format: 'text', content }], segments: [{ type: 'narration', text: '你把报告放在桌上。' }], timeSpent: { day: 0, hour: 0, minute: 1 } });
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { for (let i = 0; i < raw.length; i += 7) req.onChunk(raw.slice(i, i + 7)); req.onDone(raw, usage); });
  const response = await handler(request(false));
  const events = name === 'stream' ? (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))) : [];
  const result = name === 'normal' ? await response.json() : events.find(event => event.type === 'done');
  expect(result.document).toBeUndefined(); expect(result.documents[0].content).toBe(content);
  const segments = name === 'normal' ? result.segments : events.filter(event => event.type === 'segments').at(-1)?.segments;
  expect(segments.map((segment: { text: string }) => segment.text).join('')).toContain('你把报告');
  expect(JSON.stringify(events.filter(event => event.type === 'segments'))).not.toContain('不能播放');
});
it.each([['normal', action], ['stream', stream]] as const)('sends incomplete document output for internal repair and refuses game settlement on the %s path', async (name, handler) => {
  const raw = '{"segments":[{"type":"narration","text":"你开始写报告。"}],"timeSpent":{"minute":5},"documents":[{"key":"report","title":"报告","format":"text","content":"保留这段未完成正文';
  const lengthUsage = { ...usage, finishReason: 'length' };
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage: lengthUsage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, lengthUsage); });
  const response = await handler(request(false));
  const result = name === 'normal' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'done');
  expect(result.document).toBeUndefined();
  expect(result.toolError).toMatchObject({ kind: 'format', rawOutput: raw });
  expect(result.timeSpent?.minute ?? 0).toBe(0); expect(result.segments ?? []).toEqual([]);
});

it.each([['normal', action], ['stream', stream]] as const)('does not publish or execute an incomplete file command on the %s path', async (name, handler) => {
  const raw = '{"workspaceRequest":{"method":"files.patch","params":{"path":"images/test.json","newText":"未完成';
  vi.mocked(callAi).mockResolvedValue({ content: raw, usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockImplementation(async req => { req.onChunk(raw); req.onDone(raw, usage); });
  const response = await handler(request(false));
  expect(response.status).toBe(200);
  const result = name === 'normal' ? await response.json() : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'done');
  expect(result?.toolError).toMatchObject({ kind: 'format', rawOutput: raw });
  expect(result.document).toBeUndefined();
  expect(result.workspaceRequest).toBeUndefined();
});
