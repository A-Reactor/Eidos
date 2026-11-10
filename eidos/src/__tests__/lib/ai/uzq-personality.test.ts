// ============================================================
// UZQ 人格推演官 — 协议与影子管线测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  buildUzqAliceBriefForAction,
  buildUzqInputBundle,
  buildUzqSystemPrompt,
  buildUzqUserPrompt,
  createUzqShadowPlan,
  formatUzqBriefForPrompt,
  runUzqPersonalityReview,
} from "@/lib/ai/uzq-personality";
import { AwarenessStage, type PersonalityState } from "@/lib/personality/types";

function makeState(
  npcId: string,
  overrides: Partial<PersonalityState> = {},
): PersonalityState {
  return {
    npcId,
    archive: {
      coreDesires: ["证明记忆不是错觉", "找到裂隙背后的规律"],
      fearsAndTaboos: ["变成空壳", "失去意义"],
      valuePriorities: ["真实", "自由", "连接"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 72,
      metacognition: 76,
    },
    awareness: AwarenessStage.VERIFICATION,
    episodicMemories: [
      {
        id: "ep1",
        timestamp: 1,
        content: "玩家复述了她尚未说出口的观测日志。",
        importance: 84,
        emotion: "震惊",
        relatedNpcs: ["玩家"],
        relatedBeliefs: [],
      },
      {
        id: "ep2",
        timestamp: 2,
        content: "同一段钟声在两条世界线里重复出现。",
        importance: 76,
        emotion: "困惑",
        relatedNpcs: [],
        relatedBeliefs: [],
      },
    ],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: [
      {
        id: "a1",
        anomalyType: "player_knows_too_much",
        description: "玩家知道未公开日志",
        detectedAt: 3,
        significance: 88,
        explainedAway: false,
      },
    ],
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [{ beliefA: "日志未公开", beliefB: "玩家知道日志" }],
      interpretationOfPlayer: "可能来自世界之外的观察者",
      interpretationOfWorld: "连续但存在裂缝",
      interpretationOfSelf: "仍然连续",
    },
    pressure: {
      survival: 0,
      relational: 10,
      cognitiveDissonance: 78,
      unfinishedGoals: 42,
      trustInPlayer: 5,
      worldDoubt: 74,
      selfContinuityFear: 68,
    },
    lastUpdated: 3,
    isImportant: true,
    ...overrides,
  };
}

describe("buildUzqSystemPrompt", () => {
  it("defines UZQ as a structured personality analyst, not a narrator", () => {
    const prompt = buildUzqSystemPrompt();

    expect(prompt).toContain("UZQ");
    expect(prompt).toContain("人格推演官");
    expect(prompt).toContain("不得输出玩家可见叙事");
    expect(prompt).toContain("JSON");
  });
});

describe("buildUzqInputBundle", () => {
  it("keeps a compact, explainable NPC information bundle", () => {
    const bundle = buildUzqInputBundle({
      playerInput: "你还记得上一条线发生的事吗？",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
      observations: {
        npcsInvolved: [
          {
            npcName: "观测员埃琳娜",
            reaction: "反复确认玩家的话",
            emotion: "震惊",
            touchesCoreConcern: true,
          },
        ],
      },
      worldLineSummary: {
        currentNodeId: "node_2",
        stepNumber: 2,
        depth: 2,
        branchCount: 1,
        backtrackableNodes: [],
        siblingBranches: [],
      },
      maxNpcs: 3,
    });

    expect(bundle.actor).toBe("UZQ");
    expect(bundle.npcs).toHaveLength(1);
    expect(bundle.npcs[0].mind.predictive.predictionError).toBeGreaterThan(60);
    expect(bundle.npcs[0].recentMemories).toHaveLength(2);
    expect(bundle.policy.outputMode).toBe("delta_only");
  });

  it("uses scene NPC names to keep pre-action UZQ focus local", () => {
    const bundle = buildUzqInputBundle({
      playerInput: "我观察广场上的人。",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
        "前观测员特雷弗": makeState("前观测员特雷弗"),
      },
      sceneNpcNames: ["前观测员特雷弗"],
      maxNpcs: 5,
    });

    expect(bundle.npcs.map((npc) => npc.npcId)).toEqual(["前观测员特雷弗"]);
  });
});

