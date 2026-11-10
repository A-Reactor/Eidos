import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  saveMeta: vi.fn(),
  loadMeta: vi.fn(),
  saveToDB: vi.fn(),
  loadFromDB: vi.fn(),
  removeFromDB: vi.fn(),
}));

vi.mock("@/lib/game/storage", () => storage);

import {
  deleteSandboxSnapshot,
  listSandboxSnapshots,
  loadSandboxSnapshot,
  sandboxSnapshotBlobKey,
  sandboxSnapshotIndexKey,
  saveSandboxSnapshot,
  type SandboxSnapshotRecord,
} from "@/lib/game/sandbox-snapshots";

const serializedState = {
  playerName: "林",
  currentSceneId: "entry",
  gameTime: { day: 0, hour: 8, minute: 0 },
};

const worldSnapshot = {
  worldId: "sandbox-world",
  currentSceneId: "entry",
  currentGameTime: { day: 0, hour: 8, minute: 0 },
  playerName: "林",
  sceneNarrative: "沙箱初始场景",
  historyLength: 0,
  discoveredSecrets: {},
  worldFlags: {},
  sceneDetailLevels: {},
  visitedScenes: [],
  resolvedTimelineEvents: [],
  deviatedEvents: {},
  inventory: [],
  clues: [],
  encyclopedia: [],
  availableActions: [],
  criticalFacts: [],
  questLog: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.loadMeta.mockResolvedValue([]);
  storage.saveMeta.mockResolvedValue(undefined);
  storage.saveToDB.mockResolvedValue(undefined);
  storage.loadFromDB.mockResolvedValue(null);
  storage.removeFromDB.mockResolvedValue(undefined);
});

describe("sandbox snapshots", () => {
  it("scopes snapshot keys to the sandbox dossier", () => {
    expect(sandboxSnapshotIndexKey("002")).toBe("sandbox_002_snapshot_index");
    expect(sandboxSnapshotBlobKey("002", "snap_1")).toBe("sandbox_002_snapshot_blob_snap_1");
  });

  it("saves a protected root snapshot with a matching blob and index entry", async () => {
    const record = await saveSandboxSnapshot({
      dossierId: "002",
      label: "根快照",
      createdBy: "auto",
      reason: "enter_sandbox",
      riskLevel: "safe",
      worldId: "sandbox-world",
      worldName: "沙箱世界",
      playthroughId: "pt_sandbox",
      currentSceneId: "entry",
      currentSceneName: "入口",
      currentNodeId: "node_root",
      serializedState,
      worldSnapshot,
      sandboxWorlds: [{ id: "sandbox-world", name: "沙箱世界" }],
    });

    expect(record.id).toMatch(/^snapshot_/);
    expect(record.protected).toBe(true);
    expect(record.worldName).toBe("沙箱世界");
    expect(storage.saveToDB).toHaveBeenCalledWith(
      sandboxSnapshotBlobKey("002", record.id),
      expect.objectContaining({
        version: "sandbox_snapshot_v1",
        record,
        serializedState,
        worldSnapshot,
      }),
    );
    expect(storage.saveMeta).toHaveBeenCalledWith(
      sandboxSnapshotIndexKey("002"),
      [expect.objectContaining({ id: record.id, protected: true })],
    );
  });

  it("lists snapshot records newest first", async () => {
    const older = makeRecord("snapshot_old", 10);
    const newer = makeRecord("snapshot_new", 20);
    storage.loadMeta.mockResolvedValueOnce([older, newer]);

    const records = await listSandboxSnapshots("002");

    expect(records.map((record) => record.id)).toEqual(["snapshot_new", "snapshot_old"]);
  });

  it("loads a stored snapshot blob by dossier and snapshot id", async () => {
    const record = {
      id: "snapshot_loaded",
      dossierId: "002",
      label: "可恢复快照",
      createdAt: 30,
      createdBy: "player",
      reason: "manual",
      riskLevel: "safe",
      worldId: "sandbox-world",
      worldName: "沙箱世界",
      playthroughId: "pt_sandbox",
      currentSceneId: "entry",
      currentSceneName: "入口",
      currentNodeId: "node_loaded",
      protected: false,
      sizeBytes: 1,
    } satisfies SandboxSnapshotRecord;
    storage.loadFromDB.mockResolvedValueOnce({
      version: "sandbox_snapshot_v1",
      record,
      serializedState,
      worldSnapshot,
      sandboxWorlds: [],
    });

    const loaded = await loadSandboxSnapshot("002", "snapshot_loaded");

    expect(storage.loadFromDB).toHaveBeenCalledWith(
      sandboxSnapshotBlobKey("002", "snapshot_loaded"),
    );
    expect(loaded?.record.id).toBe("snapshot_loaded");
    expect(loaded?.serializedState).toEqual(serializedState);
  });

  it("deletes a snapshot blob and removes the record from the dossier index", async () => {
    const target = makeRecord("snapshot_delete", 20);
    const other = makeRecord("snapshot_keep", 10);
    storage.loadMeta.mockResolvedValueOnce([target, other]);

    const deleted = await deleteSandboxSnapshot("002", "snapshot_delete");

    expect(deleted).toBe(true);
    expect(storage.removeFromDB).toHaveBeenCalledWith(
      sandboxSnapshotBlobKey("002", "snapshot_delete"),
    );
    expect(storage.saveMeta).toHaveBeenCalledWith(
      sandboxSnapshotIndexKey("002"),
      [expect.objectContaining({ id: "snapshot_keep" })],
    );
  });

  it("returns false when deleting a missing snapshot", async () => {
    storage.loadMeta.mockResolvedValueOnce([makeRecord("snapshot_keep", 10)]);

    const deleted = await deleteSandboxSnapshot("002", "snapshot_missing");

    expect(deleted).toBe(false);
    expect(storage.removeFromDB).not.toHaveBeenCalled();
    expect(storage.saveMeta).not.toHaveBeenCalled();
  });
});

function makeRecord(id: string, createdAt: number): SandboxSnapshotRecord {
  return {
    id,
    dossierId: "002",
    label: id,
    createdAt,
    createdBy: "player",
    reason: "manual",
    riskLevel: "safe",
    worldId: "sandbox-world",
    worldName: "沙箱世界",
    playthroughId: "pt_sandbox",
    currentSceneId: "entry",
    currentSceneName: "入口",
    currentNodeId: "node",
    protected: false,
    sizeBytes: 1,
  };
}
