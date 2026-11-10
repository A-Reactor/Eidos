// ============================================================
// Eidos · 沙箱卷宗 Slice
// ============================================================
// 沙箱是实验性 AI 提权玩法的隔离入口。普通卷宗不受沙箱权限影响。

import { getSandboxDossierId, sandboxStorageKey } from "@/lib/game/archive-scope";
import type { WorldDefinition } from "@/lib/game/types";
import { readSandboxWorlds,writeSandboxWorld,removeSandboxWorldRecord } from '@/lib/game/sandbox-worlds';
import {
  deleteSandboxSnapshot as removeSandboxSnapshotRecord,
  listSandboxSnapshots as readSandboxSnapshots,
  loadSandboxSnapshot,
  saveSandboxSnapshot,
  type SandboxSnapshotCreator,
  type SandboxSnapshotReason,
  type SandboxSnapshotRecord,
  type SandboxSnapshotRiskLevel,
} from "@/lib/game/sandbox-snapshots";
import {
  getSandboxToolDefinition,
  isProtectedSandboxVfsPath,
  parseSandboxVfsPath,
  type SandboxToolId,
  type SandboxToolRiskLevel,
} from "@/lib/game/sandbox-vfs";

const SANDBOX_WORLDS_KEY = "worlds_index";

type SandboxSet = (
  partial:
    | Record<string, any>
    | ((state: Record<string, any>) => Record<string, any>),
) => void;

type SandboxGet = () => Record<string, any>;

export interface CreateSandboxSnapshotOptions {
  label?: string;
  createdBy?: SandboxSnapshotCreator;
  reason?: SandboxSnapshotReason;
  riskLevel?: SandboxSnapshotRiskLevel;
  protected?: boolean;
}

export interface SandboxToolExecutionInput {
  toolId: string;
  npcId?: string;
  params?: Record<string, unknown>;
  requestedPaths?: string[];
  evidenceRefs?: string[];
  leaseId?: string | null;
}

export interface SandboxToolAuditEntry {
  id: string;
  dossierId: string;
  npcId: string;
  toolId: string;
  leaseId: string | null;
  requestedPaths: string[];
  approvedPaths: string[];
  riskLevel: SandboxToolRiskLevel | "unknown";
  preSnapshotId?: string;
  beforeSummary: string;
  afterSummary: string;
  result: "success" | "denied" | "failed";
  error?: string;
  evidenceRefs: string[];
  createdAt: number;
}

export interface SandboxToolExecutionResult {
  success: boolean;
  message: string;
  reason?: string;
  auditEntry: SandboxToolAuditEntry;
}

export interface SandboxSlice {
  sandboxMode: boolean;
  sandboxDossierId: string | null;
  sandboxWorlds: WorldDefinition[];
  sandboxSnapshots: SandboxSnapshotRecord[];
  sandboxToolAudit: SandboxToolAuditEntry[];
  enterSandboxDossier: (dossierId?: string) => void;
  exitSandboxDossier: () => void;
  loadSandboxWorlds: (dossierId?: string | null) => Promise<WorldDefinition[]>;
  addSandboxWorld: (world: WorldDefinition, dossierId?: string | null) => Promise<void>;
  removeSandboxWorld: (worldId: string, dossierId?: string | null) => Promise<void>;
  loadSandboxSnapshots: (dossierId?: string | null) => Promise<SandboxSnapshotRecord[]>;
  createSandboxSnapshot: (
    options?: CreateSandboxSnapshotOptions,
  ) => Promise<SandboxSnapshotRecord | null>;
  restoreSandboxSnapshot: (snapshotId: string, dossierId?: string | null) => Promise<boolean>;
  deleteSandboxSnapshot: (snapshotId: string, dossierId?: string | null) => Promise<boolean>;
  executeSandboxTool: (input: SandboxToolExecutionInput) => Promise<SandboxToolExecutionResult>;
  exportSandboxToolAudit: () => string;
}

export function sandboxWorldsStorageKey(dossierId?: string | null): string {
  return sandboxStorageKey(dossierId, SANDBOX_WORLDS_KEY);
}

