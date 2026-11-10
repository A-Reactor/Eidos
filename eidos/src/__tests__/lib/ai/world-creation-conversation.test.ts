import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { generateWorldConversationStream, abortWorldConversation } from '@/lib/ai/world-creation-conversation';
import { createWorldCreationSession, type WorldCreationSession } from '@/lib/game/world-creation-session';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { briefFromConcept } from '@/lib/game/world-creation-brief';
import { POST } from '@/app/api/world/create/stream/route';
import { readCreationEvents } from '@/lib/ai/creation-stream';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import { compileWorldCreationConversation } from '@/lib/ai/world-creation-protocol';

const { review } = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock('@/lib/ai/source-reconstruction/acceptance', async original => ({ ...await original<object>(), reviewWorldCreation: review }));
vi.mock('@/lib/ai/client', async original => ({ ...await original<object>(), recordCreationUsage: vi.fn(() => ({ promptTokens: 1, completionTokens: 1, totalTokens: 2 })) }));
const fixture = () => {
  const world = structuredClone(buildRiftCityStartState().world);
  world.timeline = world.timeline.slice(0, 2);
  world.identityOptions = [{ id: 'archivist', name: '档案员', description: '守着一柜旧档案', openingNarrative: '你关上档案柜，晨光落在门边。', startingScene: 'central_plaza' }];
  for (const [id, region] of Object.entries(world.regions)) {
    region.id = id;
    for (const scene of Object.values(region.scenes)) { scene.detailLevel ??= 10; scene.discoveredSecrets ??= []; }
  }
  return world;
};
const operation = (method: string, fields?: object) => ({ toolRequest: { method, params: fields ? { fields } : {} } });
const response = (value: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }] })}\n\n`);
function model(...replies: unknown[]) {
  const fetch = vi.fn(); replies.forEach(reply => fetch.mockResolvedValueOnce(response(reply)));
  vi.stubGlobal('fetch', fetch); return fetch;
}
const input = { concept: '雨港中的调查故事', settings: { keiEndpoint: 'https://creation.invalid/v1', keiApiKey: 'test-only', keiModel: 'creation-model' } };
function pinnedBrief() {
  const brief = briefFromConcept({ form: { name: '', overview: '', culture: '', regions: '', npcs: '林是医师', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' } });
  brief.fields.npcs.required = true;
  return brief;
}
beforeEach(() => { review.mockReset().mockResolvedValue([]); });
afterEach(() => vi.unstubAllGlobals());

it('accepts a complete world with its timeline in one turn without mandatory tools', async () => {
  const fetch = model(fixture());
  const world = await generateWorldConversationStream(input);
  expect(world.timeline).toEqual(fixture().timeline);
  expect(world.regions).toEqual(fixture().regions);
  expect(world.identityOptions).toEqual(fixture().identityOptions);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe('https://creation.invalid/v1/chat/completions');
});

it('interleaves future events, setting fields and plugin configuration in one author conversation', async () => {
  const source = fixture();
  const plugin: GameplayPlugin = { format: 'eidos-gameplay-plugin', version: 1, id: 'test-creation', name: '创作插件', description: '测试', tags: [], rules: [], prompts: { creation: '将本世界设定为舞台实验，配置 stageDraft', action: '', review: '' } };
  const fetch = model(operation('world.update', { timeline: source.timeline, gameModeConfig: { stageDraft: { version: 1 } } }),
    operation('world.update', Object.fromEntries(Object.entries(source).filter(([key]) => ['name', 'subtitle', 'overview', 'regions', 'npcs', 'identityOptions', 'contradictions', 'history', 'clues', 'endings'].includes(key)))),
    operation('world.finish', { gameModeConfig: { stageDraft: { version: 2, title: '已修订' } } }));
  const world = await generateWorldConversationStream({ ...input, skillIds: [plugin.id], gameplayPlugins: [plugin] });
  expect(world.timeline).toEqual(source.timeline);
  expect(world.identityOptions).toEqual(source.identityOptions);
  expect(world.gameModeConfig).toEqual({ stageDraft: { version: 2, title: '已修订' } });
  expect(world.gameplayPlugins?.[0].id).toBe(plugin.id);
  const bodies = fetch.mock.calls.map(call => JSON.parse(call[1].body));
  expect(bodies[2].messages[2].content).toContain('world.update');
  expect(bodies[2].messages[3].content).toContain('"status":"saved"');
  expect(bodies.every(body => body.messages[0].content.includes('stageDraft'))).toBe(true);
  expect(bodies.every(body => body.messages[0].content === bodies[0].messages[0].content)).toBe(true);
  expect(review).not.toHaveBeenCalled();
});

it('can read and validate the current draft before revising and finishing it', async () => {
  const source = fixture();
  const fields = Object.fromEntries(Object.entries(source).filter(([key]) => ['name', 'subtitle', 'overview', 'regions', 'npcs', 'identityOptions', 'contradictions', 'history', 'timeline', 'clues', 'endings'].includes(key)));
  const fetch = model(operation('world.update', fields), { toolRequest: { method: 'world.read', params: { fields: ['timeline', 'name'] } } }, operation('world.validate'), operation('world.finish', { subtitle: '修订的副标题' }));
  const world = await generateWorldConversationStream(input);
  expect(world.subtitle).toBe('修订的副标题');
  const messages = JSON.parse(fetch.mock.calls[3][1].body).messages;
  expect(messages.filter((message: { content: string }) => message.content.includes('"status":"completed"'))).toHaveLength(2);
  expect(messages.find((message: { content: string }) => message.content.includes('"method":"world.read","status"')).content).toContain(source.name);
});

it('keeps plugin timelines explicitly empty but asks for an omitted timeline field', async () => {
  const source = fixture();
  const { timeline: _timeline, ...withoutTimeline } = source;
  const fetch = model(withoutTimeline, operation('world.finish', { timeline: [] }));
  const world = await generateWorldConversationStream(input);
  expect(world.timeline).toEqual([]);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('时间线');
});

it('authors identities as a normal field and corrects invalid starting scenes in the same conversation', async () => {
  const source = fixture();
  const fetch = model({ ...source, identityOptions: [{ ...source.identityOptions![0], startingScene: 'unknown' }] }, operation('world.finish', { identityOptions: source.identityOptions }));
  let saved!: WorldCreationSession;
  const world = await generateWorldConversationStream(input, { onCheckpoint: session => { saved = session; } });
  expect(world.identityOptions).toEqual(source.identityOptions);
  expect(saved.fields.identityOptions).toEqual(source.identityOptions);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('unknown');
});

it('asks only for missing identities, accepts no presets, and preserves completed legacy checkpoints', async () => {
  const { identityOptions: _identities, ...source } = fixture();
  const fetch = model(source, operation('world.finish', { identityOptions: [] }));
  const world = await generateWorldConversationStream(input);
  expect(world.identityOptions).toEqual([]);
  expect(world.overview).toBe(source.overview);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('identityOptions');
  const session = createWorldCreationSession({ world: source as unknown as Record<string, unknown> });
  session.complete = true;
  const noRequest = model();
  expect((await generateWorldConversationStream(input, { session })).name).toBe(source.name);
  expect(noRequest).not.toHaveBeenCalled();
});

it('includes identity guidance in the unified prompt while leaving plugin and source requirements in control', () => {
  const prompt = compileWorldCreationConversation({ ...input, skillGuide: '只允许自定义身份，identityOptions 提交 []。' }).systemPrompt;
  expect(prompt).toContain('"identityOptions"');
  expect(prompt).toContain('身份与开场');
  expect(prompt).toContain('只允许自定义身份');
  expect(prompt).toContain('不单独调用');
  const quick = compileWorldCreationConversation({ ...input, generationProfile: 'quick' }).systemPrompt;
  expect(quick).toContain('通常提供 1–3 个');
});

it('splits a length-limited operation through feedback without attempting to execute its fragment', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"toolRequest":' }, finish_reason: 'length' }] })}\n\n`)).mockResolvedValueOnce(response(fixture()));
  vi.stubGlobal('fetch', fetch);
  const world = await generateWorldConversationStream(input);
  expect(world.name).toBe(fixture().name);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('拆成更小的完整 world.update');
});