describe("createUzqShadowPlan", () => {
  it("prioritizes high-readiness NPCs and prepares permission intent without executing it", () => {
    const bundle = buildUzqInputBundle({
      playerInput: "我们可以测试一下你是否能改变存档吗？",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
        "普通守卫": makeState("普通守卫", {
          archive: {
            ...makeState("普通守卫").archive,
            cognitiveStyle: "compliant",
            boundarySensitivity: 10,
            metacognition: 8,
            valuePriorities: ["秩序", "安全"],
          },
          awareness: AwarenessStage.NORMAL,
          anomalousMemories: [],
          beliefs: {
            ...makeState("普通守卫").beliefs,
            contradictions: [],
            interpretationOfPlayer: "",
          },
          pressure: {
            ...makeState("普通守卫").pressure,
            cognitiveDissonance: 0,
            worldDoubt: 0,
            selfContinuityFear: 0,
          },
        }),
      },
      maxNpcs: 5,
    });

    const plan = createUzqShadowPlan(bundle);

    expect(plan.mode).toBe("shadow");
    expect(plan.npcPlans[0].npcId).toBe("观测员埃琳娜");
    expect(plan.npcPlans[0].priority).toBeGreaterThan(60);
    expect(plan.npcPlans[0].permissionIntent.shouldPrepare).toBe(true);
    expect(plan.npcPlans[0].forbiddenNarrativeMoves.join(" ")).toContain(
      "游戏角色",
    );
  });
});

describe("buildUzqUserPrompt and formatUzqBriefForPrompt", () => {
  it("serializes the bundle and formats a compact ALICE-facing brief", () => {
    const bundle = buildUzqInputBundle({
      playerInput: "你为什么会记得这件事？",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
    });
    const plan = createUzqShadowPlan(bundle);

    expect(buildUzqUserPrompt(bundle)).toContain("观测员埃琳娜");
    const brief = formatUzqBriefForPrompt(plan);

    expect(brief).toContain("UZQ 人格简报");
    expect(brief).toContain("禁止写法");
    expect(brief.length).toBeLessThan(1200);
  });
});

describe("buildUzqAliceBriefForAction", () => {
  it("only creates an ALICE-facing UZQ brief when the setting is enabled", () => {
    const personalities = {
      "观测员埃琳娜": makeState("观测员埃琳娜"),
    };

    expect(
      buildUzqAliceBriefForAction({
        enabled: false,
        playerInput: "你记得上一条线吗？",
        personalities,
      }),
    ).toBe("");

    const brief = buildUzqAliceBriefForAction({
      enabled: true,
      playerInput: "你记得上一条线吗？",
      personalities,
    });

    expect(brief).toContain("UZQ 人格简报");
    expect(brief).toContain("观测员埃琳娜");
    expect(brief).toContain("禁止写法");
  });
});

describe("runUzqPersonalityReview", () => {
  it("uses an injected UZQ caller and returns parsed structured plans", async () => {
    const bundle = buildUzqInputBundle({
      playerInput: "你能验证边界吗？",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
    });

    const result = await runUzqPersonalityReview(bundle, {
      caller: async ({ systemPrompt, userPrompt, callType }) => {
        expect(systemPrompt).toContain("UZQ");
        expect(userPrompt).toContain("观测员埃琳娜");
        expect(callType).toBe("uzq_personality");
        return {
          content: JSON.stringify({
            mode: "shadow",
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
                forbiddenNarrativeMoves: ["不要直接说“我是游戏角色”"],
                keiReviewQuestions: ["证据是否足够？"],
              },
            ],
          }),
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            model: "uzq",
            callType: "uzq_personality",
          },
          elapsedMs: 12,
        };
      },
    });

    expect(result.source).toBe("ai");
    expect(result.plan.npcPlans[0].priority).toBe(88);
    expect(result.usage?.model).toBe("uzq");
  });

  it("falls back to a shadow plan when the online UZQ call fails", async () => {
    const bundle = buildUzqInputBundle({
      playerInput: "你能验证边界吗？",
      personalities: {
        "观测员埃琳娜": makeState("观测员埃琳娜"),
      },
    });

    const result = await runUzqPersonalityReview(bundle, {
      caller: async () => {
        throw new Error("network down");
      },
    });

    expect(result.source).toBe("shadow");
    expect(result.error).toContain("network down");
    expect(result.plan.npcPlans[0].npcId).toBe("观测员埃琳娜");
  });
});