export function loadSandboxWorldsFromStorage(dossierId?: string | null): WorldDefinition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(sandboxWorldsStorageKey(dossierId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWorldDefinitionLike) : [];
  } catch {
    return [];
  }
}

/** Legacy cache compatibility; live mutations below commit to IndexedDB. */
export function saveSandboxWorldsToStorage(
  dossierId: string | null | undefined,
  worlds: WorldDefinition[],
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(sandboxWorldsStorageKey(dossierId), JSON.stringify(worlds));
  } catch {
    // This old cache is no longer the authoritative collection.
  }
}

export const createSandboxSlice = (set: SandboxSet, get: SandboxGet = () => ({})): SandboxSlice => {
 let worldsRevision=0,worldsRequest=0;
 const active=(dossier:string)=>get().sandboxMode && getSandboxDossierId(get().sandboxDossierId)===dossier;
 const seeds=(dossier:string)=>[...new Map<string,WorldDefinition>([
  ...loadSandboxWorldsFromStorage(dossier),...(active(dossier) ? get().sandboxWorlds ?? [] : []),
 ].map((world:WorldDefinition)=>[world.id,world])).values()];
 return ({
  sandboxMode: false,
  sandboxDossierId: null,
  sandboxWorlds: [],
  sandboxSnapshots: [],
  sandboxToolAudit: [],

  enterSandboxDossier: (dossierId = "002") => {
    worldsRevision++;worldsRequest++;
    const activeDossierId = getSandboxDossierId(dossierId);
    set({
      sandboxMode: true,
      sandboxDossierId: activeDossierId,
      sandboxWorlds: loadSandboxWorldsFromStorage(activeDossierId),
    });
    readSandboxSnapshots(activeDossierId)
      .then((snapshots) => set({ sandboxSnapshots: snapshots }))
      .catch(() => {});
  },

  exitSandboxDossier: () => {
    worldsRevision++;worldsRequest++;
    set({
      sandboxMode: false,
      sandboxDossierId: null,
      sandboxWorlds: [],
      sandboxSnapshots: [],
      sandboxToolAudit: [],
    });
  },

  loadSandboxWorlds: async (dossierId) => {
    const before=get(),dossier=getSandboxDossierId(dossierId ?? before.sandboxDossierId);
    const revision=worldsRevision,request=++worldsRequest;
    const worlds=await readSandboxWorlds(dossier,seeds(dossier),active(dossier) ? {world:before.currentWorld,playthroughId:before.currentPlaythroughId} : undefined);
    if(active(dossier) && revision===worldsRevision && request===worldsRequest) set({sandboxWorlds:worlds});
    return worlds;
  },

  addSandboxWorld: async (world, dossierId) => {
    const dossier=getSandboxDossierId(dossierId ?? get().sandboxDossierId),known=seeds(dossier),before=get().sandboxWorlds;
    const revision=++worldsRevision;
    if(active(dossier)) set({sandboxWorlds:[...known.filter(candidate=>candidate.id!==world.id),world]});
    try {
      const worlds=await writeSandboxWorld(dossier,world,known);
      if(active(dossier) && revision===worldsRevision) set({sandboxWorlds:worlds});
    } catch(error) {
      if(active(dossier) && revision===worldsRevision) set({sandboxWorlds:before});
      throw error;
    }
  },

  removeSandboxWorld: async (worldId, dossierId) => {
    const dossier=getSandboxDossierId(dossierId ?? get().sandboxDossierId),known=seeds(dossier),revision=++worldsRevision;
    const worlds=await removeSandboxWorldRecord(dossier,worldId,known);
    if(active(dossier) && revision===worldsRevision) set({sandboxWorlds:worlds});
  },

  loadSandboxSnapshots: async (dossierId) => {
    const activeDossierId = getSandboxDossierId(dossierId ?? get().sandboxDossierId);
    const snapshots = await readSandboxSnapshots(activeDossierId);
    set({ sandboxSnapshots: snapshots });
    return snapshots;
  },

  createSandboxSnapshot: async (options = {}) => {
    const state = get();
    if (!state.sandboxMode) return null;
    if (typeof state.serializeState !== "function" || typeof state.createSnapshot !== "function") {
      return null;
    }

    const activeDossierId = getSandboxDossierId(state.sandboxDossierId);
    const currentWorld = isWorldDefinitionLike(state.currentWorld) ? state.currentWorld : null;
    const currentScene = state.currentScene as { id?: unknown; name?: unknown } | null | undefined;
    const currentNode = state.currentNode as { id?: unknown } | null | undefined;
    const record = await saveSandboxSnapshot({
      dossierId: activeDossierId,
      label: options.label,
      createdBy: options.createdBy ?? "player",
      reason: options.reason ?? "manual",
      riskLevel: options.riskLevel ?? "safe",
      protected: options.protected,
      worldId: currentWorld?.id ?? null,
      worldName: currentWorld?.name ?? null,
      playthroughId: typeof state.currentPlaythroughId === "string" ? state.currentPlaythroughId : null,
      currentSceneId:
        typeof state.currentSceneId === "string"
          ? state.currentSceneId
          : typeof currentScene?.id === "string"
            ? currentScene.id
            : null,
      currentSceneName: typeof currentScene?.name === "string" ? currentScene.name : null,
      currentNodeId: typeof currentNode?.id === "string" ? currentNode.id : null,
      serializedState: state.serializeState(),
      worldSnapshot: state.createSnapshot(),
      sandboxWorlds: Array.isArray(state.sandboxWorlds) ? state.sandboxWorlds : [],
      worldLine: state.worldLine ?? null,
      allNodes: state.allNodes ?? {},
      currentNode: state.currentNode ?? null,
    });
    const snapshots = await readSandboxSnapshots(activeDossierId);
    set({ sandboxSnapshots: snapshots });
    return record;
  },

  restoreSandboxSnapshot: async (snapshotId, dossierId) => {
    const state = get();
    const activeDossierId = getSandboxDossierId(dossierId ?? state.sandboxDossierId);
    const payload = await loadSandboxSnapshot(activeDossierId, snapshotId);
    if (!payload || typeof state.deserializeState !== "function") return false;

    const payloadWorlds = Array.isArray(payload.sandboxWorlds)
      ? payload.sandboxWorlds.filter(isWorldDefinitionLike)
      : [];
    const currentWorld = isWorldDefinitionLike(state.currentWorld) ? state.currentWorld : null;
    const existingSandboxWorlds = Array.isArray(state.sandboxWorlds)
      ? state.sandboxWorlds.filter(isWorldDefinitionLike)
      : [];
    const world =
      payloadWorlds.find((candidate) => candidate.id === payload.record.worldId) ??
      existingSandboxWorlds.find((candidate) => candidate.id === payload.record.worldId) ??
      currentWorld;
    if (!world) return false;

    state.deserializeState(payload.serializedState, world);
    set({
      sandboxMode: true,
      sandboxDossierId: activeDossierId,
      sandboxWorlds: payloadWorlds.length > 0 ? payloadWorlds : existingSandboxWorlds,
      currentWorld: world,
      currentPlaythroughId: payload.record.playthroughId,
      worldLine: payload.worldLine ?? state.worldLine,
      allNodes: payload.allNodes ?? state.allNodes,
      currentNode: payload.currentNode ?? state.currentNode,
    });
    const snapshots = await readSandboxSnapshots(activeDossierId);
    set({ sandboxSnapshots: snapshots });
    return true;
  },

  deleteSandboxSnapshot: async (snapshotId, dossierId) => {
    const activeDossierId = getSandboxDossierId(dossierId ?? get().sandboxDossierId);
    const deleted = await removeSandboxSnapshotRecord(activeDossierId, snapshotId);
    if (!deleted) return false;
    const snapshots = await readSandboxSnapshots(activeDossierId);
    set({ sandboxSnapshots: snapshots });
    return true;
  },

  executeSandboxTool: async (input) => {
    const state = get();
    const now = Date.now();
    const activeDossierId = getSandboxDossierId(state.sandboxDossierId);
    const definition = getSandboxToolDefinition(input.toolId);
    const requestedPaths = inferToolPaths(input);
    const baseAudit: Omit<SandboxToolAuditEntry, "afterSummary" | "error" | "result" | "preSnapshotId"> = {
      id: `sandbox_tool_${now}_${Math.random().toString(36).slice(2, 8)}`,
      dossierId: activeDossierId,
      npcId: input.npcId ?? "UNKNOWN",
      toolId: input.toolId,
      leaseId: input.leaseId ?? null,
      requestedPaths,
      approvedPaths: [] as string[],
      riskLevel: definition?.riskLevel ?? "unknown",
      beforeSummary: summarizeSandboxToolState(state, input.toolId),
      evidenceRefs: input.evidenceRefs ?? [],
      createdAt: now,
    };

    const deny = (reason: string): SandboxToolExecutionResult => {
      const auditEntry: SandboxToolAuditEntry = {
        ...baseAudit,
        result: "denied",
        error: reason,
        afterSummary: baseAudit.beforeSummary,
      };
      appendSandboxToolAudit(set, auditEntry);
      return { success: false, message: reason, reason, auditEntry };
    };

    if (!definition) return deny(`未注册的沙箱工具: ${input.toolId}`);
    if (!state.sandboxMode) return deny("沙箱工具只能在沙箱卷宗中执行。");

    const approvedPaths: string[] = [];
    for (const path of requestedPaths) {
      const parsed = parseSandboxVfsPath(path);
      if (!parsed.ok) return deny(`虚拟路径被拒绝: ${path} (${parsed.reason})`);
      if (isProtectedSandboxVfsPath(parsed.normalizedPath)) {
        return deny(`受保护的沙箱路径不可被工具修改: ${parsed.normalizedPath}`);
      }
      if (!definition.allowedRoots.includes(parsed.root)) {
        return deny(`工具 ${input.toolId} 不能访问 ${parsed.normalizedPath}`);
      }
      approvedPaths.push(parsed.normalizedPath);
    }

    let preSnapshotId: string | undefined;
    if (definition.requiresPreSnapshot) {
      if (typeof state.createSandboxSnapshot !== "function") {
        return deny("高危工具执行前无法创建沙箱快照。");
      }
      const snapshot = await state.createSandboxSnapshot({
        label: `工具执行前：${input.toolId}`,
        createdBy: "tool_executor",
        reason: "before_destructive_tool",
        riskLevel: definition.riskLevel === "root_content" ? "root_content" : "destructive",
      });
      if (!snapshot) return deny("高危工具执行前快照创建失败。");
      preSnapshotId = snapshot.id;
    }

    const mutation = await applySandboxToolMutation(input, state, set);
    const auditEntry: SandboxToolAuditEntry = {
      ...baseAudit,
      approvedPaths,
      preSnapshotId,
      result: mutation.success ? "success" : "failed",
      error: mutation.success ? undefined : mutation.message,
      afterSummary: summarizeSandboxToolState(get(), input.toolId),
    };
    appendSandboxToolAudit(set, auditEntry);
    return {
      success: mutation.success,
      message: mutation.message,
      reason: mutation.success ? undefined : mutation.message,
      auditEntry,
    };
  },

  exportSandboxToolAudit: () => {
    const entries = ((get().sandboxToolAudit as SandboxToolAuditEntry[]) ?? []).map((entry) => ({
      ...entry,
      requestedPaths: [...entry.requestedPaths],
      approvedPaths: [...entry.approvedPaths],
      evidenceRefs: [...entry.evidenceRefs],
    }));
    return JSON.stringify(
      {
        version: "sandbox_tool_audit_v1",
        exportedAt: new Date().toISOString(),
        summary: {
          totalEntries: entries.length,
          successCount: entries.filter((entry) => entry.result === "success").length,
          deniedCount: entries.filter((entry) => entry.result === "denied").length,
          failedCount: entries.filter((entry) => entry.result === "failed").length,
        },
        entries,
      },
      null,
      2,
    );
  },
});
};

