// ============================================================
// Eidos · 沙箱快照存储
// ============================================================
// 快照是沙箱高权限玩法的恢复锚点。AI 可以破坏沙箱内容，
// 但不能破坏受保护快照和恢复入口。

import { getSandboxDossierId, sandboxStorageKey } from "@/lib/game/archive-scope";
import { loadFromDB, loadMeta, removeFromDB, saveMeta, saveToDB } from "@/lib/game/storage";

export const SANDBOX_SNAPSHOT_VERSION = "sandbox_snapshot_v1";
const SNAPSHOT_INDEX_KEY = "snapshot_index";
const SNAPSHOT_BLOB_PREFIX = "snapshot_blob_";
const MAX_INDEX_RECORDS = 80;

export type SandboxSnapshotCreator = "player" | "auto" | "tool_executor";
export type SandboxSnapshotReason =
  | "manual"
  | "enter_sandbox"
  | "before_destructive_tool"
  | "before_restore"
  | "before_worldline_fork"
  | "scheduled";
export type SandboxSnapshotRiskLevel = "safe" | "state" | "destructive" | "root_content";

export interface SandboxSnapshotRecord {
  id: string;
  dossierId: string;
  label: string;
  createdAt: number;
  createdBy: SandboxSnapshotCreator;
  reason: SandboxSnapshotReason;
  riskLevel: SandboxSnapshotRiskLevel;
  worldId: string | null;
  worldName?: string | null;
  playthroughId: string | null;
  currentSceneId: string | null;
  currentSceneName?: string | null;
  currentNodeId: string | null;
  protected: boolean;
  sizeBytes: number;
}

export interface SandboxSnapshotPayload {
  version: typeof SANDBOX_SNAPSHOT_VERSION;
  record: SandboxSnapshotRecord;
  serializedState: unknown;
  worldSnapshot: unknown;
  sandboxWorlds: unknown[];
  worldLine?: unknown;
  allNodes?: unknown;
  currentNode?: unknown;
}

export interface SaveSandboxSnapshotInput {
  dossierId?: string | null;
  label?: string;
  createdBy: SandboxSnapshotCreator;
  reason: SandboxSnapshotReason;
  riskLevel: SandboxSnapshotRiskLevel;
  worldId?: string | null;
  worldName?: string | null;
  playthroughId?: string | null;
  currentSceneId?: string | null;
  currentSceneName?: string | null;
  currentNodeId?: string | null;
  protected?: boolean;
  serializedState: unknown;
  worldSnapshot: unknown;
  sandboxWorlds?: unknown[];
  worldLine?: unknown;
  allNodes?: unknown;
  currentNode?: unknown;
}

export function sandboxSnapshotIndexKey(dossierId?: string | null): string {
  return sandboxStorageKey(dossierId, SNAPSHOT_INDEX_KEY);
}

export function sandboxSnapshotBlobKey(
  dossierId: string | null | undefined,
  snapshotId: string,
): string {
  return sandboxStorageKey(dossierId, `${SNAPSHOT_BLOB_PREFIX}${snapshotId}`);
}

export async function listSandboxSnapshots(
  dossierId?: string | null,
): Promise<SandboxSnapshotRecord[]> {
  const records = (await loadMeta<SandboxSnapshotRecord[]>(
    sandboxSnapshotIndexKey(dossierId),
  )) ?? [];
  return records.filter(isSnapshotRecord).sort(compareNewestFirst);
}

