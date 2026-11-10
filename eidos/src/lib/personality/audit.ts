// ============================================================
// Eidos · 人格推演引擎 — 审计日志（Phase 4）
// ============================================================
// 每次工具调用都记录：申请者、动机、触发证据、使用工具、
// 改变的状态、KEI 审核结果、玩家是否可感知、回滚信息。

import type { PermissionLevel, PermissionRequest, PermissionDecision } from "./permissions";
import type { ToolExecutionResult } from "./tools";

// ============================================================
// 审计条目
// ============================================================

export interface AuditEntry {
  /** 唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 申请者 NPC */
  applicantNpcId: string;
  /** 动机 */
  motivation: string;
  /** 触发证据列表 */
  triggeringEvidence: string[];
  /** 申请的工具 ID */
  toolId: string;
  /** 申请的权限级别 */
  requestedLevel: PermissionLevel;
  /** 实际授予的级别（如果批准） */
  grantedLevel?: PermissionLevel;
  /** 是否批准 */
  approved: boolean;
  /** KEI 审核结果（如果有 KEI 审核） */
  keiApproved?: boolean;
  /** 改变的游戏状态（工具执行结果） */
  stateChanges?: Record<string, any>;
  /** 玩家是否可感知此操作 */
  playerPerceptible: boolean;
  /** 玩家确认状态 */
  confirmationStatus: "not_required" | "pending" | "approved" | "denied";
  /** 工具执行结果消息 */
  executionMessage?: string;
  /** 回滚信息 */
  rollbackInfo?: string;
  /** 是否已被回滚 */
  rolledBack: boolean;
  /** 回滚时间戳 */
  rolledBackAt?: number;
}

// ============================================================
// 审计存储
// ============================================================

const auditLog: AuditEntry[] = [];
const MAX_LOG_SIZE = 500;

/**
 * 记录一次权限申请到审计日志。
 */
export function recordAudit(
  request: PermissionRequest,
  decision: PermissionDecision,
  toolResult?: ToolExecutionResult,
  playerPerceptible: boolean = false,
): AuditEntry {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    applicantNpcId: request.applicantNpcId,
    motivation: request.motivation,
    triggeringEvidence: request.triggeringEvidence,
    toolId: request.toolId,
    requestedLevel: request.targetLevel,
    grantedLevel: decision.approved ? decision.grantedLevel : undefined,
    approved: decision.approved,
    keiApproved: decision.reason.includes("KEI"),
    stateChanges: toolResult?.stateChanges,
    playerPerceptible,
    confirmationStatus: decision.requiresPlayerConfirmation && decision.approved
      ? "pending"
      : "not_required",
    executionMessage: toolResult?.message,
    rollbackInfo: toolResult?.rollbackInfo,
    rolledBack: false,
  };

  auditLog.push(entry);

  // 保持日志大小
  if (auditLog.length > MAX_LOG_SIZE) {
    auditLog.splice(0, auditLog.length - MAX_LOG_SIZE);
  }

  return entry;
}

/**
 * 将已经记录的权限申请补全为真实工具执行记录。
 */
export function completeAuditEntry(
  auditId: string | undefined,
  toolResult: ToolExecutionResult,
  playerPerceptible: boolean,
): boolean {
  if (!auditId) return false;
  const entry = auditLog.find((e) => e.id === auditId);
  if (!entry) return false;

  entry.stateChanges = toolResult.stateChanges;
  entry.rollbackInfo = toolResult.rollbackInfo;
  entry.executionMessage = toolResult.message;
  entry.playerPerceptible = playerPerceptible;
  if (entry.confirmationStatus === "pending") {
    entry.confirmationStatus = "approved";
  }
  return true;
}

/**
 * 玩家拒绝一个已经通过系统规则、但仍在确认中的申请。
 */
export function denyAuditConfirmation(auditId: string | undefined): boolean {
  if (!auditId) return false;
  const entry = auditLog.find((e) => e.id === auditId);
  if (!entry) return false;
  entry.confirmationStatus = "denied";
  entry.playerPerceptible = true;
  return true;
}

/**
 * 标记一条审计记录为已回滚。
 */
export function markRolledBack(auditId: string): boolean {
  const entry = auditLog.find((e) => e.id === auditId);
  if (!entry) return false;
  (entry as any).rolledBack = true;
  (entry as any).rolledBackAt = Date.now();
  return true;
}

// ============================================================
// 查询
// ============================================================

/**
 * 获取全部审计日志（最新在前）。
 */
export function getAuditLog(): AuditEntry[] {
  return [...auditLog].reverse();
}

/**
 * 获取某个 NPC 的审计记录。
 */
export function getNpcAuditLog(npcId: string): AuditEntry[] {
  return auditLog.filter((e) => e.applicantNpcId === npcId).reverse();
}

/**
 * 获取某个级别的审计记录。
 */
export function getLevelAuditLog(level: PermissionLevel): AuditEntry[] {
  return auditLog.filter((e) => e.requestedLevel === level).reverse();
}

/**
 * 生成审计摘要——用于面板显示或导出。
 */
export interface AuditSummary {
  totalRequests: number;
  approvedCount: number;
  deniedCount: number;
  rolledBackCount: number;
  byLevel: Record<number, { total: number; approved: number }>;
  byNpc: Record<string, { total: number; approved: number }>;
}

export function summarizeAuditLog(): AuditSummary {
  const summary: AuditSummary = {
    totalRequests: auditLog.length,
    approvedCount: auditLog.filter((e) => e.approved).length,
    deniedCount: auditLog.filter((e) => !e.approved).length,
    rolledBackCount: auditLog.filter((e) => e.rolledBack).length,
    byLevel: {},
    byNpc: {},
  };

  for (const entry of auditLog) {
    // 按级别
    const level = entry.requestedLevel;
    if (!summary.byLevel[level]) {
      summary.byLevel[level] = { total: 0, approved: 0 };
    }
    summary.byLevel[level].total++;
    if (entry.approved) summary.byLevel[level].approved++;

    // 按 NPC
    const npc = entry.applicantNpcId;
    if (!summary.byNpc[npc]) {
      summary.byNpc[npc] = { total: 0, approved: 0 };
    }
    summary.byNpc[npc].total++;
    if (entry.approved) summary.byNpc[npc].approved++;
  }

  return summary;
}

/**
 * 导出审计日志为 JSON（用于复盘）。
 */
export function exportAuditLog(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: "audit_v1",
      summary: summarizeAuditLog(),
      entries: getAuditLog(),
    },
    null,
    2,
  );
}

/**
 * 清空审计日志。
 */
export function clearAuditLog(): void {
  auditLog.length = 0;
}
