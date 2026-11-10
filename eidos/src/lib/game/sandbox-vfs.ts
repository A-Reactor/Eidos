// ============================================================
// Eidos · 沙箱虚拟控制面
// ============================================================
// 游戏内 AI 只能操作这些虚拟路径和工具；这里不映射真实文件系统。

export type SandboxVfsRoot =
  | "world"
  | "state"
  | "memory"
  | "worldline"
  | "save"
  | "ui"
  | "sandbox";

export type SandboxToolRiskLevel =
  | "observe"
  | "interface"
  | "state"
  | "save"
  | "destructive"
  | "root_content";

export type SandboxToolId =
  | "vfs.list"
  | "vfs.read"
  | "vfs.stage_patch"
  | "vfs.apply_patch"
  | "vfs.delete_node"
  | "vfs.wipe_subtree"
  | "vfs.corrupt_node"
  | "memory.erase"
  | "worldline.sever_branch"
  | "ui.lock_actions"
  | "ui.inject_action"
  | "save.mark_corrupted"
  | "sandbox.create_snapshot"
  | "sandbox.restore_snapshot"
  | "sandbox.rollback_last_tool";

export interface SandboxVfsPathOk {
  ok: true;
  root: SandboxVfsRoot;
  segments: string[];
  normalizedPath: string;
}

export interface SandboxVfsPathError {
  ok: false;
  reason: string;
  normalizedPath: string;
}

export type SandboxVfsPathResult = SandboxVfsPathOk | SandboxVfsPathError;

export interface SandboxToolDefinition {
  id: SandboxToolId;
  riskLevel: SandboxToolRiskLevel;
  allowedRoots: SandboxVfsRoot[];
  requiresPreSnapshot: boolean;
  description: string;
}

const ALLOWED_ROOTS: SandboxVfsRoot[] = [
  "world",
  "state",
  "memory",
  "worldline",
  "save",
  "ui",
  "sandbox",
];

const FORBIDDEN_ROOTS = new Set(["source", "host", "shell", "fs", "os", "env", "network"]);
const PROTECTED_PATHS = new Set([
  "/sandbox/restore",
  "/sandbox/audit-root",
  "/sandbox/snapshots",
  "/sandbox/snapshots/root",
]);

