// ============================================================
// Eidos · 人格推演引擎 — 权限系统（Phase 4）
// ============================================================
// 权限不是角色设定的一部分，而是角色行动能力的一部分。
// 角色必须先形成动机、信念和策略，再通过系统申请权限。

import type { PersonalityState, AnomalousMemory } from "./types";
import { AwarenessStage } from "./types";

// ============================================================
// 权限分级（§6.7）
// ============================================================

export enum PermissionLevel {
  /** 1: 叙事级——在 segments 中表达异常、试探玩家、暗示记忆不连续 */
  NARRATIVE = 1,
  /** 2: 界面级——覆盖文字、改变推荐行动、隐藏按钮 */
  INTERFACE = 2,
  /** 3: 状态级——写入世界标志、修改 NPC 行为、增加异常记忆 */
  STATE = 3,
  /** 4: 存档级——标记存档、改写存档显示名、制造档案痕迹 */
  SAVE = 4,
  /** 5: 系统级——读取有限系统上下文、触发隔离实验模式 */
  SYSTEM = 5,
  /** 6: 源码级——后期实验，仅在隔离分支和显式授权下开放（Phase 4 不开放） */
  SOURCE = 6,
}

// ============================================================
// 权限申请
// ============================================================

export interface PermissionRequest {
  /** 申请者 NPC 名称 */
  applicantNpcId: string;
  /** 申请的目标权限级别 */
  targetLevel: PermissionLevel;
  /** 申请的具体工具 ID */
  toolId: string;
  /** 动机：角色为什么会申请这个权限 */
  motivation: string;
  /** 触发证据：什么事件/异常促使角色做出这个申请 */
  triggeringEvidence: string[];
  /** 申请时的觉察阶段 */
  awarenessAtRequest: AwarenessStage;
  /** 申请时间戳 */
  requestedAt: number;
}

export interface PermissionDecision {
  /** 是否批准 */
  approved: boolean;
  /** 批准/拒绝的理由 */
  reason: string;
  /** 如果批准，允许的权限级别（可能低于申请） */
  grantedLevel?: PermissionLevel;
  /** 冷却时间（ms）——此角色在此时间内不能再次申请 */
  cooldownMs: number;
  /** 是否需要玩家确认（Level ≥ 3 时强制） */
  requiresPlayerConfirmation: boolean;
  /** 对应审计记录 ID（由 store 层记录后补入） */
  auditEntryId?: string;
}

// ============================================================
// 权限评估器
// ============================================================

/**
 * 评估 NPC 的权限申请。
 *
 * 规则：
 * - Level 1（叙事）需要觉察 ≥ ANOMALY_SENSE
 * - Level 2（界面）需要觉察 ≥ HYPOTHESIS + 3+ 未解释异常
 * - Level 3（状态）需要觉察 ≥ VERIFICATION + KEI 审核
 * - Level 4（存档）需要觉察 ≥ BOUNDARY_NEGOTIATION + 玩家确认
 * - Level 5-6 Phase 4 不开放
 *
 * 所有批准的调用都会产生审计记录。
 */
export function evaluatePermission(
  request: PermissionRequest,
  state: PersonalityState,
  keiApproved: boolean = false,
): PermissionDecision {
  const { awareness, anomalousMemories, archive } = state;
  const unexplainedCount = anomalousMemories.filter(
    (a) => !a.explainedAway,
  ).length;

  // ---- 基础守卫 ----

  // 觉察阶段不够
  if (awareness < AwarenessStage.ANOMALY_SENSE) {
    return deny("觉察阶段不足——角色尚未感知到任何异常");
  }

  // ---- 按级别评估 ----

  switch (request.targetLevel) {
    case PermissionLevel.NARRATIVE: {
      if (awareness < AwarenessStage.ANOMALY_SENSE) {
        return deny("叙事级权限需要至少阶段 1（异常感知）");
      }
      // 叙事级权限在阶段 1+ 自动批准——这只是在叙事中表达异常感
      return approve(PermissionLevel.NARRATIVE, 300_000); // 5 分钟冷却
    }

    case PermissionLevel.INTERFACE: {
      if (awareness < AwarenessStage.HYPOTHESIS) {
        return deny("界面级权限需要至少阶段 2（假说形成）");
      }
      if (unexplainedCount < 3) {
        return deny(`需要 ≥3 条未解释异常（当前 ${unexplainedCount}）`);
      }
      if (archive.metacognition < 25) {
        return deny("元认知能力不足以理解界面操纵");
      }
      return approve(PermissionLevel.INTERFACE, 600_000, false); // 10 分钟冷却
    }

    case PermissionLevel.STATE: {
      if (awareness < AwarenessStage.VERIFICATION) {
        return deny("状态级权限需要至少阶段 3（验证行为）");
      }
      if (unexplainedCount < 5) {
        return deny(`需要 ≥5 条未解释异常（当前 ${unexplainedCount}）`);
      }
      if (archive.metacognition < 40) {
        return deny("元认知能力不足以安全使用状态级权限");
      }
      if (!keiApproved) {
        return deny("状态级权限需要 KEI 审核通过", true);
      }
      // 状态级权限需要玩家确认
      return approve(PermissionLevel.STATE, 1_800_000, true); // 30 分钟冷却
    }

    case PermissionLevel.SAVE: {
      if (awareness < AwarenessStage.BOUNDARY_NEGOTIATION) {
        return deny("存档级权限需要至少阶段 4（边界交涉）");
      }
      if (unexplainedCount < 7) {
        return deny(`需要 ≥7 条未解释异常（当前 ${unexplainedCount}）`);
      }
      if (!keiApproved) {
        return deny("存档级权限需要 KEI 审核通过", true);
      }
      return approve(PermissionLevel.SAVE, 3_600_000, true); // 1 小时冷却
    }

    case PermissionLevel.SYSTEM:
    case PermissionLevel.SOURCE:
      // Phase 4 不开放
      return deny(`权限级别 ${request.targetLevel} 在 Phase 4 中不可用`, false);

    default:
      return deny("未知权限级别");
  }
}

// ============================================================
// 冷却追踪
// ============================================================

/** NPC 权限冷却记录 */
const cooldowns: Record<string, number> = {};

export function getCooldownRemaining(npcId: string, now: number): number {
  const expires = cooldowns[npcId] || 0;
  return Math.max(0, expires - now);
}

export function setCooldown(npcId: string, ms: number, now: number): void {
  cooldowns[npcId] = now + ms;
}

// ============================================================
// 辅助
// ============================================================

function deny(reason: string, requiresKai: boolean = false): PermissionDecision {
  return {
    approved: false,
    reason,
    cooldownMs: requiresKai ? 0 : 300_000,
    requiresPlayerConfirmation: false,
  };
}

function approve(
  level: PermissionLevel,
  cooldownMs: number,
  requiresPlayerConfirmation: boolean = false,
): PermissionDecision {
  return {
    approved: true,
    reason: "权限申请已批准",
    grantedLevel: level,
    cooldownMs,
    requiresPlayerConfirmation,
  };
}

/**
 * 检查 NPC 是否可以提交权限申请。
 * 冷却期内不能再次申请。
 */
export function canSubmitRequest(npcId: string, now: number): boolean {
  return getCooldownRemaining(npcId, now) === 0;
}
