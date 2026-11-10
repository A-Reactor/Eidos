import { describe, expect, it } from 'vitest';
import { prepareRpgAction } from '@/lib/game/action-runtime';
import { buildTestSnapshot } from '@/lib/test/fixtures';
import { makeResponse } from '../ai/kei-fixtures';
import { buildNpcMemoryState, projectNpcMemoryState } from '@/lib/game/npc-memory-save';
import type { WorldDefinition } from '@/lib/game/types';

export function smallRpgWorld(): WorldDefinition {
  const scene = (id: string, name: string, connections: string[], npcs: string[] = []) => ({ id, name, region: 'main', initialDescription: name, detailLevel: 10, connections, npcs, secrets: [], discoveredSecrets: [] });
  return { id: 'rpg-test', name: '测试庭院', subtitle: '', overview: '',
    regions: { main: { id: 'main', description: '庭院', scenes: { hall: scene('hall', '门厅', ['garden'], ['守门人']), garden: scene('garden', '庭院', ['hall']) } } },
    npcs: { 守门人: '一位守卫。' }, contradictions: [], history: [], timeline: [], clues: [],
    systemPromptBase: '', identityPrompt: '', isPlayerCreated: true, createdAt: 0,
  };
}
function action(overrides: Parameters<typeof prepareRpgAction>[0]['response'] = makeResponse()) {
  const world = smallRpgWorld(), snapshot = buildTestSnapshot(world);
  return { world, snapshot, response: overrides, actionId: 'action-one', timestamp: 1000, input: '调查庭院门' };
}

