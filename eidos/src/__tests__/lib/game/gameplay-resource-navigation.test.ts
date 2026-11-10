// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { storeBlob } from '@/lib/game/cas-storage';
import { loadMeta } from '@/lib/game/storage';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import type { ActionRecord, WorldLineMeta, WorldLineNode, WorldSnapshot } from '@/lib/game/types';
import { resourceWorld } from './gameplay-resource-fixtures';

const initial = useGameStore.getInitialState();
const paths = ['match', 'reuse', 'rewind'] as const;
type Path = typeof paths[number];
const action: ActionRecord = {
  id: 'explore', timestamp: 1, gameTime: { day: 0, hour: 8, minute: 5 }, sceneId: 'start', sceneName: '起点',
  playerInput: '探索道路', aiResponse: '沿道路前进', summary: '探索', timeSpent: { day: 0, hour: 0, minute: 5 }, worldImpacts: [], snapshot: null,
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  useGameStore.setState({ ...initial });
  useGameStore.getState().setCurrentWorld({ ...buildRiftCityStartState().world, ...resourceWorld() });
});
afterEach(() => vi.unstubAllGlobals());

async function prepareChild(resources: WorldSnapshot['gameplayResources'], missingBlob = false) {
  const state = useGameStore.getState(), id = crypto.randomUUID();
  const childSnapshot: WorldSnapshot = {
    ...state.createSnapshot(), gameplayResources: resources, sceneNarrative: '子节点正文', worldFlags: { arrived: true },
    currentGameTime: { day: 99, hour: 0, minute: 0 },
  };
  const root: WorldLineNode = {
    id: `root_${id}`, parentId: null, stepNumber: 0, playerInput: '', aiResponse: '', summary: '起点',
    snapshotHash: '', segmentHash: '', childIds: [`child_${id}`], createdAt: 1,
    gameTime: { day: 0, hour: 8, minute: 0 }, sceneId: 'start', sceneName: '起点', dayNumber: 0,
    timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], generationComplete: true,
  };
  const child: WorldLineNode = {
    ...root, id: `child_${id}`, parentId: root.id, stepNumber: 1, playerInput: action.playerInput,
    aiResponse: action.aiResponse, snapshotHash: `snapshot_${id}`, segmentHash: `segments_${id}`, childIds: [], availableActions: ['继续前进'],
  };
  const line: WorldLineMeta = {
    id: `line_${id}`, worldId: state.currentWorld!.id, playthroughId: `pt_${id}`, rootNodeId: root.id, currentNodeId: root.id,
    allNodeIds: [root.id, child.id], branchCount: 0, totalSteps: 1, createdAt: 1, updatedAt: 1,
  };
  if (!missingBlob) await storeBlob(child.snapshotHash, 'snapshot', childSnapshot);
  await storeBlob(child.segmentHash, 'segments', [{ type: 'narration', text: '子节点正文' }]);
  useGameStore.setState({ worldLine: line, allNodes: { [root.id]: root, [child.id]: child }, currentNode: root,
    currentPlaythroughId: line.playthroughId, sceneNarrative: '父节点正文', availableActions: ['父节点行动'],
    savedSegments: [{ type: 'narration', text: '父节点正文' }], savedIsShowingSegments: true });
  await useGameStore.getState().persistWorldLineData();
  return { root, child, childSnapshot, key: scopeStorageKey(useGameStore.getState(), `worldline_data_${line.id}`) };
}

function navigate(path: Path, child: WorldLineNode, snapshot: WorldSnapshot) {
  const state = useGameStore.getState();
  if (path === 'match') return state.tryMatchChildNode(action.playerInput);
  if (path === 'reuse') return state.addActionNode(action, snapshot, []);
  return state.backtrackToNode(child.id);
}

describe('resource snapshot navigation is atomic', () => {
  it.each(paths)('rejects a corrupt %s snapshot before changing live or persisted state', async path => {
    const { root, child, childSnapshot, key } = await prepareChild({ 'gameplay.supplies.stamina': -1 });
    const before = useGameStore.getState();
    await expect(navigate(path, child, childSnapshot)).rejects.toThrow();
    const after = useGameStore.getState();
    expect(after.currentNode?.id).toBe(root.id);
    expect(after.worldLine?.currentNodeId).toBe(root.id);
    expect(after.gameplayResources).toEqual(before.gameplayResources);
    expect(after.worldFlags).toEqual(before.worldFlags);
    expect(after.gameTime).toEqual(before.gameTime);
    expect(after.sceneNarrative).toBe('父节点正文');
    expect(after.savedSegments).toEqual(before.savedSegments);
    expect(after.availableActions).toEqual(before.availableActions);
    expect((await loadMeta<{ meta: WorldLineMeta }>(key))?.meta.currentNodeId).toBe(root.id);
  });

  it.each(paths)('does not navigate %s when the target snapshot blob is missing', async path => {
    const { root, child, childSnapshot, key } = await prepareChild(undefined, true);
    await expect(navigate(path, child, childSnapshot)).rejects.toThrow();
    expect(useGameStore.getState().currentNode?.id).toBe(root.id);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
    expect((await loadMeta<{ meta: WorldLineMeta }>(key))?.meta.currentNodeId).toBe(root.id);
  });

  it.each(paths)('restores and persists legitimate zero through %s', async path => {
    const { child, childSnapshot, key } = await prepareChild({ 'gameplay.supplies.stamina': 0 });
    await navigate(path, child, childSnapshot);
    expect(useGameStore.getState().currentNode?.id).toBe(child.id);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(0);
    expect(useGameStore.getState().sceneNarrative).toBe('子节点正文');
    expect((await loadMeta<{ meta: WorldLineMeta }>(key))?.meta.currentNodeId).toBe(child.id);
  });

  it.each(paths)('restores legacy defaults through %s without retaining current resource values', async path => {
    const { child, childSnapshot } = await prepareChild(undefined);
    useGameStore.setState({ gameplayResources: { ...useGameStore.getState().gameplayResources, 'gameplay.supplies.stamina': 0 } });
    await navigate(path, child, childSnapshot);
    expect(useGameStore.getState().gameplayResources['gameplay.supplies.stamina']).toBe(3);
  });
});
