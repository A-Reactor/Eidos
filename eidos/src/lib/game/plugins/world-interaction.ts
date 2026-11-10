import type { GameStore } from '@/store/game-store';
import { buildPlayerMap } from '../player-map';
import { getSceneById } from '../scene-utils';
import { allowedFields, record, text } from './validation';

export interface ModScene {
  id: string; name: string; description: string;
  npcs: Array<{ id: string; name: string }>;
  exits: Array<{ id: string; name: string; blocked: boolean }>;
  objects: Array<{ id: string; name: string; description: string }>;
  actions: string[];
  quests: Array<{ id: string; title: string; description: string; status: string }>;
}
type SceneSource = Pick<GameStore, 'currentWorld' | 'currentSceneId' | 'visitedScenes' | 'availableActions' | 'clues' | 'questLog'>;
/** A view of public world facts, never an alternate inventory, NPC simulation or quest ledger. */
export function buildModScene(state: SceneSource): ModScene | null {
  const world = state.currentWorld, current = getSceneById(world, state.currentSceneId);
  if (!world || !current) return null;
  const map = buildPlayerMap(world, current.id, state.visitedScenes);
  return {
    id: current.id, name: current.name, description: current.initialDescription,
    npcs: [...new Set(current.npcs)].map(id => ({ id, name: id })),
    exits: map.paths.filter(p => p.from === current.id).map(p => ({ id: p.to, name: map.places.find(place => place.id === p.to)!.name, blocked: p.blocked === true })),
    objects: state.clues.filter(c => c.discovered && c.sceneId === current.id).map(c => ({ id: c.id, name: c.name, description: c.description })),
    actions: [...state.availableActions],
    quests: state.questLog.map(q => ({ id: q.id, title: q.title, description: q.description, status: q.status })),
  };
}
/** Structured map controls enter the exact same narrative pipeline as typed player actions. */
export function worldInteractionInput(input: unknown, scene: ModScene, inventory: Array<{ id: string; name: string; quantity: number }>): string {
  const value = record(input); allowedFields(value, ['kind', 'targetId', 'itemId', 'text']);
  const target = value.targetId, npc = scene.npcs.find(n => n.id === target), object = scene.objects.find(o => o.id === target);
  if (value.kind === 'talk' && npc) return value.text === undefined ? `与${npc.name}交谈。` : `向${npc.name}说：${text(value.text, 19_000)}`;
  if (value.kind === 'inspect' && object) return `仔细调查${object.name}。`;
  if (value.kind === 'travel') {
    const exit = scene.exits.find(e => e.id === target);
    if (!exit || exit.blocked) throw new Error('当前没有可以通过的这条通路');
    return `沿当前已知通路前往${exit.name}。`;
  }
  if (value.kind === 'action' && typeof target === 'string' && scene.actions.includes(target)) return target;
  if (value.kind === 'use') {
    const item = inventory.find(i => i.id === value.itemId && i.quantity > 0);
    if (!item || target !== undefined && !npc && !object) throw new Error('物品或交互对象不在当前世界状态中');
    return `对${npc?.name ?? object?.name ?? scene.name}使用${item.name}。`;
  }
  if (value.kind === 'custom') return text(value.text, 20_000);
  throw new Error('当前没有这个交互对象或行动，请刷新场景后重试');
}
