import { describe, expect, it } from 'vitest';
import { createRpgSnapshot } from '@/lib/game/action-runtime/initial-state';
import { courtyardWorld } from '../../../../dev/engine-game/world';
import { applyMapUpdates } from '@/lib/game/map-state';

describe('public RPG initial snapshot', () => {
  it('selects the default or explicit scene and initializes real plugin ledgers', () => {
    const world = courtyardWorld(), snapshot = createRpgSnapshot({ world, playerName: '旅人' });
    expect(snapshot).toMatchObject({ worldId: world.id, currentSceneId: 'hall', playerName: '旅人', currentGameTime: { day: 0, hour: 8, minute: 0 },
      historyLength: 0, visitedScenes: ['hall'], inventory: [], npcMemory: { version: 'npc_memory_v1', records: {} },
      gameplayResources: { 'gameplay.courtyard.keys': 0, 'gameplay.courtyard.stamina': 5 }, gameplayModState: { courtyard: {} } });
    expect(createRpgSnapshot({ world, playerName: '旅人', sceneId: 'garden' }).currentSceneId).toBe('garden');
  });

  it('preserves zero time and authored state defaults and isolates every mutable container', () => {
    const world = courtyardWorld();
    world.gameplayPlugins![0].ui = { html: '<p>door</p>', reading: 'inherit', initialState: { visits: [], progress: 0 } };
    const before = structuredClone(world);
    const first = createRpgSnapshot({ world, playerName: 'A', time: { day: 0, hour: 0, minute: 0 } });
    const second = createRpgSnapshot({ world, playerName: 'B', time: { day: 0, hour: 0, minute: 0 } });
    expect(first.currentGameTime).toEqual({ day: 0, hour: 0, minute: 0 });
    expect(first.gameplayModState?.courtyard).toEqual({ visits: [], progress: 0 });
    (first.gameplayModState!.courtyard.visits as string[]).push('hall');
    first.visitedScenes.push('garden'); first.mapState!.places.hall = { note: '只有 A 看见' };
    expect(second.gameplayModState?.courtyard.visits).toEqual([]);
    expect(second.visitedScenes).toEqual(['hall']);
    expect(second.mapState?.places.hall).toBeUndefined();
    expect(world).toEqual(before);
  });

  it('supports a dynamic scene from the supplied map and starts clues undiscovered', () => {
    let world = courtyardWorld();
    world = applyMapUpdates(world, { places: [{ id: 'attic', name: '阁楼', regionId: 'courtyard', note: '刚发现的入口' }], routes: [{ from: 'hall', to: 'attic', status: 'open', bidirectional: true }] });
    world.clues = [{ id: 'letter', name: '信封', description: '封好的信', sceneId: 'attic', detailThreshold: 10, prerequisiteClues: [], relatedContradiction: '', unlocksClues: [], discovered: true, discoveredAt: { day: 0, hour: 1, minute: 0 } }];
    const snapshot = createRpgSnapshot({ world, playerName: '旅人', sceneId: 'attic' });
    expect(snapshot.currentSceneId).toBe('attic');
    expect(snapshot.mapState?.places.attic.name).toBe('阁楼');
    expect(snapshot.clues[0]).toMatchObject({ discovered: false, discoveredAt: null });
    expect(world.clues[0].discovered).toBe(true);
  });

  it.each([
    { playerName: '' }, { sceneId: 'missing' }, { time: { day: -1, hour: 0, minute: 0 } },
    { time: { day: 0, hour: 24, minute: 0 } }, { time: { day: 0, hour: 0, minute: 0.5 } },
  ])('rejects invalid initial data atomically: %j', invalid => {
    const world = courtyardWorld(), before = structuredClone(world);
    expect(() => createRpgSnapshot({ world, playerName: '旅人', ...invalid })).toThrow();
    expect(world).toEqual(before);
  });

  it('rejects a world without a valid initial scene or valid plugin defaults', () => {
    const world = courtyardWorld(); world.regions = {};
    expect(() => createRpgSnapshot({ world, playerName: '旅人' })).toThrow();
    const bad = courtyardWorld(); bad.gameplayPlugins![0].resources!.keys.initial = 3;
    expect(() => createRpgSnapshot({ world: bad, playerName: '旅人' })).toThrow();
  });
});
