import { describe, expect, it } from 'vitest';
import { buildNpcDossiers, getDossierEntries } from '@/lib/game/npc-dossiers';
import type { EncyclopediaEntry, WorldLineNode } from '@/lib/game/types';
const time = { day: 2, hour: 9, minute: 30 };
const makeNode = (id: string, parentId: string | null, visible: string, rest = ''): WorldLineNode => ({
  id, parentId, childIds: [], stepNumber: 1, aiResponse: visible + rest, playerVisibleText: visible,
  playerInput: '调查', summary: '隐藏结论', snapshotHash: id, segmentHash: '', createdAt: 1,
  gameTime: time, sceneId: 'dock', sceneName: '渡口', dayNumber: 2, timeSpent: time,
  worldImpacts: ['幕后计划'], generationComplete: true,
});
const entry = (name = '林', description = '观测局记录员。', knowledge: string[] = []): EncyclopediaEntry => ({
  id: `enc-${name}`, name, type: 'npc', description, knowledge: knowledge.map(text => ({ text, source: 'ai', addedAt: time, importance: 50 })),
  firstEncountered: time, lastUpdated: time, relatedEntries: [],
});

describe('player character dossiers', () => {
  it('uses only the current ancestry and read text, including partial dialogue', () => {
    const a = makeNode('a', null, '「林：明天见。');
    const b = makeNode('b', 'a', '你离开渡口。');
    const other = makeNode('other', 'a', '「赵：另一分支。」');
    const result = buildNpcDossiers({ nodes: { a, b, other }, currentId: 'b', entriesByNode: { a: [entry()], b: [entry()], other: [entry('赵')] }, candidateNames: ['林', '赵', '未遇见的人'] });
    expect(result.map(dossier => dossier.name)).toEqual(['林']);
    expect(result[0].contacts[0]).toMatchObject({ quote: '「林：明天见。', dialogue: true, nodeId: 'a', sceneName: '渡口' });
    expect(JSON.stringify(result)).not.toMatch(/另一分支|隐藏结论|幕后计划/);
  });
  it('waits for the evidence to be read before showing public knowledge', () => {
    const a = makeNode('a', null, '林在记录钟声。', '\n\n「林：我是观测局记录员。负责异常记录。」');
    const facts = entry('林', '观测局记录员。', ['负责异常记录。']);
    const build = (node: WorldLineNode) => buildNpcDossiers({ nodes: { a: node }, currentId: 'a', entriesByNode: { a: [facts] } })[0];
    expect(build(a).description).toBeUndefined();
    expect(build(a).knowledge).toEqual([]);
    const read = build({ ...a, playerVisibleText: a.aiResponse });
    expect(read.description?.text).toBe('观测局记录员。');
    expect(read.knowledge[0].source.nodeId).toBe('a');
  });
  it('does not promote an interrupted parent’s hidden facts through a fully read child', () => {
    const a = { ...makeNode('a', null, '林正在擦桌子。'), generationComplete: false };
    const b = makeNode('b', 'a', '林和你约好了晚上见。');
    const result = buildNpcDossiers({ nodes: { a, b }, currentId: 'b', entriesByNode: { a: [entry('林', '秘密身份。', ['未读秘密'])], b: [entry('林', '秘密身份。', ['未读秘密', '约好了晚上见。'])] } })[0];
    expect(result.description).toBeUndefined();
    expect(result.knowledge.map(fact => fact.text)).toEqual(['约好了晚上见。']);
  });
  it('allows an exact visible fact before the remaining segments, then retains it on refocus', () => {
    const a = makeNode('a', null, '林是观测局记录员。', '\n\n未读秘密。');
    const result = buildNpcDossiers({ nodes: { a }, currentId: 'a', entriesByNode: { a: [entry('林', '观测局记录员。', ['未读秘密。'])] } })[0];
    expect(result.description?.text).toBe('观测局记录员。');
    expect(result.knowledge).toEqual([]);
  });
  it('does not reveal legacy biographies or linked world lore just because the first encounter was fully read', () => {
    const a = makeNode('a', null, '「林：早上好。」桌上放着一封信。');
    const letter = { ...entry('一封信', '这封信揭穿了未来的阴谋。'), type: 'item' as const };
    const npc = { ...entry('林', '林是组织首领。', ['林会背叛玩家。']), relatedEntries: [letter.id] };
    const b = makeNode('b', 'a', '林是组织首领。');
    const input = { nodes: { a, b }, entriesByNode: { a: [npc, letter], b: [npc, letter] } };
    const first = buildNpcDossiers({ ...input, currentId: 'a' })[0];
    expect(first.description).toBeUndefined();
    expect(first).toMatchObject({ knowledge: [], related: [] });
    expect(buildNpcDossiers({ ...input, currentId: 'b' })[0].description).toMatchObject({ text: '林是组织首领。', source: { nodeId: 'b' } });
  });
  it('does not infer hidden facts when an ancestor snapshot is unavailable', () => {
    const a = makeNode('a', null, '林正在擦桌子。', '\n\n未读秘密。');
    const b = makeNode('b', 'a', '「林：晚上见。」');
    const result = buildNpcDossiers({ nodes: { a, b }, currentId: 'b', entriesByNode: { b: [entry('林', '秘密身份。')] } })[0];
    expect(result.description).toBeUndefined();
  });
  it('links discovered items and keeps reader notes scoped to the selected branch', () => {
    const a = { ...makeNode('a', null, '林交给你一封信。封口带有红色火漆。'), playerNpcNotes: { 林: '检查笔迹' } };
    const b = { ...makeNode('b', 'a', '「林：这封信来自钟楼。」'), playerNpcNotes: { 林: '' } };
    const other = { ...makeNode('other', 'a', '林去了集市。'), playerNpcNotes: { 林: '另一分支的猜测' } };
    const item = { ...entry('一封信', '封口带有红色火漆。'), type: 'item' as const };
    const npc = { ...entry(), relatedEntries: [item.id] };
    const input = { nodes: { a, b, other }, entriesByNode: { a: [npc, item], b: [npc, item] } };
    expect(buildNpcDossiers({ ...input, currentId: 'a' })[0].note).toBe('检查笔迹');
    expect(buildNpcDossiers({ ...input, currentId: 'b' })[0].note).toBe('');
    expect(buildNpcDossiers({ ...input, currentId: 'b' })[0].related[0]).toMatchObject({ name: '一封信', text: '封口带有红色火漆。' });
  });
  it('projects existing NPC public knowledge without exposing internal state', () => {
    const result = getDossierEntries({ encyclopedia: [], npcMemory: { version: 'npc_memory_v1', records: {
      林: { name: '林', state: '幕后状态', relationship: { affinity: 99, trust: 88 } as never,
        behavior: { currentActivity: '暗中销毁证据' } as never, personality: { coreDesires: ['隐藏欲望'] } as never,
        playerKnowledge: { entryId: '林', description: '记录员', knowledge: [], firstEncountered: time, lastUpdated: time, relatedEntries: [] } },
    } } });
    expect(result[0].description).toBe('记录员');
    expect(JSON.stringify(result)).not.toMatch(/幕后|暗中|欲望|affinity|trust|personality/);
  });
});
