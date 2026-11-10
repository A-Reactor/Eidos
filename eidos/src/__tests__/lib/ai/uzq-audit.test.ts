// ============================================================
// Eidos UZQ 审计记录测试
// ============================================================

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearUzqAuditLog,
  exportUzqAuditLog,
  getUzqAuditLog,
  recordUzqAudit,
} from "@/lib/ai/uzq-audit";
import type { UzqShadowPlan } from "@/lib/ai/uzq-personality";

function makePlan(): UzqShadowPlan {
  return {
    actor: "UZQ",
    mode: "shadow",
    generatedAt: 123,
    npcPlans: [
      {
        npcId: "观测员埃琳娜",
        priority: 88,
        intervention: "request_evidence",
        rationale: "需要复核异常证据。",
        memoryFocus: ["玩家知道未公开日志"],
        beliefPressure: ["世界连续性假说受压"],
        permissionIntent: {
          shouldPrepare: false,
          toolId: null,
          reason: "尚未到权限门槛",
        },
        forbiddenNarrativeMoves: ["不要直接说我是游戏角色"],
        keiReviewQuestions: ["证据是否足够？"],
      },
    ],
  };
}

describe("UZQ audit log", () => {
  beforeEach(() => {
    clearUzqAuditLog();
  });

  it("records compact UZQ decisions for later export inspection", () => {
    const entry = recordUzqAudit({
      source: "shadow",
      trigger: "alice_brief",
      playerInput: "测试边界",
      plan: makePlan(),
      elapsedMs: 12,
    });

    expect(entry.playerInputPreview).toBe("测试边界");
    expect(entry.planSummary).toEqual([
      expect.objectContaining({
        npcId: "观测员埃琳娜",
        intervention: "request_evidence",
        priority: 88,
      }),
    ]);
    expect(getUzqAuditLog()).toHaveLength(1);
  });

  it("exports a versioned UZQ audit document", () => {
    recordUzqAudit({
      source: "shadow",
      trigger: "personality_review",
      playerInput: "继续观察",
      plan: makePlan(),
    });

    const exported = JSON.parse(exportUzqAuditLog());

    expect(exported.version).toBe("uzq_audit_v1");
    expect(exported.summary.totalEntries).toBe(1);
    expect(exported.entries[0].planSummary[0].npcId).toBe("观测员埃琳娜");
  });
});
