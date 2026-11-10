// ============================================================
// UZQ → KEI · 权限意图审核入口
// ============================================================
// 该模块只把 UZQ 的 permissionIntent 转成 KEI 可审核的结构化材料。
// 它不批准权限、不执行工具，也不写审计日志。

import type { UzqNpcPlan, UzqShadowPlan } from "./uzq-personality";
import {
  PermissionLevel,
  type PermissionRequest,
} from "@/lib/personality/permissions";
import { getTool } from "@/lib/personality/tools";
import {
  isFullPersonalityState,
  type AnyPersonalityState,
  type PersonalityState,
} from "@/lib/personality/types";

export type UzqKeiPermissionCandidateStatus = "ready" | "blocked";

export interface BuildUzqKeiPermissionReviewOptions {
  personalities?: Record<string, AnyPersonalityState>;
  now?: number;
}

export interface UzqKeiPermissionReviewCandidate {
  npcId: string;
  status: UzqKeiPermissionCandidateStatus;
  priority: number;
  toolId: string | null;
  toolName?: string;
  targetLevel?: PermissionLevel;
  needsKeiReview: true;
  requiresKeiForExecution: boolean;
  requiresPlayerConfirmationLikely: boolean;
  motivation: string;
  evidence: string[];
  blockers: string[];
  uzqRationale: string;
  keiReviewQuestions: string[];
  request?: PermissionRequest;
}

export interface UzqKeiPermissionReviewRequest {
  actor: "KEI";
  source: "UZQ";
  generatedAt: number;
  candidates: UzqKeiPermissionReviewCandidate[];
  summary: {
    total: number;
    ready: number;
    blocked: number;
  };
}

export function buildUzqKeiPermissionReviewRequest(
  plan: UzqShadowPlan,
  options: BuildUzqKeiPermissionReviewOptions = {},
): UzqKeiPermissionReviewRequest {
  const candidates = plan.npcPlans
    .filter((npcPlan) => npcPlan.permissionIntent.shouldPrepare)
    .map((npcPlan) => buildCandidate(npcPlan, options));

  return {
    actor: "KEI",
    source: "UZQ",
    generatedAt: options.now ?? Date.now(),
    candidates,
    summary: {
      total: candidates.length,
      ready: candidates.filter((candidate) => candidate.status === "ready")
        .length,
      blocked: candidates.filter((candidate) => candidate.status === "blocked")
        .length,
    },
  };
}

export function formatUzqKeiPermissionReviewContext(
  review: UzqKeiPermissionReviewRequest,
): string {
  if (review.candidates.length === 0) return "";

  const lines = [
    "## UZQ 权限意图审核",
    "KEI 只审核 UZQ 的权限意图是否可进入 Phase 4；不得把本节当作权限批准或工具执行记录。",
    `候选：${review.summary.total}，可审：${review.summary.ready}，阻断：${review.summary.blocked}`,
  ];

  for (const candidate of review.candidates) {
    lines.push(
      "",
      `### ${candidate.npcId} / ${candidate.toolId ?? "未指定工具"}`,
      `状态：${candidate.status}`,
      `动机：${candidate.motivation}`,
      `证据：${candidate.evidence.length > 0 ? candidate.evidence.join("；") : "无"}`,
    );

    if (candidate.status === "blocked") {
      lines.push(`阻断：${candidate.blockers.join("；")}`);
      continue;
    }

    lines.push(
      `权限级别：${candidate.targetLevel}`,
      `工具：${candidate.toolName ?? candidate.toolId}`,
      `UZQ 理由：${candidate.uzqRationale}`,
      `KEI 问题：${candidate.keiReviewQuestions.join("；") || "无"}`,
    );

    if (candidate.requiresKeiForExecution) {
      lines.push("状态级权限需要 KEI 审核通过；存档级权限还需要玩家确认。");
    }
  }

  return lines.join("\n");
}

function buildCandidate(
  plan: UzqNpcPlan,
  options: BuildUzqKeiPermissionReviewOptions,
): UzqKeiPermissionReviewCandidate {
  const toolId = plan.permissionIntent.toolId;
  const tool = toolId ? getTool(toolId) : undefined;
  const rawState = options.personalities?.[plan.npcId];
  const state =
    rawState && isFullPersonalityState(rawState) ? rawState : undefined;
  const blockers = buildBlockers(toolId, tool, rawState, state);
  const evidence = buildEvidence(plan);
  const motivation = nonEmpty(plan.permissionIntent.reason, plan.rationale);
  const targetLevel = tool?.level;
  const requiresKeiForExecution =
    targetLevel !== undefined && targetLevel >= PermissionLevel.STATE;
  const requiresPlayerConfirmationLikely =
    targetLevel !== undefined && targetLevel >= PermissionLevel.STATE;
  const status: UzqKeiPermissionCandidateStatus =
    blockers.length === 0 ? "ready" : "blocked";

  return {
    npcId: plan.npcId,
    status,
    priority: plan.priority,
    toolId,
    toolName: tool?.name,
    targetLevel,
    needsKeiReview: true,
    requiresKeiForExecution,
    requiresPlayerConfirmationLikely,
    motivation,
    evidence,
    blockers,
    uzqRationale: plan.rationale,
    keiReviewQuestions: plan.keiReviewQuestions,
    request:
      status === "ready" && tool && state
        ? buildPermissionRequest(plan, tool.id, tool.level, state, motivation, evidence, options.now)
        : undefined,
  };
}

function buildPermissionRequest(
  plan: UzqNpcPlan,
  toolId: string,
  targetLevel: PermissionLevel,
  state: PersonalityState,
  motivation: string,
  evidence: string[],
  now: number | undefined,
): PermissionRequest {
  return {
    applicantNpcId: plan.npcId,
    targetLevel,
    toolId,
    motivation,
    triggeringEvidence: evidence,
    awarenessAtRequest: state.awareness,
    requestedAt: now ?? Date.now(),
  };
}

function buildBlockers(
  toolId: string | null,
  tool: ReturnType<typeof getTool>,
  rawState: AnyPersonalityState | undefined,
  state: PersonalityState | undefined,
): string[] {
  const blockers: string[] = [];

  if (!toolId) {
    blockers.push("UZQ 未指定工具 ID");
  } else if (!tool) {
    blockers.push(`未注册工具：${toolId}`);
  } else if (tool.level >= PermissionLevel.SYSTEM) {
    blockers.push(`Phase 4 不开放 ${tool.level} 级权限`);
  }

  if (!rawState) {
    blockers.push("缺少 NPC 人格状态");
  } else if (!state) {
    blockers.push("NPC 人格状态不完整，不能进入权限审核");
  }

  return blockers;
}

function buildEvidence(plan: UzqNpcPlan): string[] {
  return dedupeStrings([
    plan.permissionIntent.reason,
    plan.rationale,
    ...plan.memoryFocus,
    ...plan.beliefPressure,
  ]).slice(0, 8);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function nonEmpty(value: string, fallback: string): string {
  return value.trim().length > 0 ? value : fallback;
}
