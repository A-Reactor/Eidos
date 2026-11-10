import { addTime, resolveActionTime, timeToMinutes } from '../time';
import { nextWeather } from '../calendar';
import { applyMapUpdates, mapRoutes } from '../map-state';
import { getSceneById, resolveSceneReference } from '../scene-utils';
import { pluginFlagPrefix } from '../plugins/runtime';
import type { AIGameResponse } from '@/lib/ai/types';
import type { RpgActionEffect, RpgPlayerState } from './types';
import type { GameTime, Scene } from '../types';

export function advanceActionWorld(state: RpgPlayerState, response: AIGameResponse, input: string): GameTime {
  const time = response.narrativeFrame?.kind === 'cutaway' ? { day: 0, hour: 0, minute: 0 } : resolveActionTime(input, response.timeSpent, state.gameTime, response.timeAfter);
  if (response._gameplayResult) return time;
  state.gameTime = addTime(state.gameTime, time);
  for (const event of state.currentWorld.timeline) {
    if (!state.resolvedTimelineEvents.includes(event.id) && !state.deviatedEvents[event.id] && timeToMinutes(state.gameTime) >= timeToMinutes(event.timePoint)) {
      state.resolvedTimelineEvents.push(event.id);
      for (const flag of event.worldFlags ?? []) state.worldFlags[flag] = true;
    }
  }
  state.causalProjections = state.causalProjections.map(p => ({ ...p, rippleEffects: p.rippleEffects.map(r => r.status === 'pending' && timeToMinutes(state.gameTime) - timeToMinutes(r.estimatedTime) > 1440
    ? { ...r, status: 'expired', resolvedAt: { ...state.gameTime }, resolutionNote: '预测时间窗口已过，未观察到预期事件' } : r) }));
  state.weather = nextWeather(state.weather, state.gameTime.hour + state.gameTime.day * 24);
  return time;
}
export function acceptSceneChanges(state: RpgPlayerState, response: AIGameResponse, effects: RpgActionEffect[]) {
  const origin = state.currentSceneId;
  state.sceneDetailLevels[origin] = Math.min(100, (state.sceneDetailLevels[origin] ?? 10) + 5);
  for (const secret of response.discoveredSecrets ?? []) state.discoveredSecrets[origin] = [...(state.discoveredSecrets[origin] ?? []), secret];
  if (response.mapUpdates) {
    try { state.currentWorld = applyMapUpdates(state.currentWorld, response.mapUpdates); state.currentScene = getSceneById(state.currentWorld, state.currentSceneId); }
    catch (error) { effects.push({ type: 'map.rejected', message: error instanceof Error ? error.message : '地图变化未能确认' }); return; }
  }
  for (const change of response.sceneChanges ?? []) {
    const target = resolveSceneReference(state.currentWorld, change);
    if (target && target !== state.currentSceneId) enterScene(state, target, effects);
    else if (!target && typeof change === 'string' && change.trim() && !change.startsWith(pluginFlagPrefix)) state.worldFlags[change] = true;
  }
}
function enterScene(state: RpgPlayerState, id: string, effects: RpgActionEffect[]) {
  if (mapRoutes(state.currentWorld).some(r => r.from === state.currentSceneId && r.to === id && r.status !== 'open')) return;
  const found = getSceneById(state.currentWorld, id);
  if (!found) return;
  state.currentSceneId = id; state.currentScene = found; state.sceneNarrative = found.initialDescription;
  if (!state.visitedScenes.includes(id)) state.visitedScenes.push(id);
  effects.push({ type: 'scene.entered', sceneId: id });
}
export function currentActionScene(world: RpgPlayerState['currentWorld'], id: string, encyclopedia: RpgPlayerState['encyclopedia']): Scene | null {
  const scene = getSceneById(world, id); if (scene) return scene;
  const entry = encyclopedia.find(e => e.type === 'location' && e.id === id);
  return entry ? { id, name: entry.name, region: '探索发现', initialDescription: entry.description, detailLevel: 10, connections: [], npcs: [], secrets: [], discoveredSecrets: [] } : null;
}
export function diaryEffect(state: RpgPlayerState, before: GameTime): RpgActionEffect[] {
  const previous = Math.floor((timeToMinutes(before) - 240) / 1440), current = Math.floor((timeToMinutes(state.gameTime) - 240) / 1440);
  if (current === previous || state.diary.some(d => d.day === previous)) return [];
  const history = state.history.filter(h => Math.floor(timeToMinutes(h.gameTime) / 1440) === previous);
  return history.length ? [{ type: 'diary.requested', day: previous, history: structuredClone(history) }] : [];
}
