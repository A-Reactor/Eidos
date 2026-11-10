import type { GameStore } from '@/store/game-store';
import type { Weather } from '../types';
import { projectNpcMemoryState } from '../npc-memory-save';
import { currentActionScene } from './world';
import type { PreparedRpgAction } from './types';

/** The browser publishes the prepared domain state together; presentation and I/O stay with its host. */
export function rpgActionStorePatch({ world, snapshot: s, response, effects }: PreparedRpgAction): Partial<GameStore> {
  const npc = projectNpcMemoryState(s.npcMemory);
  const encyclopedia = [...s.encyclopedia, ...npc.encyclopedia];
  const mapChanged = Boolean(response.mapUpdates) && !effects.some(e => e.type === 'map.rejected');
  const moved = effects.some(e => e.type === 'scene.entered');
  return {
    // Unchanged world/scene references keep host resource subscriptions from restarting on every line.
    ...(mapChanged ? { currentWorld: world } : {}), currentSceneId: s.currentSceneId,
    ...(mapChanged || moved ? { currentScene: currentActionScene(world, s.currentSceneId, encyclopedia) } : {}),
    gameTime: s.currentGameTime, sceneNarrative: s.sceneNarrative, worldFlags: s.worldFlags,
    discoveredSecrets: s.discoveredSecrets, sceneDetailLevels: s.sceneDetailLevels, visitedScenes: s.visitedScenes,
    resolvedTimelineEvents: s.resolvedTimelineEvents, deviatedEvents: s.deviatedEvents,
    inventory: s.inventory, clues: s.clues, encyclopedia, criticalFacts: s.criticalFacts, questLog: s.questLog,
    ...(s.protagonistState ? { protagonistState: s.protagonistState } : {}), availableActions: s.availableActions, weather: s.weather as Weather,
    npcStates: npc.npcStates, relationships: npc.relationships, npcBehaviors: npc.npcBehaviors, npcPersonalities: npc.npcPersonalities,
    causalProjections: s.causalProjections ?? [], gameplayResources: s.gameplayResources ?? {}, gameplayModState: s.gameplayModState ?? {},
    chapterState: s.chapterState ?? null, narrativeProgress: s.narrativeProgress ?? null, historyEpochPlan: s.historyEpochPlan ?? null,
  };
}