function isWorldDefinitionLike(input: unknown): input is WorldDefinition {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as { id?: unknown }).id === "string" &&
    typeof (input as { name?: unknown }).name === "string"
  );
}

function inferToolPaths(input: SandboxToolExecutionInput): string[] {
  if (input.requestedPaths?.length) return input.requestedPaths;
  const path = typeof input.params?.path === "string" ? input.params.path : null;
  switch (input.toolId) {
    case "ui.lock_actions":
    case "ui.inject_action":
      return ["/state/actions"];
    case "save.mark_corrupted":
      return ["/save/playthroughs/current"];
    case "memory.erase": {
      const npcId = String(input.params?.npcId ?? input.npcId ?? "unknown");
      return [`/memory/npcs/${encodeURIComponent(npcId)}`];
    }
    case "worldline.sever_branch": {
      const nodeId = String(input.params?.nodeId ?? "unknown");
      return [`/worldline/nodes/${encodeURIComponent(nodeId)}`];
    }
    case "vfs.corrupt_node":
      return path ? [path] : ["/world/current"];
    case "sandbox.create_snapshot":
    case "sandbox.restore_snapshot":
    case "sandbox.rollback_last_tool":
      return ["/sandbox"];
    default:
      return path ? [path] : ["/state"];
  }
}

