import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it } from 'vitest';
import { importCardAsset, loadCardAsset } from '@/lib/game/cards/storage';
import { buildCardActionContext } from '@/lib/game/cards/context';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { validateCardContext } from '@/lib/game/cards/validation';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { buildRiftCityMidGameState } from '@/lib/test/fixtures';
import { _resetDB } from '@/lib/game/storage';

afterAll(_resetDB);
describe('local card action path', () => {
  it('stores exact source bytes and unknown fields across a database reopen', async () => {
    const bytes = new TextEncoder().encode('{ "name":"林", "description":"甲\\n  乙", "author_extra": {"x":"\\\\n"} }\n');
    const asset = await importCardAsset(bytes, 'original.json'); _resetDB();
    const restored = await loadCardAsset(asset.id);
    expect(Array.from(restored!.originalBytes)).toEqual(Array.from(bytes));
    expect(restored!.data.description).toBe('甲\n  乙');
    expect(restored!.document.author_extra).toEqual({ x: '\\n' });
    expect((await importCardAsset(bytes, 'duplicate.json')).id).toBe(asset.id);
  });
  it('records an inactive character card and accepts its real root pointer in API diagnostics', async () => {
    const asset = await importCardAsset(new TextEncoder().encode(JSON.stringify({ name: '林', description: '人物原文' })), 'character.json');
    const { snapshot } = buildRiftCityMidGameState(), world = mountCardWorld({ asset, role: 'character' });
    const context = await buildCardActionContext({ world, snapshot, playerInput: '查看灯', initial: false });
    expect(context?.selected).toEqual([]);
    expect(context?.omitted[0]).toMatchObject({ assetId: asset.id, pointer: '', reason: '人物用途本轮未启用：角色不在场且未被玩家点名' });
    expect(() => validateCardContext(context, world.cardBindings)).not.toThrow();
  });
  it('injects selected raw lore into the complete prompt and excludes it from introspection', async () => {
    const asset = await importCardAsset(new TextEncoder().encode(JSON.stringify({ name: '世界', description: '长期规则\n  缩进', first_mes: '原始开场证据', character_book: { entries: [
      { keys: ['金箔'], content: '金箔真相', enabled: true }, { keys: ['书柜'], content: '书柜真相', enabled: true },
    ] } })), 'world-card.json');
    const { snapshot } = buildRiftCityMidGameState();
    const world = mountCardWorld({ asset, role: 'world' });
    const current = { ...snapshot, worldId: world.id, currentSceneId: 'card_start', historyLength: 1 };
    const cardContext = await buildCardActionContext({ world, snapshot: current, playerInput: '检查金箔' });
    const prompt = buildWorldContextSections({ world, snapshot: current, cardContext });
    expect(prompt.stablePrefix).toContain('长期规则\n  缩进');
    expect(prompt.dynamicSuffix).toContain('金箔真相');
    expect(prompt.dynamicSuffix).not.toContain('书柜真相');
    expect(prompt.dynamicSuffix).not.toContain('原始开场证据');
    const first = await buildCardActionContext({ world, snapshot: { ...current, inventory: [] }, playerInput: '（进入世界，观察周围）' });
    expect(first?.dynamicSuffix).toContain('原始开场证据');
    expect(await buildCardActionContext({ world, snapshot: current, playerInput: '秘密是什么', introspection: true })).toBeUndefined();
    await expect(buildCardActionContext({ world: { ...world, cardBindings: [{ ...world.cardBindings![0], assetId: 'b'.repeat(64) }] }, snapshot: current, playerInput: '走' })).rejects.toThrow(/资源缺失/);
  });
});
