import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRecord, WorldLineMeta, WorldLineNode } from "@/lib/game/types";

const storage = vi.hoisted(() => ({
  saveMeta: vi.fn(),
  loadMeta: vi.fn(),
}));

const cas = vi.hoisted(() => ({
  computeContentHash: vi.fn(),
  storeBlob: vi.fn(),
  loadBlob: vi.fn(),
  batchDecrementRef: vi.fn(),
  hashAndStore: vi.fn(),
}));

vi.mock("@/lib/game/storage", () => storage);
vi.mock("@/lib/game/cas-storage", () => cas);

import { createWorldLineSlice, type WorldLineSlice } from "@/store/slices/worldline-slice";

type TestState = WorldLineSlice &
  Record<string, unknown> & {
    currentWorld: { id: string };
    currentPlaythroughId: string;
  };

function createTestStore(overrides: Partial<TestState> = {}) {
  const state: Partial<TestState> = {};
  const set = (
    partial:
      | Record<string, unknown>
      | ((current: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    Object.assign(state, typeof partial === "function" ? partial(state as Record<string, unknown>) : partial);
  };
  const get = () => state;
  Object.assign(state, createWorldLineSlice(set, get));
  Object.assign(state, overrides);
  return state as TestState;
}

function makeWorldLine(id: string, worldId: string, playthroughId: string, currentNodeId: string): WorldLineMeta {
  return {
    id,
    worldId,
    playthroughId,
    rootNodeId: currentNodeId,
    allNodeIds: [currentNodeId],
    currentNodeId,
    branchCount: 0,
    totalSteps: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeNode(id: string): WorldLineNode {
  return {
    id,
    parentId: null,
    stepNumber: 0,
    playerInput: "",
    aiResponse: "",
    summary: "root",
    snapshotHash: "",
    segmentHash: "",
    childIds: [],
    createdAt: 1,
    gameTime: { day: 0, hour: 8, minute: 0 },
    sceneId: "scene_old",
    sceneName: "旧场景",
    dayNumber: 0,
    timeSpent: { day: 0, hour: 0, minute: 0 },
    worldImpacts: [],
    generationComplete: true,
  };
}

const action: ActionRecord = {
  id: "action_old",
  timestamp: 1,
  gameTime: { day: 0, hour: 8, minute: 5 },
  sceneId: "scene_old",
  sceneName: "旧场景",
  playerInput: "旧世界行动",
  aiResponse: "旧世界回应",
  summary: "旧世界总结",
  timeSpent: { day: 0, hour: 0, minute: 5 },
  worldImpacts: [],
  snapshot: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.loadMeta.mockResolvedValue([]);
  storage.saveMeta.mockResolvedValue(undefined);
});

describe("WorldLineSlice live scope isolation", () => {
  it('persists reader notes with the tree and leaves AI summaries and other nodes unchanged', async () => {
    const root = makeNode('root');
    const child = { ...makeNode('child'), parentId: root.id };
    const line = makeWorldLine('wl_notes', 'world', 'pt', root.id);
    const store = createTestStore({ currentWorld: { id: 'world' }, currentPlaythroughId: 'pt', worldLine: line,
      allNodes: { root, child }, currentNode: root });
    const beforeSummary = store.getWorldLineSummary();
    store.setPlayerNpcNote(child.id, '林', '不能改写未来节点');
    expect(store.allNodes.child.playerNpcNotes).toBeUndefined();
    store.setPlayerNpcNote(root.id, '林', '只属于玩家的猜测');
    await store.persistWorldLineData();
    const saved = JSON.parse(JSON.stringify(storage.saveMeta.mock.calls.at(-1)?.[1]));
    expect(saved.nodes.root.playerNpcNotes).toEqual({ 林: '只属于玩家的猜测' });
    expect(store.getWorldLineSummary()).toEqual(beforeSummary);
    Object.assign(store, { allNodes: {}, currentNode: null });
    storage.loadMeta.mockResolvedValueOnce(saved);
    expect(await store.loadWorldLine(line.id)).toBe(true);
    expect(store.currentNode?.playerNpcNotes).toEqual({ 林: '只属于玩家的猜测' });
    expect(store.allNodes.child.playerNpcNotes).toBeUndefined();
  });
  it("does not replace the live current node if an async node write finishes after switching worldlines", async () => {
    let resolveHash!: (value: string) => void;
    cas.hashAndStore.mockImplementationOnce(
      () => new Promise<string>((resolve) => { resolveHash = resolve; }),
    );

    const oldRoot = makeNode("old_root");
    const newRoot = makeNode("new_root");
    const oldLine = makeWorldLine("wl_old", "world_old", "pt_old", oldRoot.id);
    const newLine = makeWorldLine("wl_new", "world_new", "pt_new", newRoot.id);
    const store = createTestStore({
      currentWorld: { id: "world_old" },
      currentPlaythroughId: "pt_old",
      worldLine: oldLine,
      allNodes: { [oldRoot.id]: oldRoot },
      currentNode: oldRoot,
    });

    const pending = store.addActionNode(action, { worldId: "world_old" } as never, []);

    Object.assign(store, {
      currentWorld: { id: "world_new" },
      currentPlaythroughId: "pt_new",
      worldLine: newLine,
      allNodes: { [newRoot.id]: newRoot },
      currentNode: newRoot,
    });

    resolveHash("snapshot_old");
    await expect(pending).rejects.toThrow('进度');

    expect(store.worldLine?.id).toBe("wl_new");
    expect(store.currentNode?.id).toBe("new_root");
    expect(Object.keys(store.allNodes)).toEqual(["new_root"]);
  });
});

it('restores the chosen record state and clears old segments and recommendations for an empty root', async () => {
  const root = { ...makeNode('root'), snapshotHash: 'snapshot_root', availableActions: [] };
  const current = { ...makeNode('current'), parentId: 'root' };
  const snapshot = { worldId: 'world', currentSceneId: 'dock', currentGameTime: { day: 1, hour: 8, minute: 0 } };
  cas.loadBlob.mockResolvedValue(snapshot);
  const restoreSnapshot = vi.fn();
  const store = createTestStore({ currentWorld: { id: 'world' }, currentPlaythroughId: 'pt', worldLine: makeWorldLine('wl', 'world', 'pt', current.id), allNodes: { root, current }, currentNode: current, restoreSnapshot, savedSegments: [{ type: 'narration', text: '未来的内容' }], availableActions: ['未来行动'] });
  await store.backtrackToNode('root');
  expect(restoreSnapshot).toHaveBeenCalledWith(snapshot);
  expect(store.currentNode?.id).toBe('root');
  expect(store.savedSegments).toEqual([]); expect(store.availableActions).toEqual([]);
});

it('does not restore stale record state after a different worldline has been loaded', async () => {
  let finish!: (value: unknown) => void;
  cas.loadBlob.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const root = { ...makeNode('root'), snapshotHash: 'snapshot_root' };
  const restoreSnapshot = vi.fn();
  const store = createTestStore({ currentWorld: { id: 'world' }, currentPlaythroughId: 'pt', worldLine: makeWorldLine('wl', 'world', 'pt', 'root'), allNodes: { root }, currentNode: root, restoreSnapshot });
  const pending = store.backtrackToNode('root');
  store.currentWorld = { id: 'other' };
  finish({ worldId: 'world' }); await pending;
  expect(restoreSnapshot).not.toHaveBeenCalled();
});

it('rebuilds action history when moving forward after it was truncated by backtracking', async () => {
  const root = { ...makeNode('root'), snapshotHash: 'root_snapshot', childIds: ['next'] };
  const next = { ...makeNode('next'), parentId: 'root', snapshotHash: 'next_snapshot', aiResponse: '已抵达桥边' };
  cas.loadBlob.mockResolvedValue({ worldId: 'world' });
  const store = createTestStore({ currentWorld: { id: 'world' }, currentPlaythroughId: 'pt', worldLine: makeWorldLine('wl', 'world', 'pt', 'root'), allNodes: { root, next }, currentNode: root, history: [], restoreSnapshot: vi.fn() });
  await store.backtrackToNode('next');
  expect(store.history).toEqual([expect.objectContaining({ id: 'next', aiResponse: '已抵达桥边' })]);
  expect(store.savedSegments).toEqual([{ type: 'narration', text: '已抵达桥边' }]);
  expect(store.savedIsShowingSegments).toBe(false);
});
