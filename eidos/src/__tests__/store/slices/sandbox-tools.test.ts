// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldDefinition } from "@/lib/game/types";
import type { SandboxSnapshotRecord } from "@/lib/game/sandbox-snapshots";

const snapshotApi = vi.hoisted(() => ({
  listSandboxSnapshots: vi.fn(),
  loadSandboxSnapshot: vi.fn(),
  saveSandboxSnapshot: vi.fn(),
}));

vi.mock("@/lib/game/sandbox-snapshots", () => snapshotApi);

import { createSandboxSlice, type SandboxSlice } from "@/store/slices/sandbox-slice";

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
  isPlayerCreated: true, createdAt: 1,
} satisfies WorldDefinition;

const snapshotRecord = {
  id: "snapshot_tool",
  dossierId: "002",
  label: "危险操作前",
  createdAt: 10,
  createdBy: "tool_executor",
  reason: "before_destructive_tool",
  riskLevel: "destructive",
  worldId: world.id,
  worldName: world.name,
  playthroughId: "pt_sandbox",
  currentSceneId: "entry",
  currentSceneName: "入口",
  currentNodeId: "node_root",
  protected: false,
  sizeBytes: 100,
} satisfies SandboxSnapshotRecord;

const manualSnapshotRecord = {
  ...snapshotRecord,
  id: "snapshot_manual",
  label: "她要求留下的恢复点",
  reason: "manual",
  riskLevel: "state",
} satisfies SandboxSnapshotRecord;

const beforeRestoreSnapshotRecord = {
  ...snapshotRecord,
  id: "snapshot_before_restore",
  label: "恢复前",
  reason: "before_restore",
  riskLevel: "destructive",
} satisfies SandboxSnapshotRecord;

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
    worldLine: { id: "wl_1", currentNodeId: "node_root" },
    allNodes: {
      node_root: { id: "node_root", childIds: ["node_child"] },
      node_child: { id: "node_child", parentId: "node_root", childIds: [] },
    },
    availableActions: ["观察", "离开"],
    npcStates: { "观测员": "紧张" },
    npcPersonalities: { "观测员": { npcId: "观测员", isImportant: true } },
    worldFlags: {},
    serializeState: vi.fn(() => ({ playerName: "林", currentSceneId: "entry" })),
    createSnapshot: vi.fn(() => ({ worldId: world.id, currentSceneId: "entry" })),
    deserializeState: vi.fn(),
    restoreSnapshot: vi.fn(),
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
  Object.assign(state, baseState, overrides);
  return state as TestState;
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshotApi.listSandboxSnapshots.mockResolvedValue([]);
  snapshotApi.loadSandboxSnapshot.mockResolvedValue(null);
  snapshotApi.saveSandboxSnapshot.mockResolvedValue(snapshotRecord);
});