describe('shared RPG action preparation', () => {
  it('settles movement, time, inventory, clues and normalized NPC relations without a store', () => {
    const input = action(makeResponse({ sceneChanges: ['garden'], timeSpent: { day: 0, hour: 0, minute: 7 },
      itemsUsed: ['铜钥匙'], itemsGained: [{ id: 'letter', name: '信', description: '一封信', quantity: 1, acquiredFrom: 'hall', acquiredAt: { day: 0, hour: 8, minute: 0 }, category: 'document', consumable: false, value: 0 }],
      npcsReacted: ['守门人：接过钥匙'], relationshipUpdates: [{ npcName: '守门人：接过钥匙', affinityDelta: 5 }], cluesDiscovered: ['clue'],
    }));
    input.snapshot.inventory = [{ id: 'key', name: '铜钥匙', description: '钥匙', quantity: 1, acquiredFrom: 'hall', acquiredAt: input.snapshot.currentGameTime, category: 'key', consumable: true, value: 0 }];
    input.snapshot.clues = [{ id: 'clue', name: '门锁', description: '锁上的字', sceneId: 'hall', detailThreshold: 0, prerequisiteClues: [], relatedContradiction: '', unlocksClues: [], discovered: false, discoveredAt: null }];
    const before = structuredClone(input), result = prepareRpgAction(input);
    expect(result.snapshot.currentSceneId).toBe('garden');
    expect(result.snapshot.currentGameTime).toEqual({ day: 0, hour: 8, minute: 7 });
    expect(result.snapshot.inventory).toMatchObject([{ id: 'letter', value: 0, acquiredAt: { minute: 7 } }]);
    expect(result.snapshot.clues[0].discovered).toBe(true);
    expect(projectNpcMemoryState(result.snapshot.npcMemory).relationships.守门人.affinity).toBe(5);
    expect(result.response.npcsReacted).toEqual(['守门人']);
    expect(result.record).toMatchObject({ id: 'action-one', sceneId: 'garden', sceneName: '庭院', timestamp: 1000 });
    expect(input).toEqual(before);
  });

  it('preserves unified NPC knowledge while updating the same canonical actor', () => {
    const input = action(makeResponse({ segments: [{ type: 'narration', text: '守门人是一位守门的老人。他知道庭院的来历。' }], encyclopediaUpdates: [{ type: 'npc', name: '守门人：点头', description: '守门的老人', knowledge: '他知道庭院的来历' }] }));
    input.snapshot.npcMemory = buildNpcMemoryState({ encyclopedia: [{ id: 'guard', type: 'npc', name: '守门人', description: '原有描述', knowledge: [{ text: '他住在附近', source: 'ai', addedAt: input.snapshot.currentGameTime, importance: 50 }], firstEncountered: input.snapshot.currentGameTime, lastUpdated: input.snapshot.currentGameTime, relatedEntries: [] }] });
    const next = projectNpcMemoryState(prepareRpgAction(input).snapshot.npcMemory);
    expect(next.encyclopedia.find(e => e.name === '守门人')?.knowledge.map(k => k.text)).toEqual(['他住在附近', '他知道庭院的来历']);
    expect(next.encyclopedia.some(e => e.name.includes('点头'))).toBe(false);
  });

  it('keeps world biographies and hidden reaction notes out of first-contact player knowledge', () => {
    const input = action(makeResponse({ segments: [{ type: 'dialogue', speaker: '守门人', text: '早上好。' }],
      npcsReacted: ['守门人：暗中筹备叛乱'], encyclopediaUpdates: [{ type: 'npc', name: '守门人', description: '来自秘密结社', knowledge: '暗中筹备叛乱' }] }));
    input.world.npcs.守门人 = '戴旧帽的守卫，真实身份是叛军首领。';
    const result = prepareRpgAction(input);
    expect(result.world.npcs.守门人).toContain('叛军首领');
    expect(projectNpcMemoryState(result.snapshot.npcMemory).encyclopedia).toMatchObject([
      { name: '守门人', description: '', knowledge: [] },
    ]);
  });

  it('replays generated encyclopedia and item IDs deterministically for the same action', () => {
    const input = action(makeResponse({ encyclopediaUpdates: [{ type: 'concept', name: '铜门', description: '旧门', knowledge: '很重' }] }));
    expect(prepareRpgAction(input)).toEqual(prepareRpgAction(input));
    expect(prepareRpgAction(input).snapshot.encyclopedia.find(e => e.name === '铜门')?.id).toContain('action-one');
  });

  it('keeps document references through inventory settlement', () => {
    const reference = { documentId: 'doc', revision: 'rev' };
    const input = action(makeResponse({ itemsGained: [{ id: 'letter', name: '信', description: '原件', documentRef: reference, quantity: 1, acquiredFrom: 'hall', acquiredAt: { day: 0, hour: 8, minute: 0 }, category: 'document', consumable: false, value: 0 }] }));
    expect(prepareRpgAction(input).snapshot.inventory[0].documentRef).toEqual(reference);
  });

  it.each(['cutaway', 'introspection'])('preserves scene position and exploration in %s mode', mode => {
    const input = action(makeResponse({ sceneChanges: ['garden'], discoveredSecrets: ['不应发现'], narrativeFrame: mode === 'cutaway' ? { kind: 'cutaway' } : undefined }));
    const result = prepareRpgAction({ ...input, introspection: mode === 'introspection' });
    expect(result.snapshot.currentSceneId).toBe('hall');
    expect(result.snapshot.discoveredSecrets).toEqual({});
    expect(result.snapshot.sceneDetailLevels.hall).toBe(10);
  });

  it('uses one plugin rule for resources, author progress and formal facts', () => {
    const input = action(makeResponse({ pluginEvents: [{ pluginId: 'door', ruleId: 'open' }] }));
    input.world.gameplayPlugins = [{ format: 'eidos-gameplay-plugin', version: 2, id: 'door', name: '门', description: '测试门锁', tags: [], prompts: { creation: '', action: '', review: '' }, resources: { keys: { name: '钥匙', min: 0, max: 1, initial: 1, visible: true, unit: '' } },
      rules: [{ id: 'open', description: '打开门', requires: {}, sets: { open: true }, once: true, resourceChanges: { keys: -1 }, effects: { state: [{ op: 'add', path: '/open', value: true }], facts: [{ op: 'add', path: '/open', value: true }] } }],
    }];
    const result = prepareRpgAction(input);
    expect(result.snapshot.gameplayResources?.['gameplay.door.keys']).toBe(0);
    expect(result.snapshot.worldFlags['gameplay.door.open']).toBe(true);
    expect(result.snapshot.gameplayModState?.door.open).toBe(true);
  });

  it('rejects invalid rules before any world, time or inventory mutation', () => {
    const input = action(makeResponse({ pluginEvents: [{ pluginId: 'missing', ruleId: 'spend' }], sceneChanges: ['garden'] })), before = structuredClone(input);
    expect(() => prepareRpgAction(input)).toThrow(); expect(input).toEqual(before);
  });

  it('does not settle a rejected or unfinished tool response', () => {
    for (const response of [makeResponse({ validity: { isPossible: false, reason: '不成立', fantasyResponse: null } }), makeResponse({ toolRequest: { method: 'gameplay.validate', params: { events: [] } } })]) {
      expect(() => prepareRpgAction(action(response))).toThrow();
    }
  });

  it('retains known map on invalid updates and reports the rejection to the host', () => {
    const input = action(makeResponse({ mapUpdates: { routes: [{ from: 'hall', to: 'missing', status: 'open', bidirectional: false }] }, sceneChanges: ['garden'] }));
    const result = prepareRpgAction(input);
    expect(result.snapshot.currentSceneId).toBe('hall');
    expect(result.effects.some(e => e.type === 'map.rejected')).toBe(true);
  });

  it('resolves due timeline events before applying response deviations', () => {
    const input = action(makeResponse({ timeAfter: { day: 0, hour: 9, minute: 0 } }));
    input.world.timeline = [{ id: 'bell', timePoint: { day: 0, hour: 8, minute: 30 }, title: '钟响', region: 'main', sceneId: 'hall', description: '', npcsInvolved: [], defaultOutcome: '', worldFlags: ['bell-rang'], playerModifiable: true, rippleEffects: [] }];
    const result = prepareRpgAction(input);
    expect(result.snapshot.resolvedTimelineEvents).toEqual(['bell']);
    expect(result.snapshot.worldFlags['bell-rang']).toBe(true);
    expect(result.timeSpent).toEqual({ day: 0, hour: 1, minute: 0 });
  });

  it('keeps the rollback record equal to the before snapshot through movement, discovery and timeline settlement', () => {
    const input = action(makeResponse({ sceneChanges: ['garden'], discoveredSecrets: ['门锁背面的刻字'],
      timelineDeviation: { eventId: 'later', newOutcome: '守门人留下了' }, timeAfter: { day: 0, hour: 9, minute: 0 } }));
    input.world.timeline = [{ id: 'bell', timePoint: { day: 0, hour: 8, minute: 30 }, title: '钟响', region: 'main', sceneId: 'hall', description: '', npcsInvolved: [], defaultOutcome: '', worldFlags: ['bell-rang'], playerModifiable: true, rippleEffects: [] }];
    const before = structuredClone(input.snapshot), result = prepareRpgAction(input);
    expect(result.snapshot.visitedScenes).toContain('garden');
    expect(result.snapshot.sceneDetailLevels.hall).toBe(15);
    expect(result.snapshot.discoveredSecrets.hall).toEqual(['门锁背面的刻字']);
    expect(result.snapshot.resolvedTimelineEvents).toEqual(['bell']);
    expect(result.snapshot.deviatedEvents.later).toBe('守门人留下了');
    expect(result.record.snapshot).toEqual(before);
    result.snapshot.visitedScenes.push('host-later');
    result.snapshot.sceneDetailLevels.hall = 99;
    expect(result.record.snapshot).toEqual(before);
  });

  it('accepts narration of a confirmed program result without ticking automation or repeating effects', () => {
    const input = action(makeResponse({ _gameplayResult: { pluginId: 'door', id: 'opened' }, validity: { isPossible: false, reason: '不能重判程序结果', fantasyResponse: null },
      timeSpent: { day: 1, hour: 0, minute: 0 }, sceneChanges: ['garden'], pluginEvents: [{ pluginId: 'unknown', ruleId: 'again' }], itemsUsed: ['铜钥匙'] }));
    input.snapshot.gameplayModState = { door: { _eidosGameplay: { revision: 1, facts: { open: true }, last: { id: 'opened', revision: 1, summary: '程序已经打开门', createdAt: 10, narration: 'pending' } } } };
    input.world.gameplayPlugins = [{ format: 'eidos-gameplay-plugin', version: 1, id: 'door', name: '门', description: '测试结果', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [], ui: { html: '<p>door</p>', reading: 'inherit' } }];
    input.snapshot.gameplayContext = [{ pluginId: 'door', revision: 1, facts: { open: true }, result: { id: 'opened', revision: 1, summary: '程序已经打开门', createdAt: 10, narration: 'pending' } }];
    input.world.timeline = [{ id: 'bell', timePoint: input.snapshot.currentGameTime, title: '钟响', region: 'main', sceneId: 'hall', description: '', npcsInvolved: [], defaultOutcome: '', worldFlags: ['bell-rang'], playerModifiable: true, rippleEffects: [] }];
    const result = prepareRpgAction(input);
    expect(result.snapshot.currentSceneId).toBe('hall');
    expect(result.snapshot.currentGameTime).toEqual(input.snapshot.currentGameTime);
    expect(result.snapshot.weather).toBe(input.snapshot.weather);
    expect(result.snapshot.resolvedTimelineEvents).toEqual([]);
    expect(result.snapshot.worldFlags['bell-rang']).toBeUndefined();
    expect(result.snapshot.gameplayModState?.door).toMatchObject({ _eidosGameplay: { last: { narration: 'complete' } } });
    expect(result.timeSpent).toEqual({ day: 0, hour: 0, minute: 0 });
  });
});
