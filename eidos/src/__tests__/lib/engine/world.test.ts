import { describe, expect, it } from 'vitest';
import { applyEngineChanges, buildEngineContext, parseEngineNarrationInput, parseEngineWorld } from '@/lib/engine';
import { courtyardWorld } from './fixtures';

describe('portable game world', () => {
  it('keeps exact host state and returns independent copies', () => {
    const input = courtyardWorld();
    const world = parseEngineWorld(input);
    expect(world.state).toEqual({ keys: 1, alarm: false });
    expect(world.components.guide.state.trust).toBe(0);
    world.state.keys = 0;
    expect(input.state.keys).toBe(1);
  });

  it('projects the current scene and public components without future scene state', () => {
    const context = buildEngineContext({ id: 'one', revision: 0, world: courtyardWorld(), turns: [], receipts: [] });
    expect(context.scene.id).toBe('hall');
    expect(Object.keys(context.components).sort()).toEqual(['clock', 'door', 'guide']);
    expect(Object.keys(context.commands).sort()).toEqual(['talk', 'unlock']);
    expect(JSON.stringify(context)).not.toContain('password');
    expect(context.map.nodes.yard.position).toEqual({ x: 10, y: 0 });
  });

  it('keeps undiscovered places and commands out of the projected map', () => {
    const world = courtyardWorld(); world.map.nodes.yard.discovered = false;
    const context = buildEngineContext({ id: 'one', revision: 0, world, turns: [], receipts: [] });
    expect(context.map.nodes.yard).toBeUndefined();
    expect(context.map.edges.path).toBeUndefined();
  });

  it('keeps a hidden node with an inherited property name and its route out of a round-trippable public context', () => {
    const world = courtyardWorld();
    world.map.nodes = { ...world.map.nodes, ['toString']: { ...world.map.nodes.yard, id: 'toString', discovered: false } };
    delete world.map.nodes.yard;
    world.map.edges.path.to = 'toString';
    world.map.edges.path.blocked = false;
    const context = buildEngineContext({ id: 'one', revision: 0, world, turns: [], receipts: [] });
    expect(Object.keys(context.map.nodes)).toEqual(['entrance']);
    expect(context.map.edges).toEqual({});
    expect(context.commands).not.toHaveProperty('travel');
    expect(parseEngineNarrationInput({ context, input: { text: 'Look' } }).context.map).toEqual(context.map);
    expect(() => parseEngineNarrationInput({ context: { ...context, map: world.map }, input: { text: 'Look' } }))
      .toThrow(/unavailable.*map/i);
  });

  it('rejects an array that stringifies as a valid target kind', () => {
    const world = courtyardWorld();
    world.commands.unlock.target = { kind: ['component'], id: 'door' } as never;
    expect(() => parseEngineWorld(world)).toThrow(/target kind/i);
  });

  it('updates scene, components, topology and world state as one host operation', () => {
    const world = courtyardWorld(), map = structuredClone(world.map);
    map.edges.path.blocked = false;
    const next = applyEngineChanges(world, { state: { keys: 0, alarm: false }, components: [{ ...world.components.door, state: { open: true } }], map, currentSceneId: 'garden' });
    expect(next.currentSceneId).toBe('garden');
    expect(next.state.keys).toBe(0);
    expect(next.components.door.state.open).toBe(true);
    expect(next.map.edges.path.blocked).toBe(false);
    expect(world.components.door.state.open).toBe(false);
    const context = buildEngineContext({ id: 'one', revision: 1, world: next, turns: [], receipts: [] });
    expect(Object.keys(context.components).sort()).toEqual(['clock', 'tree']);
  });

  it('rejects a batch containing a dangling map edge without changing the source', () => {
    const world = courtyardWorld(), map = structuredClone(world.map); map.edges.path.to = 'missing';
    expect(() => applyEngineChanges(world, { state: { keys: 0 }, map })).toThrow(/map|地图/i);
    expect(world.state.keys).toBe(1);
  });

  it('validates component removal against command references', () => {
    expect(() => applyEngineChanges(courtyardWorld(), { removeComponents: ['door'] })).toThrow(/target|目标|component|组件/i);
  });

  it.each([
    (w: ReturnType<typeof courtyardWorld>) => { w.currentSceneId = 'missing'; },
    (w: ReturnType<typeof courtyardWorld>) => { w.components.door.sceneId = 'missing'; },
    (w: ReturnType<typeof courtyardWorld>) => { w.scenes.hall.id = 'other'; },
    (w: ReturnType<typeof courtyardWorld>) => { w.map.edges.path.from = 'missing'; },
  ])('rejects invalid identities and references', mutate => {
    const world = courtyardWorld(); mutate(world);
    expect(() => parseEngineWorld(world)).toThrow();
  });

  it.each([NaN, Infinity, undefined, () => 1, new Date()])('rejects non-JSON host state: %s', value => {
    const world = courtyardWorld();
    expect(() => parseEngineWorld({ ...world, state: { bad: value } })).toThrow();
  });

  it('rejects prototype paths and cyclic state before touching the host', () => {
    expect(() => parseEngineWorld({ ...courtyardWorld(), state: JSON.parse('{"__proto__":{"polluted":true}}') })).toThrow();
    const state: Record<string, unknown> = {}; state.self = state;
    expect(() => parseEngineWorld({ ...courtyardWorld(), state })).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