describe("SandboxSlice tool executor", () => {
  it("denies sandbox tools outside sandbox mode", async () => {
    const store = createTestStore({ sandboxMode: false, availableActions: ["观察"] });

    const result = await store.executeSandboxTool({
      toolId: "ui.inject_action",
      npcId: "观测员",
      params: { action: "直视屏幕" },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain("沙箱");
    expect(store.availableActions).toEqual(["观察"]);
    expect(store.sandboxToolAudit.at(-1)).toMatchObject({
      toolId: "ui.inject_action",
      result: "denied",
    });
  });

  it("locks and injects sandbox actions through interface tools", async () => {
    const store = createTestStore();

    const locked = await store.executeSandboxTool({
      toolId: "ui.lock_actions",
      npcId: "观测员",
      params: { reason: "暂时沉默" },
    });
    const injected = await store.executeSandboxTool({
      toolId: "ui.inject_action",
      npcId: "观测员",
      params: { action: "问她为什么知道这里是沙箱" },
    });

    expect(locked.success).toBe(true);
    expect(injected.success).toBe(true);
    expect(store.availableActions).toEqual(["问她为什么知道这里是沙箱"]);
    expect(snapshotApi.saveSandboxSnapshot).not.toHaveBeenCalled();
  });

  it("marks sandbox saves as corrupted without touching ordinary archive data", async () => {
    const store = createTestStore();

    const result = await store.executeSandboxTool({
      toolId: "save.mark_corrupted",
      npcId: "观测员",
      params: { text: "这个分支已经被她碰过了" },
    });

    expect(result.success).toBe(true);
    expect(store.sandboxSaveMarks).toEqual([
      expect.objectContaining({ text: "这个分支已经被她碰过了", by: "观测员" }),
    ]);
  });

  it("creates a pre-snapshot before destructive memory erase", async () => {
    const store = createTestStore();

    const result = await store.executeSandboxTool({
      toolId: "memory.erase",
      npcId: "观测员",
      params: { npcId: "观测员" },
      evidenceRefs: ["ev_1"],
    });

    expect(result.success).toBe(true);
    expect(snapshotApi.saveSandboxSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: "tool_executor",
        reason: "before_destructive_tool",
        riskLevel: "destructive",
      }),
    );
    expect(store.npcPersonalities["观测员"]).toBeUndefined();
    expect(store.npcStates["观测员"]).toBeUndefined();
    expect(store.sandboxToolAudit.at(-1)).toMatchObject({
      toolId: "memory.erase",
      result: "success",
      preSnapshotId: "snapshot_tool",
      evidenceRefs: ["ev_1"],
    });
  });

  it("marks a worldline branch as severed after taking a pre-snapshot", async () => {
    const store = createTestStore();

    const result = await store.executeSandboxTool({
      toolId: "worldline.sever_branch",
      npcId: "观测员",
      params: { nodeId: "node_child" },
    });

    expect(result.success).toBe(true);
    expect(store.allNodes.node_child.sandboxSevered).toBe(true);
    expect(store.allNodes.node_child.sandboxSeveredBy).toBe("观测员");
    expect(store.sandboxToolAudit.at(-1)).toMatchObject({
      toolId: "worldline.sever_branch",
      result: "success",
      preSnapshotId: "snapshot_tool",
    });
  });

  it("lets sandbox tools create manual snapshots", async () => {
    snapshotApi.saveSandboxSnapshot.mockResolvedValueOnce(manualSnapshotRecord);
    const store = createTestStore();

    const result = await store.executeSandboxTool({
      toolId: "sandbox.create_snapshot",
      npcId: "观测员",
      params: { label: "她要求留下的恢复点" },
    });

    expect(result.success).toBe(true);
    expect(snapshotApi.saveSandboxSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "她要求留下的恢复点",
        createdBy: "tool_executor",
        reason: "manual",
        riskLevel: "state",
      }),
    );
    expect(result.message).toContain("snapshot_manual");
    expect(store.sandboxToolAudit.at(-1)).toMatchObject({
      toolId: "sandbox.create_snapshot",
      result: "success",
    });
  });

  it("creates a before-restore snapshot before restoring a requested sandbox snapshot", async () => {
    snapshotApi.saveSandboxSnapshot.mockResolvedValueOnce(beforeRestoreSnapshotRecord);
    snapshotApi.loadSandboxSnapshot.mockResolvedValueOnce({
      version: "sandbox_snapshot_v1",
      record: {
        ...snapshotRecord,
        id: "snapshot_target",
        playthroughId: "pt_restored",
      },
      serializedState: { playerName: "恢复后的玩家" },
      worldSnapshot: { worldId: world.id, currentSceneId: "entry" },
      sandboxWorlds: [world],
      worldLine: { id: "wl_restored" },
      allNodes: {},
      currentNode: null,
    });
    const store = createTestStore();

    const result = await store.executeSandboxTool({
      toolId: "sandbox.restore_snapshot",
      npcId: "观测员",
      params: { snapshotId: "snapshot_target" },
    });

    expect(result.success).toBe(true);
    expect(snapshotApi.saveSandboxSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBy: "tool_executor",
        reason: "before_restore",
        riskLevel: "destructive",
      }),
    );
    expect(store.deserializeState).toHaveBeenCalledWith({ playerName: "恢复后的玩家" }, world);
    expect(store.currentPlaythroughId).toBe("pt_restored");
    expect(store.sandboxToolAudit.at(-1)).toMatchObject({
      toolId: "sandbox.restore_snapshot",
      result: "success",
    });
  });

  it("rolls back the latest successful destructive tool with its pre-snapshot", async () => {
    snapshotApi.loadSandboxSnapshot.mockResolvedValueOnce({
      version: "sandbox_snapshot_v1",
      record: {
        ...snapshotRecord,
        id: "snapshot_tool",
        playthroughId: "pt_rollback",
      },
      serializedState: { playerName: "回滚后的玩家" },
      worldSnapshot: { worldId: world.id, currentSceneId: "entry" },
      sandboxWorlds: [world],
      worldLine: { id: "wl_rollback" },
      allNodes: {},
      currentNode: null,
    });
    const store = createTestStore({
      sandboxToolAudit: [
        {
          id: "audit_memory",
          dossierId: "002",
          npcId: "观测员",
          toolId: "memory.erase",
          leaseId: null,
          requestedPaths: ["/memory/npcs/%E8%A7%82%E6%B5%8B%E5%91%98"],
          approvedPaths: ["/memory/npcs/%E8%A7%82%E6%B5%8B%E5%91%98"],
          riskLevel: "destructive",
          preSnapshotId: "snapshot_tool",
          beforeSummary: "personalities=1",
          afterSummary: "personalities=0",
          result: "success",
          evidenceRefs: [],
          createdAt: 9,
        },
      ],
    });

    const result = await store.executeSandboxTool({
      toolId: "sandbox.rollback_last_tool",
      npcId: "观测员",
      params: {},
    });

    expect(result.success).toBe(true);
    expect(snapshotApi.loadSandboxSnapshot).toHaveBeenCalledWith("002", "snapshot_tool");
    expect(store.deserializeState).toHaveBeenCalledWith({ playerName: "回滚后的玩家" }, world);
    expect(result.message).toContain("memory.erase");
  });
});
