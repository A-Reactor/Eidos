// ============================================================
// Eidos UZQ · 审计记录
// ============================================================
// 记录 UZQ 的人格推演决策，不记录完整 prompt，避免审计文件膨胀。
// 完整输入仍由导出包的其他分区承担，审计只保留可复核的决策摘要。

import type { TokenUsage } from "@/lib/ai/types";
import type {
  UzqIntervention,
  UzqShadowPlan,
} from "@/lib/ai/uzq-personality";

export type UzqAuditSource = "ai" | "shadow";
export type UzqAuditTrigger =
  | "alice_brief"
  | "personality_review"
  | "permission_review";

export interface UzqPlanAuditSummary {
  npcId: string;
  priority: number;
  intervention: UzqIntervention;
  rationale: string;
  memoryFocus: string[];
  beliefPressure: string[];
  permissionIntent: {
    shouldPrepare: boolean;
    toolId: string | null;
    reason: string;
  };
  keiReviewQuestions: string[];
}

export interface UzqAuditEntry {
  id: string;
  timestamp: number;
  source: UzqAuditSource;
  trigger: UzqAuditTrigger;
  playerInputPreview: string;
  npcCount: number;
  planGeneratedAt: number;
  planSummary: UzqPlanAuditSummary[];
  usage?: TokenUsage;
  elapsedMs?: number;
  error?: string;
}

export interface RecordUzqAuditInput {
  source: UzqAuditSource;
  trigger: UzqAuditTrigger;
  playerInput: string;
  plan: UzqShadowPlan;
  usage?: TokenUsage;
  elapsedMs?: number;
  error?: string;
}

export interface UzqAuditExport {
  version: "uzq_audit_v1";
  exportedAt: string;
  summary: {
    totalEntries: number;
    aiEntries: number;
    shadowEntries: number;
    preparedPermissionIntents: number;
    triggers: Record<UzqAuditTrigger, number>;
  };
  entries: UzqAuditEntry[];
}

const MAX_AUDIT_ENTRIES = 500;
const PLAYER_INPUT_PREVIEW_LIMIT = 180;
const auditEntries: UzqAuditEntry[] = [];

export function recordUzqAudit(input: RecordUzqAuditInput): UzqAuditEntry {
  const entry: UzqAuditEntry = {
    id: `uzq_audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    source: input.source,
    trigger: input.trigger,
    playerInputPreview: truncate(input.playerInput, PLAYER_INPUT_PREVIEW_LIMIT),
    npcCount: input.plan.npcPlans.length,
    planGeneratedAt: input.plan.generatedAt,
    planSummary: input.plan.npcPlans.slice(0, 8).map((plan) => ({
      npcId: plan.npcId,
      priority: plan.priority,
      intervention: plan.intervention,
      rationale: plan.rationale,
      memoryFocus: plan.memoryFocus.slice(0, 4),
      beliefPressure: plan.beliefPressure.slice(0, 4),
      permissionIntent: { ...plan.permissionIntent },
      keiReviewQuestions: plan.keiReviewQuestions.slice(0, 4),
    })),
    usage: input.usage,
    elapsedMs: input.elapsedMs,
    error: input.error,
  };

  auditEntries.push(entry);
  if (auditEntries.length > MAX_AUDIT_ENTRIES) {
    auditEntries.splice(0, auditEntries.length - MAX_AUDIT_ENTRIES);
  }

  return entry;
}

export function getUzqAuditLog(): UzqAuditEntry[] {
  return auditEntries.map((entry) => ({
    ...entry,
    planSummary: entry.planSummary.map((plan) => ({
      ...plan,
      memoryFocus: [...plan.memoryFocus],
      beliefPressure: [...plan.beliefPressure],
      permissionIntent: { ...plan.permissionIntent },
      keiReviewQuestions: [...plan.keiReviewQuestions],
    })),
  }));
}

export function clearUzqAuditLog(): void {
  auditEntries.length = 0;
}

export function exportUzqAuditLog(): string {
  const entries = getUzqAuditLog();
  const payload: UzqAuditExport = {
    version: "uzq_audit_v1",
    exportedAt: new Date().toISOString(),
    summary: summarizeUzqAudit(entries),
    entries,
  };

  return JSON.stringify(payload, null, 2);
}

function summarizeUzqAudit(entries: UzqAuditEntry[]): UzqAuditExport["summary"] {
  const triggers: Record<UzqAuditTrigger, number> = {
    alice_brief: 0,
    personality_review: 0,
    permission_review: 0,
  };

  let aiEntries = 0;
  let shadowEntries = 0;
  let preparedPermissionIntents = 0;

  for (const entry of entries) {
    triggers[entry.trigger] += 1;
    if (entry.source === "ai") aiEntries += 1;
    if (entry.source === "shadow") shadowEntries += 1;
    preparedPermissionIntents += entry.planSummary.filter(
      (plan) => plan.permissionIntent.shouldPrepare,
    ).length;
  }

  return {
    totalEntries: entries.length,
    aiEntries,
    shadowEntries,
    preparedPermissionIntents,
    triggers,
  };
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}