it('feeds map errors back to the same author and replaces only the broken field', async () => {
  const source = fixture();
  const fetch = model({ ...source, regions: {} }, operation('world.finish', { regions: source.regions }));
  const world = await generateWorldConversationStream(input);
  expect(world.overview).toBe(source.overview);
  expect(world.timeline).toEqual(source.timeline);
  const messages = JSON.parse(fetch.mock.calls[1][1].body).messages;
  expect(messages[2].content).toContain('"regions":{}');
  expect(messages[3].content).toContain('failed');
  expect(messages[3].content).toContain('central_plaza');
});

it('makes a single scoped review and corrects required conditions without another whole-world review', async () => {
  review.mockResolvedValueOnce([{ code: 'required', message: '医师林必须保留', blocking: true }, { code: 'optional', message: '次要地点留白', blocking: false }]);
  const source = fixture();
  const brief = pinnedBrief();
  const fetch = model(source, operation('world.finish', { npcs: { ...source.npcs, 林: '医师' } }));
  const world = await generateWorldConversationStream({ ...input, brief });
  expect(world.npcs.林).toBe('医师');
  expect(world.creationWarnings).toEqual(['次要地点留白']);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('医师林必须保留');
  expect(review).toHaveBeenCalledOnce();
  expect(review.mock.calls[0][1].timeline).toEqual(source.timeline);
});

