import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import { createWorldSlice } from '@/store/slices/world-slice';
import type { WorldDefinition, WorldSnapshot, WorldLineNode } from './types';
import type { StorySegment } from '@/lib/ai/types';
import { loadBlob } from './cas-storage';
import { parseGameplayPlugins, validateGameModeConfig } from './plugins/manifest';
import { record, text } from './plugins/validation';
import { createStreamRequestScope, isCurrentStreamContinuation, isPipelineBusy } from './stream-lifecycle';
import { getPendingActionNodeSave } from './action-node-commit';
import { getSceneById } from './scene-utils';

export interface AuthorRepro {
  format: 'eidos-author-repro-v1'; label: string; createdAt: string;
  world: WorldDefinition; snapshot: WorldSnapshot; segments: StorySegment[];
}
/** Includes same-node author edits and accepted changes awaiting their durable node. */
export function authorSceneIdentity(state: GameStore, snapshot = state.createSnapshot()): string {
  return JSON.stringify([state.currentWorld, snapshot, state.currentPlaythroughId, state.worldLine?.id, state.currentNode?.id, state.sandboxMode, state.sandboxDossierId]);
}
/** Self-contained author JSON only: provider settings and external source bytes are not captured. */
export function parseAuthorRepro(input: unknown): AuthorRepro {
  // Internal snapshots have omitted optional fields; normalize exactly as an exported JSON file.
  const serialized = JSON.stringify(input);
  const data = record(validateGameModeConfig(JSON.parse(serialized)));
  if (data.format !== 'eidos-author-repro-v1') throw new Error('不支持的作者现场格式');
  const world = record(data.world), snapshot = record(data.snapshot);
  if (typeof world.id !== 'string' || snapshot.worldId !== world.id || typeof snapshot.currentSceneId !== 'string') throw new Error('现场世界或场景无效');
  const regions = Object.values(record(world.regions));
  if (!regions.some(region => Object.hasOwn(record(record(region).scenes), String(snapshot.currentSceneId)))) throw new Error('现场场景不在世界中');
  world.gameplayPlugins = parseGameplayPlugins(world.gameplayPlugins);
  for (const key of ['inventory', 'clues', 'encyclopedia', 'availableActions', 'criticalFacts', 'questLog', 'visitedScenes', 'resolvedTimelineEvents']) if (!Array.isArray(snapshot[key])) throw new Error(`现场缺少 ${key}`);
  for (const key of ['worldFlags', 'discoveredSecrets', 'sceneDetailLevels', 'deviatedEvents']) record(snapshot[key]);
  const time = record(snapshot.currentGameTime);
  if (!['day', 'hour', 'minute'].every(k => Number.isSafeInteger(time[k]) && Number(time[k]) >= 0)) throw new Error('现场时间无效');
  if (!Array.isArray(data.segments) || data.segments.some(s => !s || !['narration', 'dialogue'].includes(s.type) || typeof s.text !== 'string')) throw new Error('现场正文无效');
  return { format: 'eidos-author-repro-v1', label: text(data.label, 160), createdAt: text(data.createdAt, 80), world: world as unknown as WorldDefinition, snapshot: snapshot as unknown as WorldSnapshot, segments: data.segments as StorySegment[] };
}
export async function captureAuthorRepro(store: StoreApi<GameStore>): Promise<AuthorRepro> {
  const state = store.getState(), scope = createStreamRequestScope(state);
  if (!state.currentWorld) throw new Error('请先进入一个世界');
  if (isPipelineBusy() || getPendingActionNodeSave(store)) throw new Error('请等待当前剧情和保存完成后再导出现场');
  const snapshot = state.createSnapshot(), identity = authorSceneIdentity(state, snapshot);
  // Navigation fields can lag behind the accepted action; immutable CAS is authoritative.
  const segments = state.currentNode?.segmentHash ? await loadBlob(state.currentNode.segmentHash) : state.savedSegments;
  if (!isCurrentStreamContinuation(scope, store.getState()) || isPipelineBusy() || getPendingActionNodeSave(store) || identity !== authorSceneIdentity(store.getState())) throw new Error('现场已变化，请等待保存完成后重新导出');
  if (!segments) throw new Error('当前正文原件缺失');
  return parseAuthorRepro({ format: 'eidos-author-repro-v1', label: `${state.currentScene?.name ?? state.currentSceneId} · ${state.currentNode?.stepNumber ?? 0}`, createdAt: new Date().toISOString(), world: state.currentWorld, snapshot, segments });
}
/** Prepare with the real restoration code before exposing any change to the live store. */
export function enterAuthorRepro(store: StoreApi<GameStore>, input: unknown): AuthorRepro {
  if (getPendingActionNodeSave(store)) throw new Error('请等待实验操作保存完成后再切换现场');
  const repro = parseAuthorRepro(input), state = store.getState();
  const restored = createWorldSlice(() => {}, () => ({ ...state, currentWorld: repro.world, history: [] })).prepareSnapshotRestore(repro.snapshot);
  const currentScene = getSceneById(repro.world, repro.snapshot.currentSceneId);
  if (!restored?.currentScene || !currentScene) throw new Error('现场不能恢复');
  const id = crypto.randomUUID(), nodeId = `lab-${id}`, now = Date.now();
  const node: WorldLineNode = { id: nodeId, parentId: null, childIds: [], stepNumber: 0, playerInput: repro.label, aiResponse: repro.snapshot.sceneNarrative, summary: repro.label, snapshotHash: '', segmentHash: '', gameTime: repro.snapshot.currentGameTime, sceneId: repro.snapshot.currentSceneId, sceneName: currentScene.name, dayNumber: repro.snapshot.currentGameTime.day, createdAt: now, generationComplete: true, availableActions: repro.snapshot.availableActions, timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [] };
  store.setState({ ...restored, sandboxMode: true, sandboxDossierId: `author-${id}`, currentPlaythroughId: `author-${id}`, isLoading: false,
    worldLine: { id: `lab-${id}`, playthroughId: `author-${id}`, worldId: repro.world.id, rootNodeId: nodeId, allNodeIds: [nodeId], currentNodeId: nodeId, branchCount: 0, totalSteps: 0, createdAt: now, updatedAt: now, gameplayPluginHistory: repro.world.gameplayPluginHistory },
    allNodes: { [nodeId]: node }, currentNode: node, savedSegments: repro.segments, savedSegmentIndex: 0, savedIsShowingSegments: true });
  return repro;
}