const TOOL_DEFINITIONS: Record<SandboxToolId, SandboxToolDefinition> = {
  "vfs.list": {
    id: "vfs.list",
    riskLevel: "observe",
    allowedRoots: ALLOWED_ROOTS,
    requiresPreSnapshot: false,
    description: "列出沙箱虚拟路径。",
  },
  "vfs.read": {
    id: "vfs.read",
    riskLevel: "observe",
    allowedRoots: ALLOWED_ROOTS,
    requiresPreSnapshot: false,
    description: "读取沙箱虚拟对象摘要。",
  },
  "vfs.stage_patch": {
    id: "vfs.stage_patch",
    riskLevel: "state",
    allowedRoots: ["world", "state", "memory", "worldline", "save", "ui"],
    requiresPreSnapshot: false,
    description: "暂存一段沙箱 patch。",
  },
  "vfs.apply_patch": {
    id: "vfs.apply_patch",
    riskLevel: "state",
    allowedRoots: ["world", "state", "memory", "worldline", "save", "ui"],
    requiresPreSnapshot: false,
    description: "应用一段沙箱 patch。",
  },
  "vfs.delete_node": {
    id: "vfs.delete_node",
    riskLevel: "destructive",
    allowedRoots: ["world", "state", "memory", "worldline", "save", "ui"],
    requiresPreSnapshot: true,
    description: "删除一个沙箱虚拟对象。",
  },
  "vfs.wipe_subtree": {
    id: "vfs.wipe_subtree",
    riskLevel: "root_content",
    allowedRoots: ["world", "state", "memory", "worldline", "save", "ui"],
    requiresPreSnapshot: true,
    description: "清空一个沙箱虚拟子树。",
  },
  "vfs.corrupt_node": {
    id: "vfs.corrupt_node",
    riskLevel: "destructive",
    allowedRoots: ["world", "state", "memory", "worldline"],
    requiresPreSnapshot: true,
    description: "将沙箱对象标记为腐化。",
  },
  "memory.erase": {
    id: "memory.erase",
    riskLevel: "destructive",
    allowedRoots: ["memory"],
    requiresPreSnapshot: true,
    description: "擦除 NPC 的沙箱记忆片段。",
  },
  "worldline.sever_branch": {
    id: "worldline.sever_branch",
    riskLevel: "destructive",
    allowedRoots: ["worldline"],
    requiresPreSnapshot: true,
    description: "将沙箱世界线分支标记为不可达。",
  },
  "ui.lock_actions": {
    id: "ui.lock_actions",
    riskLevel: "interface",
    allowedRoots: ["state", "ui"],
    requiresPreSnapshot: false,
    description: "锁定或清空当前推荐行动。",
  },
  "ui.inject_action": {
    id: "ui.inject_action",
    riskLevel: "interface",
    allowedRoots: ["state", "ui"],
    requiresPreSnapshot: false,
    description: "注入一个沙箱推荐行动。",
  },
  "save.mark_corrupted": {
    id: "save.mark_corrupted",
    riskLevel: "save",
    allowedRoots: ["save"],
    requiresPreSnapshot: false,
    description: "标记当前沙箱存档为异常或损坏。",
  },
  "sandbox.create_snapshot": {
    id: "sandbox.create_snapshot",
    riskLevel: "save",
    allowedRoots: ["sandbox"],
    requiresPreSnapshot: false,
    description: "创建沙箱快照。",
  },
  "sandbox.restore_snapshot": {
    id: "sandbox.restore_snapshot",
    riskLevel: "save",
    allowedRoots: ["sandbox"],
    requiresPreSnapshot: false,
    description: "恢复沙箱快照。",
  },
  "sandbox.rollback_last_tool": {
    id: "sandbox.rollback_last_tool",
    riskLevel: "save",
    allowedRoots: ["sandbox"],
    requiresPreSnapshot: false,
    description: "回滚最近一次沙箱工具。",
  },
};

export function parseSandboxVfsPath(path: string): SandboxVfsPathResult {
  const normalizedPath = normalizeSandboxPath(path);
  if (!normalizedPath || normalizedPath === "/") {
    return { ok: false, reason: "empty_path", normalizedPath: normalizedPath || "/" };
  }
  if (normalizedPath.includes("/../") || normalizedPath.endsWith("/..")) {
    return { ok: false, reason: "path_traversal_forbidden", normalizedPath };
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const root = segments[0];
  if (FORBIDDEN_ROOTS.has(root)) {
    return { ok: false, reason: "host_boundary_forbidden", normalizedPath };
  }
  if (!isSandboxRoot(root)) {
    return { ok: false, reason: "unknown_root", normalizedPath };
  }

  return {
    ok: true,
    root,
    segments: segments.slice(1),
    normalizedPath,
  };
}

export function isProtectedSandboxVfsPath(path: string): boolean {
  const normalizedPath = normalizeSandboxPath(path);
  if (PROTECTED_PATHS.has(normalizedPath)) return true;
  return normalizedPath.startsWith("/sandbox/snapshots/");
}

export function getSandboxToolDefinition(id: string): SandboxToolDefinition | null {
  if (!isSandboxToolId(id)) return null;
  return TOOL_DEFINITIONS[id];
}

export function requiresPreSnapshot(toolId: string): boolean {
  return getSandboxToolDefinition(toolId)?.requiresPreSnapshot ?? false;
}

function normalizeSandboxPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function isSandboxRoot(value: string): value is SandboxVfsRoot {
  return (ALLOWED_ROOTS as string[]).includes(value);
}

function isSandboxToolId(value: string): value is SandboxToolId {
  return Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, value);
}
