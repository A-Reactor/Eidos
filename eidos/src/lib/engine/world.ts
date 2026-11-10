import type { EngineChanges, EngineCommand, EngineMap, EngineTarget, EngineWorld } from './types';
import { canonical, fields, identifier, invalid, jsonObject, list, object, string } from './validation';
import { changesShape, worldShape } from './input';

const sceneFields = ['name', 'description', 'visible', 'state'];
const componentFields = ['kind', 'name', 'description', 'sceneId', 'visible', 'enabled', 'state'];

function entity(raw: unknown, allowed: string[]): Record<string, unknown> {
  const value = object(raw); fields(value, ['id', ...allowed]); identifier(value.id);
  for (const key of ['visible', 'enabled', 'discovered', 'blocked', 'bidirectional']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') invalid(`Invalid ${key}`);
  }
  if (value.name !== undefined) string(value.name, 'name');
  if (value.description !== undefined && typeof value.description !== 'string') invalid('Invalid description');
  if (allowed.includes('state')) value.state = value.state === undefined ? {} : jsonObject(value.state);
  return value;
}
function table(raw: unknown, allowed: string[], validate: (v: Record<string, unknown>) => void): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object(raw)).map(([key, entry]) => {
    identifier(key); const value = entity(entry, allowed);
    if (value.id !== key) invalid(`Entity key does not match id: ${key}`);
    validate(value); return [key, value];
  }));
}
export function parseEngineTarget(raw: unknown, world?: EngineWorld): EngineTarget {
  const value = object(raw); fields(value, value.kind === 'world' ? ['kind'] : ['kind', 'id']);
  if (value.kind === 'world') return { kind: 'world' };
  const { kind } = value;
  if (kind !== 'scene' && kind !== 'component' && kind !== 'mapNode' && kind !== 'mapEdge') invalid('Invalid target kind');
  const id = identifier(value.id);
  const source = world && ({ scene: world.scenes, component: world.components, mapNode: world.map.nodes, mapEdge: world.map.edges }[kind]);
  if (source && !Object.hasOwn(source, id)) invalid(`Unknown target ${kind}: ${id}`);
  return { kind, id };
}
function checkScene(scene: Record<string, unknown>) {
  string(scene.name, 'scene name');
}
function checkComponent(component: Record<string, unknown>, scenes?: Record<string, unknown>) {
  identifier(component.kind); string(component.name, 'component name');
  if (component.sceneId !== undefined) {
    const sceneId = identifier(component.sceneId);
    if (scenes && !Object.hasOwn(scenes, sceneId)) invalid('Component scene does not exist');
  }
}
function readMap(raw: unknown, scenes?: Record<string, unknown>) {
  const map = object(raw ?? { nodes: {}, edges: {} }); fields(map, ['nodes', 'edges']);
  const nodes = table(map.nodes, ['name', 'sceneId', 'position', 'discovered', 'state'], n => {
    string(n.name, 'map node name');
    const sceneId = identifier(n.sceneId);
    if (scenes && !Object.hasOwn(scenes, sceneId)) invalid('Map scene does not exist');
    if (n.position !== undefined) {
      const p = object(n.position); fields(p, ['x', 'y', 'z']);
      if (![p.x, p.y, ...(p.z === undefined ? [] : [p.z])].every(v => typeof v === 'number' && Number.isFinite(v))) invalid('Invalid map position');
    }
  });
  const edges = table(map.edges, ['from', 'to', 'bidirectional', 'blocked', 'discovered', 'state'], e => {
    if (!Object.hasOwn(nodes, identifier(e.from)) || !Object.hasOwn(nodes, identifier(e.to)) || e.from === e.to) invalid('Invalid map edge');
  });
  return { nodes, edges };
}
function readCommands(raw: unknown, world?: EngineWorld) {
  return table(raw ?? {}, ['name', 'description', 'target', 'parameters', 'enabled'], c => {
    string(c.name, 'command name'); c.target = parseEngineTarget(c.target, world);
    if (c.parameters !== undefined) jsonObject(c.parameters);
  }) as Record<string, EngineCommand>;
}
export function parseEngineWorld(input: unknown): EngineWorld {
  const w = jsonObject(input, { label: 'world', shape: worldShape });
  fields(w, ['id', 'name', 'description', 'currentSceneId', 'state', 'scenes', 'components', 'map', 'commands']);
  identifier(w.id); string(w.name, 'world name');
  if (w.description !== undefined && typeof w.description !== 'string') invalid('Invalid world description');
  w.state = w.state === undefined ? {} : jsonObject(w.state);
  const scenes = table(w.scenes, sceneFields, checkScene);
  if (!Object.hasOwn(scenes, identifier(w.currentSceneId))) invalid('Current scene does not exist');
  if (object(scenes[String(w.currentSceneId)]).visible === false) invalid('Current scene must be visible');
  const components = table(w.components ?? {}, componentFields, c => checkComponent(c, scenes));
  const world = { ...w, scenes, components, map: readMap(w.map, scenes), commands: {} } as unknown as EngineWorld;
  world.commands = readCommands(w.commands, world);
  return world;
}

function readChangeObject(raw: unknown) {
  const change = jsonObject(raw, { label: 'changes', shape: changesShape });
  fields(change, ['state', 'currentSceneId', 'scenes', 'removeScenes', 'components', 'removeComponents', 'map', 'commands']);
  return change;
}