it('keeps committed fields and unfinished text on a network failure, then resumes that conversation', async () => {
  const fetch = model(operation('world.update', { name: '雨港', timeline: [] }));
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(stream) {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"toolRequest":' } }] })}\n\n`));
    setTimeout(() => stream.error(new Error('network interrupted')), 0);
  } })));
  let saved!: WorldCreationSession;
  await expect(generateWorldConversationStream(input, { onCheckpoint: value => { saved = value; } })).rejects.toThrow('network interrupted');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(saved.fields).toEqual({ name: '雨港', timeline: [] });
  expect(saved.pendingText).toBe('{"toolRequest":');
  const resumed = model(operation('world.finish', { ...Object.fromEntries(Object.entries(fixture()).filter(([key]) => ['subtitle', 'overview', 'regions', 'npcs', 'identityOptions', 'contradictions', 'history', 'clues', 'endings'].includes(key))) }));
  const world = await generateWorldConversationStream(input, { session: saved });
  expect(world.id).toBe(saved.worldId);
  expect(world.name).toBe('雨港');
  expect(world.timeline).toEqual([]);
  expect(world.identityOptions).toEqual(fixture().identityOptions);
  const messages = JSON.parse(resumed.mock.calls[0][1].body).messages;
  expect(messages.some((message: { content: string }) => message.content === '{"toolRequest":')).toBe(true);
  expect(messages.at(-1).content).toContain('没有执行该片段');
});

it('recovers the validated terminal checkpoint if the final done event was lost', async () => {
  model(fixture()); let saved!: WorldCreationSession;
  const first = await generateWorldConversationStream(input, { onCheckpoint: value => { saved = value; } });
  expect(saved.complete).toBe(true);
  const fetch = model();
  expect((await generateWorldConversationStream(input, { session: saved })).id).toBe(first.id);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not trust an imported completion marker without validating current fields', async () => {
  const saved = createWorldCreationSession(); saved.complete = true; saved.fields = { regions: {} };
  const fetch = model(fixture());
  const world = await generateWorldConversationStream(input, { session: saved });
  expect(world.name).toBe(fixture().name);
  expect(JSON.parse(fetch.mock.calls[0][1].body).messages.at(-1).content).toContain('failed');
});

it('corrects malformed commands and rejects host metadata in field patches', async () => {
  const fetch = model(operation('world.update', { systemPromptBase: 'override' }), '{bad json}', fixture());
  const world = await generateWorldConversationStream(input);
  expect(world.systemPromptBase).not.toBe('override');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content).toContain('不支持的字段');
});

it('stops identical failed operations and retains their feedback for an explicit retry', async () => {
  const fetch = model(operation('world.finish'), operation('world.finish'));
  let saved!: WorldCreationSession;
  await expect(generateWorldConversationStream(input, { onCheckpoint: value => { saved = value; } })).rejects.toThrow('相同问题未能修正');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(saved.complete).toBe(false);
  expect(saved.messages.at(-1)?.content).toContain('failed');
});

it('does not turn review service failures into paid automatic authoring retries', async () => {
  review.mockRejectedValueOnce(new Error('review service offline'));
  const fetch = model(fixture()); let saved!: WorldCreationSession;
  await expect(generateWorldConversationStream({ ...input, brief: pinnedBrief() }, { onCheckpoint: value => { saved = value; } })).rejects.toThrow('review service offline');
  expect(fetch).toHaveBeenCalledOnce();
  expect(saved.fields.name).toBe(fixture().name);
  expect(saved.complete).toBe(false);
});

