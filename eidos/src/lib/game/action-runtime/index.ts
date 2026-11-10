import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import type { WorldSnapshot } from '../types';
import { protectNarrativeResponse } from '../narrative';
import { beatSegments } from '../narrative-beat';
import { splitNpcKnowledgeFromEncyclopedia } from '../npc-memory-save';
import { createActionPlayer, acceptInventory, acceptPlayerKnowledge, acceptReactionKnowledge } from './player';
import { acceptSceneChanges, advanceActionWorld, diaryEffect } from './world';
import { prepareRpgGameplay } from './gameplay';
import type { PreparedRpgAction, RpgActionEffect, RpgActionInput, RpgPlayerState } from './types';
export type { PreparedRpgAction, RpgActionEffect, RpgActionInput } from './types';

function actionResponse(input: RpgActionInput): AIGameResponse {
  const data = input.response;
  if ((!data._gameplayResult && data.validity?.isPossible === false) || data.document || data.toolRequest || data.workspaceRequest || data.historyRequest) throw new Error('只能结算已完成并通过验证的游戏行动');
  const segments = input.segments ?? data.segments ?? [];
  const fallback: StorySegment[] = segments.length ? segments : data.narrative ? [{ type: 'narration', text: data.narrative }, ...(data.dialogue ? [{ type: 'dialogue' as const, text: data.dialogue }] : [])] : [];
  if (!fallback.some(s => typeof s.text === 'string' && s.text.trim())) throw new Error('行动没有有效正文，未结算世界状态');
  return protectNarrativeResponse({ ...data, segments: fallback }, input.snapshot.currentGameTime,
    data._gameplayResult ? { kind: 'result', result: data._gameplayResult } : undefined, input.snapshot);
}
function resultSnapshot(before: WorldSnapshot, state: RpgPlayerState): WorldSnapshot {
  const npc = splitNpcKnowledgeFromEncyclopedia(state);
  return { ...before, mapState: state.currentWorld.mapState ?? before.mapState, currentSceneId: state.currentSceneId, currentGameTime: state.gameTime,
    sceneNarrative: state.sceneNarrative, worldFlags: state.worldFlags, discoveredSecrets: state.discoveredSecrets, sceneDetailLevels: state.sceneDetailLevels,
    visitedScenes: state.visitedScenes, resolvedTimelineEvents: state.resolvedTimelineEvents, deviatedEvents: state.deviatedEvents,
    inventory: state.inventory, clues: state.clues, encyclopedia: npc.encyclopedia, npcMemory: npc.npcMemory,
    npcStates: state.npcStates, relationships: state.relationships, npcBehaviors: state.npcBehaviors, npcPersonalities: state.npcPersonalities,
    criticalFacts: state.criticalFacts, questLog: state.questLog, weather: state.weather, protagonistState: state.protagonistState,
    causalProjections: state.causalProjections, availableActions: state.availableActions, historyLength: before.historyLength + 1 };
}
/** Prepare all world effects before the host publishes one state change or performs I/O. */
export function prepareRpgAction(raw: RpgActionInput): PreparedRpgAction {
  // History can contain many prior snapshots. Only the diary effect copies its selected records.
  const { history, ...source } = raw;
  const input: RpgActionInput = { ...structuredClone(source), history };
  if (!input.world || input.world.id !== input.snapshot.worldId || !input.actionId || !Number.isFinite(input.timestamp)) throw new Error('行动的世界、标识或时间无效');
  input.world = { ...input.world, ...(input.snapshot.mapState ? { mapState: input.snapshot.mapState } : {}) };
  const response = actionResponse(input), gameplay = prepareRpgGameplay(input, response, response.segments);
  const segments = beatSegments(response.segments, response.narrativeBeat);
  const text = segments.map(s => s.type === 'dialogue' ? `「${s.speaker ? s.speaker + '：' : ''}${s.text}」` : s.text).join('\n\n');
  const state = createActionPlayer(input), effects: RpgActionEffect[] = [];
  state.worldFlags = gameplay.worldFlags;
  const timeSpent = advanceActionWorld(state, response, input.input);
  effects.push(...diaryEffect(state, input.snapshot.currentGameTime)); state.sceneNarrative = text;
  const reactions = acceptPlayerKnowledge(state, response, segments);
  if (response.encyclopediaUpdates) effects.push({ type: 'encyclopedia.updated' });
  if (!input.introspection && response.narrativeFrame?.kind !== 'cutaway' && !response._gameplayResult) {
    acceptSceneChanges(state, response, effects); acceptReactionKnowledge(state, reactions);
    if (state.currentScene) state.upsertEncyclopediaEntry({ type: 'location', name: state.currentScene.name, description: state.currentScene.initialDescription?.slice(0, 100) ?? '' });
  }
  acceptInventory(state, response, input.actionId);
  if (response.timelineDeviation) state.deviatedEvents[response.timelineDeviation.eventId] = response.timelineDeviation.newOutcome;
  state.availableActions = response.availableActions?.length ? response.availableActions : input.snapshot.availableActions;
  const snapshot = { ...resultSnapshot(input.snapshot, state), ...gameplay,
    ...(response._historyEpochPlan ? { historyEpochPlan: response._historyEpochPlan } : {}) };
  const record = { id: input.actionId, timestamp: input.timestamp, gameTime: { ...state.gameTime }, sceneId: state.currentSceneId, sceneName: state.currentScene?.name ?? '',
    playerInput: input.input, aiResponse: text, summary: response.summary ?? `${input.snapshot.playerName} ${input.input.slice(0, 30)}...`, timeSpent,
    worldImpacts: (response.worldImpacts ?? []).filter(i => !(input.introspection || response._gameplayResult || response.narrativeFrame?.kind === 'cutaway') || !i.startsWith('[BACKTRACK:')),
    availableActions: response.availableActions ?? [], snapshot: input.snapshot,
    ...(response._directorCue ? { directorCues: [response._directorCue] } : {}) };
  return { world: state.currentWorld, snapshot, response, segments, text, timeSpent, record, effects };
}