/** Validate an accepted patch's shape when its historical base world is unavailable. */
export function assertStoredEngineChanges(raw: unknown): asserts raw is EngineChanges {
  const change = readChangeObject(raw);
  if (change.state !== undefined) jsonObject(change.state);
  if (change.currentSceneId !== undefined) identifier(change.currentSceneId);
  if (change.map !== undefined) readMap(change.map);
  if (change.commands !== undefined) readCommands(change.commands);
  for (const [upsert, remove, allowed, check] of [
    ['scenes', 'removeScenes', sceneFields, checkScene],
    ['components', 'removeComponents', componentFields, checkComponent],
  ] as const) {
    const seen = new Set<string>();
    for (const entry of change[upsert] === undefined ? [] : list(change[upsert])) {
      const value = entity(entry, allowed), id = identifier(value.id);
      if (seen.has(id)) invalid('Duplicate entity update');
      seen.add(id);
      check(value);
    }
    for (const entry of change[remove] === undefined ? [] : list(change[remove])) {
      const id = identifier(entry);
      if (seen.has(id)) invalid('Conflicting entity removal');
      seen.add(id);
    }
  }
}

export function applyEngineChanges(world: EngineWorld, raw: EngineChanges): EngineWorld {
  const change = readChangeObject(raw);
  const next = { ...world, scenes: { ...world.scenes }, components: { ...world.components } };
  for (const key of ['state', 'currentSceneId', 'map', 'commands'] as const) {
    if (Object.hasOwn(change, key)) Object.assign(next, { [key]: change[key] });
  }
  for (const [upsert, remove] of [['scenes', 'removeScenes'], ['components', 'removeComponents']] as const) {
    const seen = new Set<string>();
    for (const entry of change[upsert] === undefined ? [] : list(change[upsert])) {
      const value = object(entry), id = identifier(value.id);
      if (seen.has(id)) invalid('Duplicate entity update'); seen.add(id);
      Object.assign(next[upsert], { [id]: value });
    }
    for (const entry of change[remove] === undefined ? [] : list(change[remove])) {
      const id = identifier(entry);
      if (seen.has(id) || !Object.hasOwn(next[upsert], id)) invalid('Conflicting or unknown entity removal');
      seen.add(id); delete next[upsert][id];
    }
  }
  return parseEngineWorld(next);
}

export function diffEngineWorld(before: EngineWorld, after: EngineWorld): EngineChanges {
  const from = parseEngineWorld(before), to = parseEngineWorld(after);
  if (from.id !== to.id || from.name !== to.name || from.description !== to.description) {
    invalid('Host projection cannot change world id, name or description');
  }
  const changes: EngineChanges = {};
  if (from.currentSceneId !== to.currentSceneId) changes.currentSceneId = to.currentSceneId;
  if (canonical(from.state) !== canonical(to.state)) changes.state = to.state;
  if (canonical(from.map) !== canonical(to.map)) changes.map = to.map;
  if (canonical(from.commands) !== canonical(to.commands)) changes.commands = to.commands;
  const sceneChanges = diffEntities(from.scenes, to.scenes);
  const componentChanges = diffEntities(from.components, to.components);
  if (sceneChanges.upsert.length) changes.scenes = sceneChanges.upsert;
  if (sceneChanges.remove.length) changes.removeScenes = sceneChanges.remove;
  if (componentChanges.upsert.length) changes.components = componentChanges.upsert;
  if (componentChanges.remove.length) changes.removeComponents = componentChanges.remove;
  return changes;
}

function diffEntities<T>(before: Record<string, T>, after: Record<string, T>) {
  return {
    upsert: Object.entries(after).filter(([id, value]) => !Object.hasOwn(before, id) || canonical(value) !== canonical(before[id])).map(([, value]) => value),
    remove: Object.keys(before).filter(id => !Object.hasOwn(after, id)),
  };
}
export function publicEngineMap(world: EngineWorld): EngineMap {
  const nodes = Object.fromEntries(Object.entries(world.map.nodes).filter(([, n]) => n.discovered !== false && world.scenes[n.sceneId].visible !== false));
  const edges = Object.fromEntries(Object.entries(world.map.edges).filter(([, e]) =>
    e.discovered !== false && Object.hasOwn(nodes, e.from) && Object.hasOwn(nodes, e.to)));
  return { nodes, edges };
}
export function engineTargetAvailable(world: EngineWorld, target: EngineTarget, visibleMap?: EngineMap): boolean {
  if (target.kind === 'world') return true;
  if (target.kind === 'scene') return target.id === world.currentSceneId;
  if (target.kind === 'component') {
    if (!Object.hasOwn(world.components, target.id)) return false;
    const c = world.components[target.id];
    return c.visible !== false && c.enabled !== false && (!c.sceneId || c.sceneId === world.currentSceneId);
  }
  const map = visibleMap ?? publicEngineMap(world);
  if (target.kind === 'mapNode') return Object.hasOwn(map.nodes, target.id) && map.nodes[target.id].sceneId === world.currentSceneId;
  if (!Object.hasOwn(map.edges, target.id)) return false;
  const edge = map.edges[target.id];
  return Boolean(!edge.blocked && (map.nodes[edge.from].sceneId === world.currentSceneId || edge.bidirectional && map.nodes[edge.to].sceneId === world.currentSceneId));
}