it('does not spend a separate review call on an ordinary concept brief', async () => {
  const brief = pinnedBrief(); brief.fields.npcs.required = false;
  model(fixture());
  expect((await generateWorldConversationStream({ ...input, brief })).name).toBe(fixture().name);
  expect(review).not.toHaveBeenCalled();
});

it('checks validate operations locally and reviews pinned content only once at finish', async () => {
  const source = fixture();
  const fields = createWorldCreationSession({ world: source as unknown as Record<string, unknown> }).fields;
  model(operation('world.update', fields), operation('world.validate'), operation('world.validate'), operation('world.finish'));
  expect((await generateWorldConversationStream({ ...input, brief: pinnedBrief() })).name).toBe(source.name);
  expect(review).toHaveBeenCalledOnce();
});

it('persists the completed review through an interrupted correction instead of reviewing it again', async () => {
  review.mockResolvedValueOnce([{ code: 'required', message: '医师林必须保留', blocking: true }]);
  const brief = pinnedBrief(), source = fixture();
  const fetch = model(source); fetch.mockRejectedValueOnce(new Error('修正时断流'));
  let saved!: WorldCreationSession;
  await expect(generateWorldConversationStream({ ...input, brief }, { onCheckpoint: value => { saved = value; } })).rejects.toThrow('修正时断流');
  expect(saved.review?.issues[0].message).toBe('医师林必须保留');
  model(operation('world.finish', { npcs: { ...source.npcs, 林: '医师' } }));
  expect((await generateWorldConversationStream({ ...input, brief }, { session: saved })).npcs.林).toBe('医师');
  expect(review).toHaveBeenCalledOnce();
});

it('honors the reasoning switch and rejects oversized conversation context before a billed request', async () => {
  const fetch = model(fixture());
  await generateWorldConversationStream({ ...input, settings: { ...input.settings, keiEnableReasoning: false } as unknown as Record<string, string> });
  // The selected role config is the source of truth; no unconditional max-effort override.
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.max_tokens).toBeLessThan(393216);
  expect(body.thinking).toEqual({ type: 'disabled' });
  expect(body.reasoning_effort).toBeUndefined();
  const saved = createWorldCreationSession();
  saved.messages.push({ role: 'user', content: '一'.repeat(100_000) });
  const noRequest = model();
  await expect(generateWorldConversationStream({ ...input, settings: { ...input.settings, keiContextWindowTokens: 32000 } as unknown as Record<string, string> }, { session: saved })).rejects.toThrow('上下文');
  expect(noRequest).not.toHaveBeenCalled();
});

it('stops an active conversation through the existing stop registry and performs no later turn', async () => {
  const fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))));
  vi.stubGlobal('fetch', fetch);
  const promise = generateWorldConversationStream(input, {}, 'stop-test');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(abortWorldConversation('stop-test')).toBe(true);
  await expect(promise).rejects.toThrow('Stopped');
  expect(abortWorldConversation('stop-test')).toBe(false);
  expect(fetch).toHaveBeenCalledOnce();
});

it('streams conversation checkpoints and a complete world across the actual API boundary', async () => {
  const fetch = model({ ...fixture(), regions: {} }, operation('world.finish', { regions: fixture().regions }));
  const output = await POST(new NextRequest('http://localhost/api/world/create/stream', { method: 'POST', body: JSON.stringify({ concept: input.concept, _settings: input.settings }) }));
  const events: Array<{ type: string; conversation?: WorldCreationSession; message?: string; world?: ReturnType<typeof fixture> }> = [];
  await readCreationEvents(output, event => { events.push(event); });
  expect(events.filter(event => event.type === 'checkpoint').at(-1)?.conversation?.complete).toBe(true);
  expect(events.some(event => event.type === 'progress' && event.message?.includes('修正'))).toBe(true);
  expect(events.at(-1)?.world?.timeline).toEqual(fixture().timeline);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('rejects invalid conversation roles at the API boundary before model work', async () => {
  const fetch = model();
  const conversation = { ...createWorldCreationSession(), messages: [{ role: 'system', content: 'untrusted' }] };
  const result = await POST(new NextRequest('http://localhost/api/world/create/stream', { method: 'POST', body: JSON.stringify({ concept: input.concept, conversation }) }));
  expect(result.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
