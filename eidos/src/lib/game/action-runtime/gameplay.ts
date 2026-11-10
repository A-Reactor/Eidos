import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import { evaluateGameplayEvents } from '../plugins/runtime';
import { normalizeGameplayModState } from '../plugins/mod-ui';
import { applyGameplayRuleEffects } from '../plugins/rule-effects';
import { completeGameplayNarration } from '../plugins/gameplay-state';
import { prepareCardVariableTransition } from '../cards/variable-updates';
import { cardBindingActive } from '../cards/selection';
import { acceptChapterAction, chapterBeat } from '../chapters/state';
import { chapterNarrativeEnabled } from '../chapters/context';
import { nextNarrativeProgress } from '../narrative-beat';
import { getSceneById } from '../scene-utils';
import type { RpgActionInput } from './types';

export function prepareRpgGameplay(input: RpgActionInput, response: AIGameResponse, segments: StorySegment[]) {
  const { world, snapshot } = input, cutaway = response.narrativeFrame?.kind === 'cutaway', result = Boolean(response._gameplayResult);
  const events = input.introspection ? undefined : response.pluginEvents;
  const transition = evaluateGameplayEvents(world, snapshot.worldFlags, snapshot.gameplayResources, events);
  let modState = prepareCardVariableTransition({ world, state: normalizeGameplayModState(world, snapshot.gameplayModState), updates: response.cardVariableUpdates,
    mode: input.introspection ? 'introspection' : cutaway ? 'cutaway' : 'action',
    activeAssetIds: world.cardBindings?.filter(b => b.enabled && cardBindingActive(b, getSceneById(world, snapshot.currentSceneId)?.npcs ?? [], input.input)).map(b => b.assetId) });
  modState = applyGameplayRuleEffects({ world, state: modState, flags: snapshot.worldFlags, events, receiptId: input.actionId, createdAt: input.timestamp, sceneId: snapshot.currentSceneId });
  if (response._gameplayResult) modState = completeGameplayNarration(modState, response._gameplayResult);
  const enabled = !input.introspection && !result && chapterNarrativeEnabled(world, snapshot);
  let chapter = snapshot.chapterState;
  if (enabled || !input.introspection && !result && chapter) {
    chapter = acceptChapterAction({ worldId: world.id, state: chapter, actionId: input.actionId, input: input.input,
      enabled, inputSource: input.inputSource, sceneId: snapshot.currentSceneId, segments, summary: response.summary ?? '', frame: response.narrativeFrame, preparation: response.chapterPreparation, signal: response.chapterSignal });
    if (enabled) response.narrativeBeat = chapterBeat(chapter);
  }
  return { worldFlags: { ...snapshot.worldFlags, ...transition.flags }, gameplayResources: transition.resources, gameplayModState: modState,
    chapterState: chapter, narrativeProgress: !input.introspection && !result ? nextNarrativeProgress(snapshot.narrativeProgress, response.narrativeBeat) : snapshot.narrativeProgress };
}
