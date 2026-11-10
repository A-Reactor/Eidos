import type { EngineCommandRequest, EngineComponent, EngineWorld } from '../engine';
import { EngineError, parseEngineWorld } from '../engine';
import { canonical, fields, object, string } from '../engine/validation';
import type { WorldDefinition, WorldSnapshot } from './types';
import { buildPlayerMap } from './player-map';
import { getSceneById } from './scene-utils';

interface Source { world: WorldDefinition; snapshot: WorldSnapshot }
const key = (kind: string, id: string) => `${kind}/${encodeURIComponent(id)}`;
/** Public facts only: author lore, secrets, internal flags and saved unread prose stay in Eidos. */
export function buildEidosEngineWorld({ world, snapshot }: Source): EngineWorld {
  if (world.id !== snapshot.worldId) throw new EngineError('invalid_input', 'Snapshot belongs to another world');
  const liveWorld = { ...world, mapState: snapshot.mapState ?? world.mapState };
  const current = getSceneById(liveWorld, snapshot.currentSceneId);
  if (!current) throw new EngineError('invalid_input', 'Current scene is missing');
  const map = buildPlayerMap(liveWorld, current.id, snapshot.visitedScenes);
  const components: Record<string, EngineComponent> = {}, commands: EngineWorld['commands'] = {};
  const add = (component: EngineComponent, verb: string) => {
    components[component.id] = component;
    const id = key(verb, component.id);
    commands[id] = { id, name: `${verb}: ${component.name}`, target: { kind: 'component', id: component.id } };
  };
  for (const name of current.npcs) add({ id: key('npc', name), kind: 'npc', name, sceneId: current.id, state: {} }, 'talk');
  for (const item of snapshot.inventory.filter(i => i.quantity > 0)) add({ id: key('item', item.id), kind: 'item', name: item.name, description: item.description, state: { quantity: item.quantity, value: item.value, category: item.category } }, 'use');
  for (const clue of snapshot.clues.filter(c => c.discovered && c.sceneId === current.id)) add({ id: key('clue', clue.id), kind: 'clue', name: clue.name, description: clue.description, sceneId: current.id, state: {} }, 'inspect');
  for (const quest of snapshot.questLog) components[key('quest', quest.id)] = { id: key('quest', quest.id), kind: 'quest', name: quest.title, description: quest.description, state: { status: quest.status } };
  const edges = Object.fromEntries(map.paths.map(path => {
    const id = key(path.from, path.to), commandId = key('travel', id);
    commands[commandId] = { id: commandId, name: `前往${map.places.find(p => p.id === path.to)!.name}`, target: { kind: 'mapEdge', id } };
    return [id, { id, from: path.from, to: path.to, blocked: path.blocked === true, state: {} }];
  }));
  const resources: Record<string, number> = {};
  for (const p of world.gameplayPlugins ?? []) for (const [id, r] of Object.entries(p.resources ?? {})) {
    if (r.visible !== false) resources[`gameplay.${p.id}.${id}`] = snapshot.gameplayResources?.[`gameplay.${p.id}.${id}`] ?? r.initial;
  }
  return parseEngineWorld({ id: world.id, name: world.name, currentSceneId: current.id,
    state: { playerName: snapshot.playerName, gameTime: snapshot.currentGameTime, resources, ...(snapshot.weather ? { weather: snapshot.weather } : {}) },
    scenes: Object.fromEntries(map.places.map(place => [place.id, { id: place.id, name: place.name, ...(place.id === current.id ? { description: current.initialDescription } : {}), state: { visited: place.visited } }])),
    components, commands, map: { nodes: Object.fromEntries(map.places.map(p => [p.id, { id: p.id, name: p.name, sceneId: p.id, state: { visited: p.visited } }])), edges },
  });
}
/** The existing game's own action pipeline remains the authority for this adapter. */
export function engineCommandToPlayerInput(request: EngineCommandRequest, source: Source): string {
  const world = buildEidosEngineWorld(source), command = world.commands[request.commandId];
  if (!command || canonical(command.target) !== canonical(request.target)) throw new EngineError('invalid_input', 'Unknown game command or target');
  const args = object(request.args); fields(args, ['text']);
  const text = args.text === undefined ? undefined : string(args.text);
  if (command.target.kind === 'mapEdge') {
    const edge = world.map.edges[command.target.id];
    if (edge.blocked || edge.from !== world.currentSceneId) throw new EngineError('invalid_input', 'Route is not available');
    return `沿当前已知通路前往${world.map.nodes[edge.to].name}。`;
  }
  if (command.target.kind !== 'component') throw new EngineError('invalid_input', 'Unsupported game command target');
  const component = world.components[command.target.id];
  if (component.kind === 'npc') return text ? `向${component.name}说：${text}` : `与${component.name}交谈。`;
  if (component.kind === 'clue') return `仔细调查${component.name}。`;
  return `使用${component.name}${text ? `：${text}` : '。'}`;
}
