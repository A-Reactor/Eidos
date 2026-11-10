// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldDefinition } from "@/lib/game/types";
import type { SandboxSnapshotRecord } from "@/lib/game/sandbox-snapshots";

const snapshotApi = vi.hoisted(() => ({
  listSandboxSnapshots: vi.fn(),
  loadSandboxSnapshot: vi.fn(),
  saveSandboxSnapshot: vi.fn(),
  deleteSandboxSnapshot: vi.fn(),
}));

vi.mock("@/lib/game/sandbox-snapshots", () => snapshotApi);

import {
  createSandboxSlice,
  loadSandboxWorldsFromStorage,
  sandboxWorldsStorageKey,
  saveSandboxWorldsToStorage,
  type SandboxSlice,
} from "@/store/slices/sandbox-slice";

type TestState = SandboxSlice & Record<string, any>;

const world = {
  id: "sandbox-world",
  name: "沙箱世界",
  subtitle: "",
  overview: "",
  regions: {},
  npcs: {},
  contradictions: [],
  history: [],
  timeline: [],
  clues: [],
  systemPromptBase: "",
  identityPrompt: "",
  isPlayerCreated: true,
  createdAt: 1,
} satisfies WorldDefinition;

const record = {
  id: "snapshot_1",
  dossierId: "002",
  label: "玩家快照",
  createdAt: 10,
  createdBy: "player",
  reason: "manual",
  riskLevel: "safe",
  worldId: world.id,
  worldName: world.name,
  playthroughId: "pt_sandbox",
  currentSceneId: "entry",
  currentSceneName: "入口",
  currentNodeId: "node_root",
  protected: false,
  sizeBytes: 100,
} satisfies SandboxSnapshotRecord;

const serializedState = {
  playerName: "林",
  currentSceneId: "entry",
  gameTime: { day: 0, hour: 8, minute: 0 },
};

const worldSnapshot = {
  worldId: world.id,
  currentSceneId: "entry",
};

