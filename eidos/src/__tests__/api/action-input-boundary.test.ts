import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
const generate = vi.hoisted(() => vi.fn(async (input: { callbacks?: { onDone: (response: { segments: never[] }) => void } }) => {
  const result = { segments: [] };
  input.callbacks?.onDone(result);
  return result;
}));
vi.mock('@/lib/ai/action-handler', () => ({ processPlayerAction: generate }));
vi.mock('@/lib/ai/action-stream', () => ({ processPlayerActionStream: generate }));
import { POST as action } from '@/app/api/game/action/route';
import { POST as stream } from '@/app/api/game/action/stream/route';
const request = (value: unknown, headers: Record<string, string> = {}) => new NextRequest('http://localhost:3000/api/game/action', { method: 'POST', body: JSON.stringify(value), headers });
beforeEach(() => { generate.mockClear(); });
it.each([null, [], { playerInput: 42, snapshot: {} }, { playerInput: '行动', snapshot: 'broken' }, { playerInput: '行动', snapshot: buildRiftCityStartState().snapshot, recentHistory: 'broken' }])('rejects malformed action data before model work', async value => {
  expect((await action(request(value))).status).toBe(400);
  expect((await stream(request(value))).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});
it('rejects cross-site requests before starting generation', async () => {
  const data = { playerInput: '行动', snapshot: buildRiftCityStartState().snapshot };
  for (const route of [action, stream]) {
    expect((await route(request(data, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
  }
  expect(generate).not.toHaveBeenCalled();
});

it('forwards normalized image metadata through JSON and SSE routes without image bytes', async () => {
  const { world, snapshot } = buildRiftCityStartState();
  const image = { id: 'image:fixture', worldId: world.id, type: 'character', targetId: '神秘猫', label: '猫', tags: ['happy', '礼服'], description: '蓝色礼服', available: true,
    imageUrl: 'data:image/png;base64,SHOULD_NOT_REACH_THE_MODEL' };
  for (const route of [action, stream]) {
    const response = await route(request({ playerInput: '问候', world, snapshot, imageCatalog: [image] }));
    expect(response.status).toBe(200); await response.text();
  }
  expect(generate).toHaveBeenCalledTimes(2);
  for (const [input] of generate.mock.calls) {
    expect(input).toMatchObject({ imageCatalog: [{ tags: ['开心', '礼服'], description: '蓝色礼服', available: true }] });
    expect(JSON.stringify(input)).not.toContain('SHOULD_NOT_REACH_THE_MODEL');
  }
});

it('rejects a malformed image catalog before either model path', async () => {
  const data = { playerInput: '行动', snapshot: buildRiftCityStartState().snapshot, imageCatalog: [{ id: 'broken', tags: 'wrong' }] };
  for (const route of [action, stream]) expect((await route(request(data))).status).toBe(400);
  expect(generate).not.toHaveBeenCalled();
});

it('rejects invalid numeric ledgers before both generation paths', async () => {
  const { resourceWorld } = await import('../lib/game/gameplay-resource-fixtures');
  const state = buildRiftCityStartState();
  for (const ledger of [null, [], { 'gameplay.supplies.stamina': -1 }, { 'gameplay.other.stamina': 2 }]) {
    const data = { playerInput: '行动', world: { ...state.world, ...resourceWorld() }, snapshot: { ...state.snapshot, gameplayResources: ledger } };
    expect((await action(request(data))).status).toBe(400);
    expect((await stream(request(data))).status).toBe(400);
  }
  expect(generate).not.toHaveBeenCalled();
});

it('accepts plugin source beyond the old action request limit on both generation paths', async () => {
  const { world, snapshot } = buildRiftCityStartState();
  const html = '<main>' + 'x'.repeat(9_000_000) + '</main>';
  const plugin = { format: 'eidos-gameplay-plugin', version: 1, id: 'large-stage', name: '完整舞台', description: '大型包', tags: [], prompts: { creation: '', action: '', review: '' }, ui: { html, reading: 'replace' } };
  const data = { playerInput: '行动', snapshot, world: { ...world, gameplayPlugins: [plugin] } };
  for (const route of [action, stream]) {
    const response = await route(request(data));
    expect(response.status).toBe(200);
    await response.text();
  }
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ world: expect.objectContaining({ gameplayPlugins: [plugin] }) }));
});