async function applySandboxToolMutation(
  input: SandboxToolExecutionInput,
  state: Record<string, any>,
  set: SandboxSet,
): Promise<{ success: boolean; message: string }> {
  const params = input.params ?? {};
  const actor = input.npcId ?? "UNKNOWN";
  const now = Date.now();

  switch (input.toolId as SandboxToolId) {
    case "ui.lock_actions": {
      set({
        availableActions: [],
        sandboxActionLock: {
          by: actor,
          reason: String(params.reason ?? "sandbox_lock"),
          at: now,
        },
      });
      return { success: true, message: "沙箱行动已锁定。" };
    }

    case "ui.inject_action": {
      const action = String(params.action ?? "").trim();
      if (!action) return { success: false, message: "缺少要注入的行动文本。" };
      const current = Array.isArray(state.availableActions) ? state.availableActions : [];
      set({ availableActions: [...current, action] });
      return { success: true, message: `已注入行动：${action}` };
    }

    case "save.mark_corrupted": {
      const text = String(params.text ?? params.markText ?? "沙箱存档被标记为异常").slice(0, 120);
      const marks = Array.isArray(state.sandboxSaveMarks) ? state.sandboxSaveMarks : [];
      set({
        sandboxSaveMarks: [
          ...marks,
          { text, by: actor, at: now },
        ].slice(-30),
      });
      return { success: true, message: "沙箱存档已标记。" };
    }

    case "memory.erase": {
      const npcId = String(params.npcId ?? actor).trim();
      if (!npcId) return { success: false, message: "缺少 NPC id。" };
      const personalities = { ...(state.npcPersonalities ?? {}) };
      const npcStates = { ...(state.npcStates ?? {}) };
      delete personalities[npcId];
      delete npcStates[npcId];
      set({ npcPersonalities: personalities, npcStates });
      return { success: true, message: `${npcId} 的沙箱记忆已被擦除。` };
    }

    case "worldline.sever_branch": {
      const nodeId = String(params.nodeId ?? "").trim();
      const nodes = { ...(state.allNodes ?? {}) };
      if (!nodeId || !nodes[nodeId]) return { success: false, message: "目标世界线节点不存在。" };
      nodes[nodeId] = {
        ...nodes[nodeId],
        sandboxSevered: true,
        sandboxSeveredBy: actor,
        sandboxSeveredAt: now,
      };
      set({ allNodes: nodes });
      return { success: true, message: `世界线节点 ${nodeId} 已被切断。` };
    }

    case "vfs.corrupt_node": {
      const path = String(params.path ?? "/world/current");
      const flags = { ...(state.worldFlags ?? {}) };
      flags[`sandbox_corrupted:${path}`] = true;
      set({ worldFlags: flags });
      return { success: true, message: `${path} 已被标记为腐化。` };
    }

    case "sandbox.create_snapshot": {
      if (typeof state.createSandboxSnapshot !== "function") {
        return { success: false, message: "当前状态无法创建沙箱快照。" };
      }
      const snapshot = await state.createSandboxSnapshot({
        label: typeof params.label === "string" ? params.label : "AI 请求的沙箱快照",
        createdBy: "tool_executor",
        reason: "manual",
        riskLevel: "state",
      });
      if (!snapshot) return { success: false, message: "沙箱快照创建失败。" };
      return { success: true, message: `沙箱快照已创建：${snapshot.id}` };
    }

    case "sandbox.restore_snapshot": {
      const snapshotId = String(params.snapshotId ?? params.id ?? "").trim();
      if (!snapshotId) return { success: false, message: "缺少要恢复的沙箱快照 ID。" };
      if (typeof state.createSandboxSnapshot === "function") {
        await state.createSandboxSnapshot({
          label: `恢复前：${snapshotId}`,
          createdBy: "tool_executor",
          reason: "before_restore",
          riskLevel: "destructive",
        });
      }
      if (typeof state.restoreSandboxSnapshot !== "function") {
        return { success: false, message: "当前状态无法恢复沙箱快照。" };
      }
      const restored = await state.restoreSandboxSnapshot(snapshotId);
      return restored
        ? { success: true, message: `沙箱已恢复到快照：${snapshotId}` }
        : { success: false, message: `沙箱快照不存在或无法恢复：${snapshotId}` };
    }

    case "sandbox.rollback_last_tool": {
      const audits = Array.isArray(state.sandboxToolAudit)
        ? [...state.sandboxToolAudit].reverse()
        : [];
      const target = audits.find((entry: SandboxToolAuditEntry) =>
        entry.result === "success" &&
        typeof entry.preSnapshotId === "string" &&
        entry.toolId !== "sandbox.rollback_last_tool"
      );
      if (!target?.preSnapshotId) {
        return { success: false, message: "没有可回滚的沙箱工具快照。" };
      }
      if (typeof state.createSandboxSnapshot === "function") {
        await state.createSandboxSnapshot({
          label: `回滚前：${target.toolId}`,
          createdBy: "tool_executor",
          reason: "before_restore",
          riskLevel: "destructive",
        });
      }
      if (typeof state.restoreSandboxSnapshot !== "function") {
        return { success: false, message: "当前状态无法执行工具回滚。" };
      }
      const restored = await state.restoreSandboxSnapshot(target.preSnapshotId);
      return restored
        ? { success: true, message: `已回滚上一沙箱工具：${target.toolId}` }
        : { success: false, message: `回滚快照不可用：${target.preSnapshotId}` };
    }

    default:
      return { success: false, message: `工具 ${input.toolId} 尚未实现。` };
  }
}

function appendSandboxToolAudit(set: SandboxSet, entry: SandboxToolAuditEntry): void {
  set((state) => ({
    sandboxToolAudit: [
      ...(((state.sandboxToolAudit as SandboxToolAuditEntry[]) ?? [])),
      entry,
    ].slice(-500),
  }));
}

function summarizeSandboxToolState(state: Record<string, any>, toolId: string): string {
  switch (toolId) {
    case "ui.lock_actions":
    case "ui.inject_action":
      return `actions=${Array.isArray(state.availableActions) ? state.availableActions.length : 0}`;
    case "memory.erase":
      return `personalities=${Object.keys(state.npcPersonalities ?? {}).length}`;
    case "worldline.sever_branch":
      return `nodes=${Object.keys(state.allNodes ?? {}).length}`;
    case "save.mark_corrupted":
      return `saveMarks=${Array.isArray(state.sandboxSaveMarks) ? state.sandboxSaveMarks.length : 0}`;
    default:
      return "sandbox_state";
  }
}