function createTestStore(overrides: Partial<TestState> = {}) {
  const state: Partial<TestState> = {};
  const baseState: Partial<TestState> = {
    sandboxMode: true,
    sandboxDossierId: "002",
    sandboxWorlds: [world],
    currentWorld: world,
    currentScene: { id: "entry", name: "入口" },
    currentSceneId: "entry",
    currentPlaythroughId: "pt_sandbox",
    currentNode: { id: "node_root" },
    worldLine: { id: "wl_1" },
    allNodes: { node_root: { id: "node_root" } },
    serializeState: vi.fn(() => serializedState),
    createSnapshot: vi.fn(() => worldSnapshot),
    deserializeState: vi.fn(),
    restoreSnapshot: vi.fn(),
    addBoundaryEvent: vi.fn((event: unknown) => {
      const events = Array.isArray(state.boundaryEvents) ? state.boundaryEvents : [];
      state.boundaryEvents = [...events, event];
    }),
    boundaryEvents: [],
  };
  const set = (
    partial:
      | Record<string, unknown>
      | ((current: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    Object.assign(state, typeof partial === "function" ? partial(state as Record<string, unknown>) : partial);
  };
  const get = () => state;
  Object.assign(state, createSandboxSlice(set, get));
  Object.assign(state, baseState);
  Object.assign(state, overrides);
  return state as TestState;
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshotApi.listSandboxSnapshots.mockResolvedValue([]);
  snapshotApi.loadSandboxSnapshot.mockResolvedValue(null);
  snapshotApi.saveSandboxSnapshot.mockResolvedValue(record);
  snapshotApi.deleteSandboxSnapshot.mockResolvedValue(false);
});

afterEach(() => {
  localStorage.clear();
});

describe("sandbox world storage", () => {
  it("uses a dossier-scoped key and leaves ordinary player worlds untouched", () => {
    localStorage.setItem("eidos_player_worlds", JSON.stringify([{ id: "ordinary" }]));

    saveSandboxWorldsToStorage("002", [world]);

    expect(JSON.parse(localStorage.getItem("eidos_player_worlds") ?? "[]")).toEqual([
      { id: "ordinary" },
    ]);
    expect(JSON.parse(localStorage.getItem(sandboxWorldsStorageKey("002")) ?? "[]")).toEqual([
      world,
    ]);
    expect(loadSandboxWorldsFromStorage("002")).toEqual([world]);
  });

  it("falls back to an empty world list when sandbox storage is missing or corrupt", () => {
    localStorage.setItem(sandboxWorldsStorageKey("002"), "{");

    expect(loadSandboxWorldsFromStorage("002")).toEqual([]);
    expect(loadSandboxWorldsFromStorage("003")).toEqual([]);
  });
});

describe("SandboxSlice snapshots", () => {
  it("loads snapshot records from the active sandbox dossier", async () => {
    snapshotApi.listSandboxSnapshots.mockResolvedValueOnce([record]);
    const store = createTestStore();

    const records = await store.loadSandboxSnapshots();

    expect(snapshotApi.listSandboxSnapshots).toHaveBeenCalledWith("002");
    expect(records).toEqual([record]);
    expect(store.sandboxSnapshots).toEqual([record]);
  });

  it("creates a manual snapshot from the current sandbox state", async () => {
    snapshotApi.listSandboxSnapshots.mockResolvedValueOnce([record]);
    const store = createTestStore();

    const created = await store.createSandboxSnapshot({ label: "玩家快照" });

    expect(created).toBe(record);
    expect(snapshotApi.saveSandboxSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        dossierId: "002",
        label: "玩家快照",
        createdBy: "player",
        reason: "manual",
        riskLevel: "safe",
        worldId: world.id,
        worldName: world.name,
        playthroughId: "pt_sandbox",
        currentSceneId: "entry",
        currentSceneName: "入口",
        currentNodeId: "node_root",
        serializedState,
        worldSnapshot,
        sandboxWorlds: [world],
      }),
    );
    expect(store.sandboxSnapshots).toEqual([record]);
  });

  it("restores a sandbox snapshot through deserializeState and worldline state", async () => {
    snapshotApi.loadSandboxSnapshot.mockResolvedValueOnce({
      version: "sandbox_snapshot_v1",
      record,
      serializedState,
      worldSnapshot,
      sandboxWorlds: [world],
      worldLine: { id: "wl_restored" },
      allNodes: { node_restored: { id: "node_restored" } },
      currentNode: { id: "node_restored" },
    });
    snapshotApi.listSandboxSnapshots.mockResolvedValueOnce([record]);
    const store = createTestStore({ currentWorld: null });

    const restored = await store.restoreSandboxSnapshot(record.id);

    expect(restored).toBe(true);
    expect(snapshotApi.loadSandboxSnapshot).toHaveBeenCalledWith("002", record.id);
    expect(store.deserializeState).toHaveBeenCalledWith(serializedState, world);
    expect(store.sandboxWorlds).toEqual([world]);
    expect(store.currentPlaythroughId).toBe("pt_sandbox");
    expect(store.worldLine).toEqual({ id: "wl_restored" });
    expect(store.currentNode).toEqual({ id: "node_restored" });
  });

  it("restores sandbox state without turning the restore operation into story evidence", async () => {
    snapshotApi.loadSandboxSnapshot.mockResolvedValueOnce({
      version: "sandbox_snapshot_v1",
      record,
      serializedState,
      worldSnapshot,
      sandboxWorlds: [world],
      worldLine: { id: "wl_restored" },
      allNodes: { node_restored: { id: "node_restored" } },
      currentNode: { id: "node_restored" },
    });
    snapshotApi.listSandboxSnapshots.mockResolvedValueOnce([record]);
    const store = createTestStore({ currentWorld: null });

    const restored = await store.restoreSandboxSnapshot(record.id);

    expect(restored).toBe(true);
    expect(store.addBoundaryEvent).not.toHaveBeenCalled();
    expect(store.boundaryEvents).toEqual([]);
  });

  it("deletes a sandbox snapshot from the active dossier and reloads the snapshot list", async () => {
    snapshotApi.deleteSandboxSnapshot.mockResolvedValueOnce(true);
    snapshotApi.listSandboxSnapshots.mockResolvedValueOnce([]);
    const store = createTestStore({ sandboxSnapshots: [record] });

    const deleted = await store.deleteSandboxSnapshot(record.id);

    expect(deleted).toBe(true);
    expect(snapshotApi.deleteSandboxSnapshot).toHaveBeenCalledWith("002", record.id);
    expect(store.sandboxSnapshots).toEqual([]);
  });
});
