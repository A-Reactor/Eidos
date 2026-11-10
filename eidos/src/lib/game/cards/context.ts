import { assertCardGrowthFits } from '@/lib/ai/prompt-budget';
import type { ActionContextDiagnostics } from '@/lib/ai/action-context-diagnostics';
import type { WorldDefinition, WorldSnapshot } from '../types';
import { mappedScene } from '../map-state';
import { applyMapUpdates as updateWorldMap } from '../map-state';
import { resolveSceneReference } from '../scene-utils';
import type { MapUpdates } from '../map-state';
import { isInitialWorldObservation } from '../world-entry';
import { validateCardContext } from './validation';
import { loadCardAsset } from './storage';
import { selectCardContext } from './selection';
import type { CardActionContext } from './types';

export async function buildCardActionContext(input: {
  world?: WorldDefinition | null; snapshot: WorldSnapshot; playerInput: string;
  recentHistory?: Array<{ playerInput: string; summary: string }>; introspection?: boolean;
  initial?: boolean;
}): Promise<CardActionContext | undefined> {
  const { world, snapshot } = input;
  // The protagonist's private questions must use acquired knowledge, not raw secrets.
  if (input.introspection || !world?.cardBindings?.some(b => b.enabled)) return undefined;
  const ids = [...new Set(world.cardBindings.filter(b => b.enabled).map(b => b.assetId))];
  const assets = await Promise.all(ids.map(loadCardAsset));
  const scene = mappedScene(world, snapshot.currentSceneId);
  const query = [input.playerInput, scene?.name ?? '', ...(scene?.npcs ?? []),
    ...(input.recentHistory ?? []).slice(-3).map(h => `${h.playerInput}\n${h.summary}`),
    ...(snapshot.questLog ?? []).filter(q => q.status === 'active').map(q => q.title),
  ].join('\n');
  return selectCardContext({ assets: assets.filter(a => a !== null), bindings: world.cardBindings,
    query, targetInput: input.playerInput, sceneNpcs: scene?.npcs ?? [], playerName: snapshot.playerName,
    initial: input.initial ?? (snapshot.historyLength === 0 || isInitialWorldObservation(input.playerInput, snapshot)), maxChars: world.cardContextMaxChars, modState: snapshot.gameplayModState });
}
/** A draft must remain playable with its new variables and newly active mandatory branches. */
export async function preflightCardVariableContext(input: Parameters<typeof buildCardActionContext>[0] & {
  response?: { mapUpdates?: MapUpdates; sceneChanges?: unknown[] };
  contextDiagnostics?: ActionContextDiagnostics;
}) {
  const after = await buildCardActionContext({ ...input, initial: false });
  assertCardGrowthFits({ budget: input.contextDiagnostics?.budget, before: input.contextDiagnostics?.cards, after });
  if (!input.world) return;
  let world = input.world;
  // Invalid map proposals are ignored by the existing settlement path as well.
  if (input.response?.mapUpdates) try { world = updateWorldMap(world, input.response.mapUpdates); } catch { return; }
  let sceneId = input.snapshot.currentSceneId;
  for (const change of input.response?.sceneChanges ?? []) sceneId = resolveSceneReference(world, change) ?? sceneId;
  if (world !== input.world || sceneId !== input.snapshot.currentSceneId) {
    const projected = await buildCardActionContext({ ...input, world, snapshot: { ...input.snapshot, currentSceneId: sceneId }, initial: false });
    assertCardGrowthFits({ budget: input.contextDiagnostics?.budget, before: input.contextDiagnostics?.cards, after: projected });
  }
}
export async function resolveCardActionContext(input: Parameters<typeof buildCardActionContext>[0] & { cardContext?: CardActionContext }): Promise<CardActionContext | undefined> {
  if (input.introspection) return undefined;
  if (input.cardContext) {
    validateCardContext(input.cardContext, input.world?.cardBindings, input.world?.cardContextMaxChars);
    return input.cardContext;
  }
  if (!input.world?.cardBindings?.some(b => b.enabled)) return undefined;
  if (typeof window === 'undefined') throw new Error('行动缺少已选择的原卡上下文，请重新载入卡片资源');
  return buildCardActionContext(input);
}