export async function saveSandboxSnapshot(
  input: SaveSandboxSnapshotInput,
): Promise<SandboxSnapshotRecord> {
  const dossierId = getSandboxDossierId(input.dossierId);
  const now = Date.now();
  const record: SandboxSnapshotRecord = {
    id: createSnapshotId(now),
    dossierId,
    label: input.label?.trim() || defaultSnapshotLabel(input.reason),
    createdAt: now,
    createdBy: input.createdBy,
    reason: input.reason,
    riskLevel: input.riskLevel,
    worldId: input.worldId ?? null,
    worldName: input.worldName ?? null,
    playthroughId: input.playthroughId ?? null,
    currentSceneId: input.currentSceneId ?? null,
    currentSceneName: input.currentSceneName ?? null,
    currentNodeId: input.currentNodeId ?? null,
    protected: input.protected ?? input.reason === "enter_sandbox",
    sizeBytes: 0,
  };

  const payload: SandboxSnapshotPayload = {
    version: SANDBOX_SNAPSHOT_VERSION,
    record,
    serializedState: input.serializedState,
    worldSnapshot: input.worldSnapshot,
    sandboxWorlds: input.sandboxWorlds ?? [],
    worldLine: input.worldLine,
    allNodes: input.allNodes,
    currentNode: input.currentNode,
  };
  record.sizeBytes = safeJsonSize(payload);

  await saveToDB(sandboxSnapshotBlobKey(dossierId, record.id), payload);
  const nextIndex = normalizeSnapshotIndex([
    record,
    ...(await listSandboxSnapshots(dossierId)).filter((candidate) => candidate.id !== record.id),
  ]);
  await saveMeta(sandboxSnapshotIndexKey(dossierId), nextIndex);

  return record;
}

export async function loadSandboxSnapshot(
  dossierId: string | null | undefined,
  snapshotId: string,
): Promise<SandboxSnapshotPayload | null> {
  const payload = await loadFromDB(sandboxSnapshotBlobKey(dossierId, snapshotId));
  return isSnapshotPayload(payload) ? payload : null;
}

export async function deleteSandboxSnapshot(
  dossierId: string | null | undefined,
  snapshotId: string,
): Promise<boolean> {
  const activeDossierId = getSandboxDossierId(dossierId);
  const records = await listSandboxSnapshots(activeDossierId);
  if (!records.some((record) => record.id === snapshotId)) return false;

  await removeFromDB(sandboxSnapshotBlobKey(activeDossierId, snapshotId));
  await saveMeta(
    sandboxSnapshotIndexKey(activeDossierId),
    normalizeSnapshotIndex(records.filter((record) => record.id !== snapshotId)),
  );
  return true;
}

function normalizeSnapshotIndex(records: SandboxSnapshotRecord[]): SandboxSnapshotRecord[] {
  const unique = new Map<string, SandboxSnapshotRecord>();
  for (const record of records.filter(isSnapshotRecord).sort(compareNewestFirst)) {
    unique.set(record.id, record);
  }
  const sorted = Array.from(unique.values()).sort(compareNewestFirst);
  const protectedRecords = sorted.filter((record) => record.protected);
  const regularRecords = sorted.filter((record) => !record.protected);
  return [...protectedRecords, ...regularRecords].slice(0, MAX_INDEX_RECORDS).sort(compareNewestFirst);
}

function createSnapshotId(now: number): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `snapshot_${now}_${suffix}`;
}

function defaultSnapshotLabel(reason: SandboxSnapshotReason): string {
  switch (reason) {
    case "enter_sandbox":
      return "沙箱根快照";
    case "before_destructive_tool":
      return "危险操作前";
    case "before_restore":
      return "恢复前";
    case "before_worldline_fork":
      return "世界线分叉前";
    case "scheduled":
      return "自动快照";
    case "manual":
    default:
      return "手动快照";
  }
}

function compareNewestFirst(a: SandboxSnapshotRecord, b: SandboxSnapshotRecord): number {
  return b.createdAt - a.createdAt;
}

function safeJsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function isSnapshotRecord(value: unknown): value is SandboxSnapshotRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<SandboxSnapshotRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.dossierId === "string" &&
    typeof record.label === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.createdBy === "string" &&
    typeof record.reason === "string" &&
    typeof record.riskLevel === "string" &&
    typeof record.protected === "boolean"
  );
}

function isSnapshotPayload(value: unknown): value is SandboxSnapshotPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<SandboxSnapshotPayload>;
  return payload.version === SANDBOX_SNAPSHOT_VERSION && isSnapshotRecord(payload.record);
}
