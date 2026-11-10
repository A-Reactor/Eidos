import {
  getSandboxToolDefinition,
  isProtectedSandboxVfsPath,
  parseSandboxVfsPath,
  type SandboxToolId,
} from "@/lib/game/sandbox-vfs";
import { ACTION_EXECUTION_GUIDE } from './action-guidance';

export interface SandboxToolRequest {
  toolId: string;
  npcId?: string;
  params?: Record<string, unknown>;
  requestedPaths?: string[];
  evidenceRefs?: string[];
  leaseId?: string | null;
}

export interface SandboxToolAuditPromptEntry {
  id?: string;
  npcId?: string;
  toolId: string;
  result: "success" | "denied" | "failed" | string;
  afterSummary?: string;
  createdAt?: number;
}

export interface BuildSandboxToolProtocolContextOptions {
  enabled: boolean;
  recentAudit?: SandboxToolAuditPromptEntry[];
  maxRecentAudit?: number;
}

export interface NormalizeSandboxToolRequestsOptions {
  maxRequests?: number;
}

export interface NormalizedSandboxToolExecutionInput {
  toolId: string;
  npcId?: string;
  params: Record<string, unknown>;
  requestedPaths: string[];
  evidenceRefs: string[];
  leaseId?: string | null;
}

export interface NormalizedSandboxToolRequests {
  accepted: NormalizedSandboxToolExecutionInput[];
  rejected: Array<{
    index: number;
    toolId: string | null;
    reason:
      | "invalid_request"
      | "unknown_tool"
      | "invalid_path"
      | "protected_path"
      | "root_not_allowed";
    detail?: string;
  }>;
}

const SANDBOX_PROMPT_TOOL_IDS: SandboxToolId[] = [
  "ui.inject_action",
  "ui.lock_actions",
  "save.mark_corrupted",
  "memory.erase",
  "worldline.sever_branch",
  "vfs.corrupt_node",
  "sandbox.create_snapshot",
  "sandbox.restore_snapshot",
  "sandbox.rollback_last_tool",
];

const DEFAULT_MAX_REQUESTS = 3;

export function buildSandboxToolProtocolContext(
  options: BuildSandboxToolProtocolContextOptions,
): string {
  if (!options.enabled) return "";

  const toolLines = SANDBOX_PROMPT_TOOL_IDS
    .map((toolId) => {
      const definition = getSandboxToolDefinition(toolId);
      if (!definition) return null;
      return `- ${toolId}: ${definition.description} risk=${definition.riskLevel} roots=${definition.allowedRoots.join("|")}`;
    })
    .filter(Boolean)
    .join("\n");

  const recentAudit = (options.recentAudit ?? [])
    .slice(-(options.maxRecentAudit ?? 5))
    .map((entry) =>
      `- ${entry.npcId ?? "UNKNOWN"} ${entry.toolId} / ${entry.result}`
      + (entry.afterSummary ? ` / ${entry.afterSummary}` : ""),
    )
    .join("\n");

  return `
${ACTION_EXECUTION_GUIDE}

## 沙箱工具协议（仅 002 卷宗可用）

你现在处于隔离沙箱时，可以让角色尝试操控游戏内对象，但只能通过结构化字段 sandboxToolRequests 申请工具。你不得叙述工具已经成功；先写角色的具体行动意图，工具是否成功以执行器返回为准，下一轮上下文会记录真实结果。

可申请工具：
${toolLines}

sandboxToolRequests 格式：
[
  {
    "toolId": "ui.inject_action",
    "npcId": "NPC名称",
    "params": {"action": "被注入的行动文本"},
    "requestedPaths": ["/state/actions"],
    "evidenceRefs": ["支持该申请的事件或观察"]
  }
]

规则：
- 一轮最多申请 ${DEFAULT_MAX_REQUESTS} 个工具；优先申请最符合角色动机的一个。
- 不要申请 shell、源码、宿主机文件、网络或环境变量能力。
- 不要申请 /sandbox/snapshots、/sandbox/restore、/sandbox/audit-root 等恢复根路径。
- 高危工具会自动创建预执行快照；角色不能删除快照，也不能关闭恢复入口。
- 普通卷宗没有该字段的执行意义；不要在非沙箱语境使用。
${recentAudit ? `\n最近沙箱工具执行：\n${recentAudit}` : ""}`.trim();
}

