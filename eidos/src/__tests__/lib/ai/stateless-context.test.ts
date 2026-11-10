import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorldContext, resetSegmentHashes } from '@/lib/ai/context-builder';
import { buildRiftCityMidGameState } from '@/lib/test/fixtures';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { POST } from '@/app/api/game/npc-perspective/route';
import { callDeepSeek, callAi, callAiStream } from '@/lib/ai/client';
import { makeResponse, usage } from './kei-fixtures';
import { resourceWorld } from '../game/gameplay-resource-fixtures';

vi.mock('@/lib/ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/client')>(), callDeepSeek: vi.fn(), callAi: vi.fn(), callAiStream: vi.fn() }));
const { world, snapshot } = buildRiftCityMidGameState();
const options = { world, snapshot, inventory: snapshot.inventory, encyclopedia: snapshot.encyclopedia, clues: snapshot.clues, criticalFacts: snapshot.criticalFacts, protagonistState: { health: '轻伤', mood: '紧张', statusEffects: [], notes: '等待治疗' } };
function complete(prompt: string) {
  expect(prompt).toContain(world.overview);
  expect(prompt).toContain('[test_item_001]');
  expect(prompt).toContain('central_plaza');
  expect(prompt).not.toContain('参考之前的上下文');
}
beforeEach(() => {
  resetSegmentHashes();
  vi.mocked(callDeepSeek).mockReset().mockResolvedValue({ content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 });
  vi.mocked(callAi).mockReset().mockResolvedValue({ content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockReset().mockImplementation(async (options) => { options.onChunk(JSON.stringify(makeResponse())); options.onDone(JSON.stringify(makeResponse()), usage); });
});
describe('independent requests carry complete context', () => {
  it('requests starting possessions in the first observation through both ALICE paths without changing the cached prefix', async () => {
    const opening = { ...options, inventory: [], snapshot: { ...snapshot, inventory: [], historyLength: 1 } };
    await processPlayerAction({ ...opening, playerInput: '（进入世界，观察周围）' });
    await processPlayerActionStream({ ...opening, playerInput: '（进入世界，观察周围）', callbacks: { onDone: vi.fn() } });
    await processPlayerAction({ ...opening, playerInput: '查看窗外' });
    const json = vi.mocked(callAi).mock.calls[0][0], stream = vi.mocked(callAiStream).mock.calls[0][0], ordinary = vi.mocked(callAi).mock.calls[1][0];
    expect(json.promptSections?.dynamicSuffix).toContain('首次入场背包清点');
    expect(stream.promptSections?.dynamicSuffix).toContain('首次入场背包清点');
    expect(json.promptSections?.dynamicSuffix).toContain('itemsGained');
    expect(ordinary.promptSections?.dynamicSuffix).not.toContain('首次入场背包清点');
    expect(json.promptSections?.stablePrefix).toBe(ordinary.promptSections?.stablePrefix);
  });
  it.each([{ historyLength: 2, inventory: [] }, { historyLength: 1, inventory: snapshot.inventory }])('does not register starting possessions again with history/backpack %j', async state => {
    await processPlayerAction({ ...options, inventory: state.inventory, snapshot: { ...snapshot, ...state }, playerInput: '（进入世界，观察周围）' });
    expect(vi.mocked(callAi).mock.calls[0][0].promptSections?.dynamicSuffix).not.toContain('首次入场背包清点');
  });
  it('includes first and repeated state without depending on another request', () => {
    const first = buildWorldContext(options); complete(first);
    expect(first).toContain('轻伤'); expect(first).toContain('等待治疗');
    expect(buildWorldContext(options)).toBe(first);
    expect(buildWorldContext({ ...options, forceFull: true })).toBe(first);
  });
  it('isolates interleaved worlds and restores quantity and location on rewind', () => {
    const first = buildWorldContext(options);
    buildWorldContext({ ...options, world: { ...world, id: 'other', overview: '另一世界概述' } });
    expect(buildWorldContext(options)).toBe(first);
    const changed = buildWorldContext({ ...options, snapshot: { ...snapshot, currentSceneId: 'north_market' }, inventory: snapshot.inventory.map(item => ({ ...item, quantity: 3 })) });
    expect(changed).toContain('north_market'); expect(changed).toContain('x3');
    complete(buildWorldContext(options));
  });
  it('sends complete context through action and streaming boundaries', async () => {
    await processPlayerAction({ ...options, playerInput: '检查怀表', skipKeiStorage: true });
    await processPlayerActionStream({ ...options, playerInput: '检查怀表', callbacks: { onDone: vi.fn() } });
    complete(vi.mocked(callAi).mock.calls[0][0].systemPrompt);
    complete(vi.mocked(callAiStream).mock.calls[0][0].systemPrompt);
  });
  it('sends current numeric resources only after fixed declarations through both ALICE paths', async () => {
    const pluginWorld = { ...world, ...resourceWorld() };
    await processPlayerAction({ ...options, world: pluginWorld, snapshot: { ...snapshot, gameplayResources: { 'gameplay.supplies.stamina': 0 } }, playerInput: '查看体力', skipKeiStorage: true });
    await processPlayerActionStream({ ...options, world: pluginWorld, snapshot: { ...snapshot, gameplayResources: { 'gameplay.supplies.stamina': 2 } }, playerInput: '查看体力', callbacks: { onDone: vi.fn() } });
    const complete = vi.mocked(callAi).mock.calls[0][0], stream = vi.mocked(callAiStream).mock.calls[0][0];
    expect(complete.promptSections?.stablePrefix).toBe(stream.promptSections?.stablePrefix);
    expect(complete.promptSections?.stablePrefix).toContain('"initial":3');
    expect(complete.promptSections?.dynamicSuffix).toContain('"gameplay.supplies.stamina":0');
    expect(stream.promptSections?.dynamicSuffix).toContain('"gameplay.supplies.stamina":2');
  });
  it('sends complete context through the NPC perspective route', async () => {
    const response = await POST(new Request('http://localhost/api/game/npc-perspective', { method: 'POST', body: JSON.stringify({ ...options, npcName: '观测员埃琳娜', _settings: { aliceApiKey: 'fake' } }) }));
    expect(response.status).toBe(200); complete(vi.mocked(callDeepSeek).mock.calls[0][0]);
  });
});
