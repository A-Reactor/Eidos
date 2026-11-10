import { afterEach, expect, it, vi } from 'vitest';
import { generateWorldDataStream, generateWorldTimelineStream } from '@/lib/ai/world-generator';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldTimelineEvent } from '@/lib/game/types';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/world/create/stream/route';
import { POST as timelinePOST } from '@/app/api/world/create/timeline/stream/route';
import { readCreationEvents } from '@/lib/ai/creation-stream';

vi.mock('@/lib/ai/client', async original => ({ ...await original<object>(), recordCreationUsage: vi.fn(() => ({ promptTokens: 1, completionTokens: 1, totalTokens: 2 })) }));
afterEach(() => vi.unstubAllGlobals());
function response(text: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n`);
}
function fixture() {
  const world = structuredClone(buildRiftCityStartState().world);
  for (const [id, region] of Object.entries(world.regions)) {
    region.id = id;
    for (const scene of Object.values(region.scenes)) { scene.detailLevel ??= 10; scene.discoveredSecrets ??= []; }
  }
  return world;
}
const worldText = () => JSON.stringify(fixture());
const generate = (options: Parameters<typeof generateWorldDataStream>[7]) => generateWorldDataStream('雨港中的调查故事', () => {}, () => {}, 'recovery-test', undefined, [], undefined, options);

it('repairs a complete invalid map checkpoint instead of repeatedly reusing it', async () => {
  const broken = JSON.stringify({ ...buildRiftCityStartState().world, regions: { r: { description: '缺少地点' } } });
  const fetch = vi.fn().mockResolvedValue(response(worldText()));
  vi.stubGlobal('fetch', fetch);
  const onReset = vi.fn();
  const result = await generate({ resumeText: broken, onReset });
  expect(result.world.regions).toEqual(fixture().regions);
  expect(fetch).toHaveBeenCalledOnce();
  expect(onReset).toHaveBeenCalledWith('', expect.stringContaining('区域 r 的地点'));
  const messages = JSON.parse(fetch.mock.calls[0][1].body).messages;
  expect(messages.at(-1).content).toContain('输出完整 JSON');
  expect(messages.at(-2).content).toBe(broken);
});

it('carries legacy materials and request-local settings into the unified SSE conversation', async () => {
  const fetch = vi.fn().mockResolvedValue(response(worldText()));
  vi.stubGlobal('fetch', fetch);
  const output = await POST(new NextRequest('http://localhost/api/world/create/stream', { method: 'POST',
    body: JSON.stringify({ concept: '雨港中的调查故事', resumeText: JSON.stringify({ ...fixture(), regions: {} }),
      _settings: { keiEndpoint: 'https://world-recovery.invalid/v1', keiModel: 'world-model', keiApiKey: 'world-test' } }),
  }));
  const events: Array<Record<string, unknown>> = [];
  await readCreationEvents(output, event => { events.push(event); });
  expect(fetch.mock.calls[0][0]).toBe('https://world-recovery.invalid/v1/chat/completions');
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('world-model');
  expect(events.find(event => event.type === 'checkpoint')).toMatchObject({ conversation: { version: 1, complete: false } });
  expect(JSON.parse(fetch.mock.calls[0][1].body).messages.at(-1).content).toContain('旧生成材料');
  expect(events.at(-1)).toMatchObject({ type: 'done', world: { name: fixture().name } });
});

it('normalizes a saved list-shaped map without spending another model request', async () => {
  const world = fixture();
  const text = JSON.stringify({ ...world, regions: Object.values(world.regions).map(region => ({ ...region, scenes: Object.values(region.scenes) })) });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const result = await generate({ resumeText: text });
  expect(result.world.regions).toEqual(world.regions);
  expect(fetch).not.toHaveBeenCalled();
});

it('bounds automatic repair and leaves the latest material available for a later retry', async () => {
  const broken = JSON.stringify({ ...buildRiftCityStartState().world, regions: {} });
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(broken)));
  vi.stubGlobal('fetch', fetch);
  let saved = '';
  const onReset = vi.fn((text: string) => { saved = text; });
  await expect(generate({ onReset, onText: text => { saved = text; } })).rejects.toThrow('修正后仍未通过检查');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onReset).toHaveBeenCalledOnce();
  expect(saved).toBe(broken);
  fetch.mockImplementation(() => Promise.resolve(response(worldText())));
  const result = await generate({ resumeText: saved });
  expect(result.world.name).toBe(buildRiftCityStartState().world.name);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('recovers when a suffix request receives an entire valid world document', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(worldText())));
  const onReset = vi.fn();
  const result = await generate({ resumeText: '{"name":', onReset });
  expect(result.world.name).toBe(buildRiftCityStartState().world.name);
  expect(onReset).toHaveBeenCalledWith(worldText(), expect.stringContaining('完整材料'));
});

it('repairs an invalid timeline checkpoint using the same request-local model settings', async () => {
  const world = buildRiftCityStartState().world, region = Object.values(world.regions)[0], scene = Object.values(region.scenes)[0];
  const event: WorldTimelineEvent = { id: 'wt_001', timePoint: { day: 0, hour: 8, minute: 0 }, title: '开门', region: region.id, sceneId: scene.id,
    description: '门打开了', defaultOutcome: '人们走进市场', npcsInvolved: [], worldFlags: [], playerModifiable: true, rippleEffects: [] };
  const fetch = vi.fn().mockResolvedValue(response(JSON.stringify({ timeline: [event] })));
  vi.stubGlobal('fetch', fetch);
  const settings = { keiEndpoint: 'https://recovery.invalid/v1', keiModel: 'custom-kei', keiApiKey: 'test-recovery' };
  const timeline = await generateWorldTimelineStream(world, () => {}, () => {}, undefined, { resumeText: '{"timeline":[]}', settings });
  expect(timeline).toEqual([event]);
  expect(fetch.mock.calls[0][0]).toBe('https://recovery.invalid/v1/chat/completions');
  expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('custom-kei');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-recovery');
});

it.each([null, {}, { name: '缺少地图' }])('rejects invalid timeline input before calling the model', async world => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const result = await timelinePOST(new NextRequest('http://localhost/api/world/create/timeline/stream', { method: 'POST', body: JSON.stringify({ world }) }));
  expect(result.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
