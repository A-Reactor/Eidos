import type { GameTime, WorldDefinition, WorldSnapshot } from '../types';
import { getSceneById } from '../scene-utils';
import { emptyMapState } from '../map-state';
import { normalizeGameplayResources } from '../plugins/resources';
import { normalizeGameplayModState } from '../plugins/mod-ui';

export interface RpgSnapshotOptions {
  world: WorldDefinition;
  playerName: string;
  sceneId?: string;
  time?: GameTime;
}

/** Initialize owned data only; personalities, persistence and model calls belong to the host. */
export function createRpgSnapshot(options: RpgSnapshotOptions): WorldSnapshot {
  const { world, playerName, sceneId, time = { day: 0, hour: 8, minute: 0 } } = structuredClone(options);
  if (!world || typeof world.id !== 'string' || !world.id.trim() || typeof playerName !== 'string' || !playerName.trim()) throw new Error('初始化需要有效的世界和玩家名称');
  if (!time || ![time.day, time.hour, time.minute].every(Number.isSafeInteger) || time.day < 0 || time.hour < 0 || time.hour > 23 || time.minute < 0 || time.minute > 59
    || !Number.isSafeInteger((time.day * 24 + time.hour) * 60 + time.minute)) throw new Error('初始游戏时间无效');
  const initialId = sceneId ?? Object.values(world.regions).flatMap(region => Object.values(region.scenes))[0]?.id;
  const scene = initialId ? getSceneById(world, initialId) : null;
  if (!scene) throw new Error('初始场景不属于当前世界');
  return {
    worldId: world.id, playerName: playerName.trim(), currentSceneId: scene.id, currentGameTime: time,
    sceneNarrative: scene.initialDescription, historyLength: 0, mapState: world.mapState ?? emptyMapState(),
    discoveredSecrets: {}, worldFlags: {}, sceneDetailLevels: { [scene.id]: scene.detailLevel ?? 10 }, visitedScenes: [scene.id],
    resolvedTimelineEvents: [], deviatedEvents: {}, inventory: [],
    clues: world.clues.map(clue => ({ ...clue, discovered: false, discoveredAt: null })), encyclopedia: [], availableActions: [], criticalFacts: [], questLog: [],
    npcMemory: { version: 'npc_memory_v1', records: {} }, weather: '晴',
    protagonistState: { health: '良好', mood: '平静', statusEffects: [], notes: '' },
    gameplayResources: normalizeGameplayResources(world), gameplayModState: normalizeGameplayModState(world),
  };
}