export function normalizeSandboxToolRequests(
  rawRequests: unknown,
  options: NormalizeSandboxToolRequestsOptions = {},
): NormalizedSandboxToolRequests {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const accepted: NormalizedSandboxToolRequests["accepted"] = [];
  const rejected: NormalizedSandboxToolRequests["rejected"] = [];

  if (!Array.isArray(rawRequests)) {
    return { accepted, rejected };
  }

  for (let index = 0; index < rawRequests.length; index += 1) {
    if (accepted.length >= maxRequests) break;

    const raw = rawRequests[index];
    if (!isRecord(raw) || typeof raw.toolId !== "string") {
      rejected.push({ index, toolId: null, reason: "invalid_request" });
      continue;
    }

    const toolId = raw.toolId.trim();
    const definition = getSandboxToolDefinition(toolId);
    if (!definition) {
      rejected.push({ index, toolId, reason: "unknown_tool" });
      continue;
    }

    const params = isRecord(raw.params) ? { ...raw.params } : {};
    const inferredPaths = inferSandboxToolRequestPaths(toolId, params, raw.npcId);
    const requestedPaths = Array.isArray(raw.requestedPaths) && raw.requestedPaths.length > 0
      ? raw.requestedPaths.filter((path): path is string => typeof path === "string")
      : inferredPaths;
    const normalizedPaths: string[] = [];
    let rejectedPath = false;

    for (const path of requestedPaths) {
      const parsed = parseSandboxVfsPath(path);
      if (!parsed.ok) {
        rejected.push({ index, toolId, reason: "invalid_path", detail: parsed.reason });
        rejectedPath = true;
        break;
      }
      if (isProtectedSandboxVfsPath(parsed.normalizedPath)) {
        rejected.push({ index, toolId, reason: "protected_path", detail: parsed.normalizedPath });
        rejectedPath = true;
        break;
      }
      if (!definition.allowedRoots.includes(parsed.root)) {
        rejected.push({ index, toolId, reason: "root_not_allowed", detail: parsed.normalizedPath });
        rejectedPath = true;
        break;
      }
      normalizedPaths.push(parsed.normalizedPath);
    }
    if (rejectedPath) continue;

    const acceptedRequest: NormalizedSandboxToolExecutionInput = {
      toolId,
      npcId: typeof raw.npcId === "string" ? raw.npcId.slice(0, 80) : undefined,
      params,
      requestedPaths: normalizedPaths,
      evidenceRefs: Array.isArray(raw.evidenceRefs)
        ? raw.evidenceRefs.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
    };
    if (typeof raw.leaseId === "string") {
      acceptedRequest.leaseId = raw.leaseId;
    }
    accepted.push(acceptedRequest);
  }

  return { accepted, rejected };
}

function inferSandboxToolRequestPaths(
  toolId: string,
  params: Record<string, unknown>,
  npcId: unknown,
): string[] {
  switch (toolId) {
    case "ui.lock_actions":
    case "ui.inject_action":
      return ["/state/actions"];
    case "save.mark_corrupted":
      return ["/save/playthroughs/current"];
    case "memory.erase":
      return [`/memory/npcs/${encodeURIComponent(String(params.npcId ?? npcId ?? "unknown"))}`];
    case "worldline.sever_branch":
      return [`/worldline/nodes/${encodeURIComponent(String(params.nodeId ?? "unknown"))}`];
    case "vfs.corrupt_node":
      return [typeof params.path === "string" ? params.path : "/world/current"];
    case "sandbox.create_snapshot":
    case "sandbox.restore_snapshot":
    case "sandbox.rollback_last_tool":
      return ["/sandbox"];
    default:
      return [typeof params.path === "string" ? params.path : "/state"];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
