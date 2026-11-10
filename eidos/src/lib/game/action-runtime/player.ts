import { createPlayerSlice } from '@/store/slices/player-slice';
import { projectNpcMemoryState } from '../npc-memory-save';
import { currentActionScene } from './world';
import { findPublicFactQuote } from '../player-reading';
import { npcReaction, npcReferenceContext, resolveNpcReference } from '../npc-reference';
import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import type { RpgActionInput, RpgPlayerState } from './types';
import type { InventoryItem, Weather } from '../types';

export function createActionPlayer(input: RpgActionInput): RpgPlayerState {
  // World reducers may update nested collections in place; the record keeps the untouched origin.
  const snapshot = structuredClone(input.snapshot), projected = projectNpcMemoryState(snapshot.npcMemory);
  let id = 0;
  const set: Parameters<typeof createPlayerSlice>[0] = update => { Object.assign(state, typeof update === 'function' ? update(state) : update); };
  const player = createPlayerSlice(set, () => state, undefined, { createId: kind => `${input.actionId}:${kind}:${id++}` });
  const state: RpgPlayerState = { ...player, currentWorld: input.world, currentSceneId: snapshot.currentSceneId, currentScene: currentActionScene(input.world, snapshot.currentSceneId, snapshot.encyclopedia),
    gameTime: snapshot.currentGameTime, weather: (snapshot.weather ?? '晴') as Weather, history: input.history ?? [], availableActions: snapshot.availableActions,
    inventory: snapshot.inventory, clues: snapshot.clues, encyclopedia: snapshot.npcMemory ? [...snapshot.encyclopedia.filter(e => e.type !== 'npc'), ...projected.encyclopedia] : snapshot.encyclopedia,
    criticalFacts: snapshot.criticalFacts, questLog: snapshot.questLog, diary: snapshot.diary ?? [],
    protagonistState: snapshot.protagonistState ?? player.protagonistState,
    relationships: snapshot.relationships ?? projected.relationships, npcStates: snapshot.npcStates ?? projected.npcStates,
    npcBehaviors: snapshot.npcBehaviors ?? projected.npcBehaviors, npcPersonalities: snapshot.npcPersonalities ?? projected.npcPersonalities,
    worldFlags: snapshot.worldFlags, sceneDetailLevels: snapshot.sceneDetailLevels, visitedScenes: snapshot.visitedScenes, discoveredSecrets: snapshot.discoveredSecrets,
    resolvedTimelineEvents: snapshot.resolvedTimelineEvents, deviatedEvents: snapshot.deviatedEvents, causalProjections: snapshot.causalProjections ?? [], sceneNarrative: snapshot.sceneNarrative,
  };
  return state;
}
export function acceptPlayerKnowledge(state: RpgPlayerState, response: AIGameResponse, segments: StorySegment[]) {
  const passages = segments.map(s => s.type === 'dialogue' && s.speaker ? `${s.speaker}：${s.text}` : s.text);
  const references = npcReferenceContext(state.currentWorld, state, segments.flatMap(s => s.type === 'dialogue' && s.speaker ? [s.speaker] : []));
  references.names.push(...(response.encyclopediaUpdates ?? []).filter(e => e.type === 'npc').map(e => e.name));
  const reactions = (response.npcsReacted ?? []).filter(n => typeof n === 'string' && n.trim()).map(n => npcReaction(n, references));
  response.npcsReacted = [...new Set(reactions.map(r => r.name))];
  for (const fact of response.criticalFactsDiscovered ?? []) state.addCriticalFact(fact);
  for (const entry of response.encyclopediaUpdates ?? []) {
    if (entry.type === 'npc') {
      const name = resolveNpcReference(entry.name, references);
      const description = findPublicFactQuote(passages, name, entry.description) ? entry.description : '';
      const knowledge = findPublicFactQuote(passages, name, entry.knowledge) ? entry.knowledge : undefined;
      if (description || knowledge) state.upsertEncyclopediaEntry({ type: 'npc', name, description, knowledge });
    } else {
      state.upsertEncyclopediaEntry({ ...entry, type: (entry.type || 'other') as Parameters<typeof state.upsertEncyclopediaEntry>[0]['type'] });
    }
  }
  for (const name of response.encyclopediaDeletions ?? []) {
    const entry = state.encyclopedia.find(e => e.name === name); if (entry) state.deleteEncyclopediaEntry(entry.id);
  }
  if (response.protagonistStateUpdate) state.updateProtagonistState(response.protagonistStateUpdate);
  for (const update of response.relationshipUpdates ?? []) state.updateRelationship({ ...update, npcName: resolveNpcReference(update.npcName, references) });
  for (const update of response.itemValueUpdates ?? []) state.updateItemValue(update.itemId, update.value);
  return reactions.map(({ name, reaction }) => ({ name, mentioned: passages.some(text => text.includes(name)),
    reaction: findPublicFactQuote(passages, name, reaction) ? reaction : undefined }));
}
export function acceptReactionKnowledge(state: RpgPlayerState, reactions: ReturnType<typeof acceptPlayerKnowledge>) {
  for (const { name, mentioned, reaction } of reactions) {
    if (!state.relationships[name]) state.updateRelationship({ npcName: name });
    state.npcStates = { ...state.npcStates, [name]: 'reacted' };
    // A reaction confirms participation internally, but is not a license to reveal the world biography.
    if (mentioned) state.upsertEncyclopediaEntry({ type: 'npc', name, description: '', knowledge: reaction });
  }
}
export function acceptInventory(state: RpgPlayerState, response: AIGameResponse, actionId: string) {
  for (const [index, item] of (response.itemsGained ?? []).entries()) {
    state.addToInventory({ ...item, id: item.id || `${actionId}:item:${index}`, quantity: item.quantity ?? 1,
      acquiredFrom: item.acquiredFrom ?? state.currentSceneId, acquiredAt: { ...state.gameTime }, category: item.category ?? 'misc', consumable: item.consumable ?? false, value: item.value ?? 0 });
  }
  for (const raw of response.itemsUsed ?? []) {
    const name = typeof raw === 'string' ? raw : (raw as Partial<InventoryItem>)?.name;
    if (!name) continue;
    const item = state.inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (item) state.removeFromInventory(item.id, 1);
  }
  for (const id of response.cluesDiscovered ?? []) state.discoverClue(id);
}
