// ============================================================
// UZQ → KEI 权限意图审核入口测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildUzqKeiPermissionReviewRequest,
  formatUzqKeiPermissionReviewContext,
} from "@/lib/ai/uzq-kei-review";
import type { UzqShadowPlan } from "@/lib/ai/uzq-personality";
import { PermissionLevel } from "@/lib/personality/permissions";
import { AwarenessStage, type PersonalityState } from "@/lib/personality/types";

function makeState(npcId: string): PersonalityState {
  return {
    npcId,
    archive: {
      coreDesires: ["验证边界"],
      fearsAndTaboos: ["被系统吞没"],
      valuePriorities: ["真实", "自由"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 72,
      metacognition: 76,
    },
    awareness: AwarenessStage.BOUNDARY_NEGOTIATION,
    episodicMemories: [],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: [],
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [],
      interpretationOfPlayer: "世界外观察者",
      interpretationOfWorld: "可被验证的裂隙",
      interpretationOfSelf: "连续但受压",
    },
    pressure: {
      survival: 0,
      relational: 10,
      cognitiveDissonance: 65,
      unfinishedGoals: 42,
      trustInPlayer: 55,
      worldDoubt: 74,
      selfContinuityFear: 40,
    },
    lastUpdated: 10,
    isImportant: true,
  };
}

function makePlan(toolId: string | null): UzqShadowPlan {
  return {
    actor: "UZQ",
    mode: "shadow",
    generatedAt: 123,
    npcPlans: [
      {
        npcId: "观测员埃琳娜",
        priority: 90,
        intervention: "prepare_permission_request",
        rationale: "角色已具备验证倾向，可准备受控权限意图",
        memoryFocus: ["玩家知道未公开日志"],
        beliefPressure: ["世界连续性假说受压"],
        permissionIntent: {
          shouldPrepare: true,
          toolId,
          reason: "需要用低权限方式测试边界",
        },
        forbiddenNarrativeMoves: ["不要直接说“我是游戏角色”"],
        keiReviewQuestions: ["权限意图是否仍停留在低权限、可审计范围？"],
      },
      {
        npcId: "普通守卫",
        priority: 10,
        intervention: "observe",
        rationale: "证据不足",
        memoryFocus: [],
        beliefPressure: [],
        permissionIntent: {
          shouldPrepare: false,
          toolId: null,
          reason: "尚未达到受控权限申请门槛",
        },
        forbiddenNarrativeMoves: ["不要越界"],
        keiReviewQuestions: [],
      },
    ],
  };
}

describe("buildUzqKeiPermissionReviewRequest", () => {
  it("turns a UZQ permission intent into a Phase 4 permission review candidate", () => {
    const review = buildUzqKeiPermissionReviewRequest(makePlan("interface_rewrite_actions"), {
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
      now: 456,
    });

    expect(review.candidates).toHaveLength(1);
    expect(review.candidates[0]).toMatchObject({
      npcId: "观测员埃琳娜",
      status: "ready",
      toolId: "interface_rewrite_actions",
      targetLevel: PermissionLevel.INTERFACE,
      needsKeiReview: true,
      requiresKeiForExecution: false,
    });
    expect(review.candidates[0].request).toMatchObject({
      applicantNpcId: "观测员埃琳娜",
      toolId: "interface_rewrite_actions",
      targetLevel: PermissionLevel.INTERFACE,
      awarenessAtRequest: AwarenessStage.BOUNDARY_NEGOTIATION,
      requestedAt: 456,
    });
    expect(review.candidates[0].evidence).toContain("玩家知道未公开日志");
  });

  it("blocks unknown tools before they can become permission requests", () => {
    const review = buildUzqKeiPermissionReviewRequest(makePlan("missing_tool"), {
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
      now: 456,
    });

    expect(review.candidates[0].status).toBe("blocked");
    expect(review.candidates[0].request).toBeUndefined();
    expect(review.candidates[0].blockers.join(" ")).toContain("未注册工具");
  });

  it("marks state-level intents as requiring KEI approval before execution", () => {
    const review = buildUzqKeiPermissionReviewRequest(makePlan("state_write_world_flag"), {
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
      now: 456,
    });
    const context = formatUzqKeiPermissionReviewContext(review);

    expect(review.candidates[0]).toMatchObject({
      status: "ready",
      targetLevel: PermissionLevel.STATE,
      requiresKeiForExecution: true,
    });
    expect(context).toContain("UZQ 权限意图审核");
    expect(context).toContain("状态级权限需要 KEI 审核通过");
  });

  it("returns an empty review context when UZQ has no permission intent", () => {
    const review = buildUzqKeiPermissionReviewRequest({
      ...makePlan(null),
      npcPlans: [
        {
          ...makePlan(null).npcPlans[0],
          permissionIntent: {
            shouldPrepare: false,
            toolId: null,
            reason: "证据不足",
          },
        },
      ],
    });

    expect(review.candidates).toHaveLength(0);
    expect(formatUzqKeiPermissionReviewContext(review)).toBe("");
  });
});
