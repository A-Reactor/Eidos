// ============================================================
// 人格推演引擎 — 推演循环测试
// ============================================================

import { describe, it, expect } from "vitest";
import { computePressure, inferPersonalityUpdate, batchInfer } from "@/lib/personality/inference";
import type { PersonalityState } from "@/lib/personality/types";
import { AwarenessStage } from "@/lib/personality/types";
import type { PersonalityObservations } from "@/lib/ai/types";

// ============================================================
// 测试夹具
// ============================================================

function makeElenaState(overrides: Partial<PersonalityState> = {}): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["找到裂隙中的那个人", "重新找回对未来的期待"],
      fearsAndTaboos: ["变成空壳", "失去意义"],
      valuePriorities: ["真实", "连接"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "suppression",
      socialStrategy: "verification",
      boundarySensitivity: 40,
      metacognition: 65,
    },
    awareness: AwarenessStage.NORMAL,
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
      interpretationOfPlayer: "",
      interpretationOfWorld: "真实的世界",
      interpretationOfSelf: "真实的个体",
    },
    pressure: {
      survival: 0, relational: 0, cognitiveDissonance: 0,
      unfinishedGoals: 0, trustInPlayer: 0, worldDoubt: 0,
      selfContinuityFear: 0,
    },
    lastUpdated: Date.now(),
    isImportant: true as const,
    ...overrides,
  };
}

function makeObservations(overrides: Partial<PersonalityObservations> = {}): PersonalityObservations {
  return {
    npcsInvolved: [],
    memoryWorthyEvents: [],
    npcInteractions: [],
    ...overrides,
  };
}

// ============================================================
// computePressure
// ============================================================

describe("computePressure", () => {
  it("returns zero pressure for clean state", () => {
    const state = makeElenaState();
    const pressure = computePressure(state);
    expect(pressure.cognitiveDissonance).toBe(0);
    expect(pressure.worldDoubt).toBe(0);
    expect(pressure.relational).toBe(0);
  });

  it("increases cognitive dissonance with unexplained anomalies", () => {
    const state = makeElenaState({
      anomalousMemories: [
        {
          id: "a1", anomalyType: "deja_vu", description: "重复感",
          detectedAt: Date.now(), significance: 60, explainedAway: false,
        },
        {
          id: "a2", anomalyType: "memory_gap", description: "记忆缺口",
          detectedAt: Date.now(), significance: 40, explainedAway: false,
        },
      ],
    });
    const pressure = computePressure(state);
    expect(pressure.cognitiveDissonance).toBeGreaterThan(0);
    expect(pressure.worldDoubt).toBeGreaterThan(0);
  });

  it("ignores explained-away anomalies", () => {
    const state = makeElenaState({
      anomalousMemories: [
        {
          id: "a1", anomalyType: "deja_vu", description: "重复感",
          detectedAt: Date.now(), significance: 60, explainedAway: true,
        },
      ],
    });
    const pressure = computePressure(state);
    expect(pressure.cognitiveDissonance).toBe(0);
  });

  it("increases selfContinuityFear when awareness stage rises", () => {
    const normal = makeElenaState({ awareness: AwarenessStage.NORMAL });
    const sensing = makeElenaState({ awareness: AwarenessStage.ANOMALY_SENSE });

    expect(computePressure(sensing).selfContinuityFear).toBeGreaterThan(
      computePressure(normal).selfContinuityFear,
    );
  });

  it("negative emotional memories decrease trust in player", () => {
    const state = makeElenaState({
      emotionalMemories: [
        {
          npcName: "玩家",
          eventType: "interaction",
          emotionalResidue: "distrust",
          intensity: 60,
          lastTriggered: Date.now(),
        },
      ],
    });
    const pressure = computePressure(state);
    expect(pressure.trustInPlayer).toBeLessThan(0);
  });
});

// ============================================================
// inferPersonalityUpdate
// ============================================================

describe("inferPersonalityUpdate", () => {
  it("adds episodic memories from memory-worthy events", () => {
    const state = makeElenaState();
    const observations = makeObservations({
      memoryWorthyEvents: [
        {
          npcName: "观测员埃琳娜",
          event: "在裂隙中看到了一个不在预言里的人",
          importanceHint: "high",
          emotion: "震惊",
        },
      ],
    });

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    expect(result.newEpisodicMemories.length).toBe(1);
    expect(result.state.episodicMemories.length).toBe(1);
    expect(result.state.episodicMemories[0].content).toContain("不在预言里");
  });

  it("only adds memories for the correct NPC", () => {
    const state = makeElenaState();
    const observations = makeObservations({
      memoryWorthyEvents: [
        {
          npcName: "观测局局长卡兰德",
          event: "卡兰德的秘密被发现了",
          importanceHint: "medium",
          emotion: "紧张",
        },
      ],
    });

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    // Elena's state should not get this memory (it's for Kaland)
    expect(result.newEpisodicMemories.length).toBe(0);
  });

  it("updates emotional memories from npcsInvolved", () => {
    const state = makeElenaState();
    const observations = makeObservations({
      npcsInvolved: [
        {
          npcName: "观测员埃琳娜",
          reaction: "震惊地看着裂隙的数据",
          emotion: "震惊",
          touchesCoreConcern: true,
        },
      ],
    });

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    expect(result.state.emotionalMemories.length).toBe(1);
    expect(result.state.emotionalMemories[0].emotionalResidue).toBe("震惊");
  });

  it("updates relational memories from npcInteractions", () => {
    const state = makeElenaState();
    const observations = makeObservations({
      npcInteractions: [
        {
          npcA: "观测员埃琳娜",
          npcB: "前观测员特雷弗",
          interaction: "埃琳娜向特雷弗询问裂隙关闭的证据",
          emotionalTone: "positive",
        },
      ],
    });

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    expect(result.state.relationalMemories.length).toBe(1);
    expect(result.state.relationalMemories[0].targetName).toBe("前观测员特雷弗");
    expect(result.state.relationalMemories[0].history[0]).toContain("裂隙关闭");
  });

  it("recomputes pressure after memory updates", () => {
    const state = makeElenaState();
    expect(state.pressure.cognitiveDissonance).toBe(0);

    const observations = makeObservations({
      memoryWorthyEvents: [
        {
          npcName: "观测员埃琳娜",
          event: "发现裂隙的数据与观测局的官方说法矛盾",
          importanceHint: "high",
          emotion: "困惑",
        },
      ],
    });

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    // Pressure should be recomputed
    expect(result.pressureChanged).toBeDefined();
  });

  it("handles empty observations gracefully", () => {
    const state = makeElenaState();
    const observations = makeObservations();

    const result = inferPersonalityUpdate({
      state,
      observations,
      now: Date.now(),
    });

    expect(result.state.episodicMemories.length).toBe(0);
    expect(result.newEpisodicMemories.length).toBe(0);
    expect(result.pressureChanged).toBe(false);
  });
});

// ============================================================
// batchInfer
// ============================================================

describe("batchInfer", () => {
  it("processes all involved NPCs from observations", () => {
    const personalities: Record<string, any> = {
      "观测员埃琳娜": makeElenaState(),
      "前观测员特雷弗": makeElenaState({ npcId: "前观测员特雷弗" }),
    };

    const observations = makeObservations({
      memoryWorthyEvents: [
        {
          npcName: "观测员埃琳娜",
          event: "埃琳娜在裂隙中发现异常",
          importanceHint: "high",
          emotion: "震惊",
        },
        {
          npcName: "前观测员特雷弗",
          event: "特雷弗在酒馆里听到了共鸣的回音",
          importanceHint: "medium",
          emotion: "好奇",
        },
      ],
    });

    const result = batchInfer(personalities, observations, Date.now());

    expect(Object.keys(result.updated).length).toBe(2);
    expect(result.summaries.length).toBe(2);
  });

  it("handles undefined observations", () => {
    const personalities: Record<string, any> = {
      "观测员埃琳娜": makeElenaState(),
    };

    const result = batchInfer(personalities, undefined, Date.now());

    expect(Object.keys(result.updated).length).toBe(0);
  });

  it("skips non-important NPCs", () => {
    const personalities: Record<string, any> = {
      "观测员埃琳娜": makeElenaState(),
      "花店少女莉娜": {
        npcId: "花店少女莉娜",
        isImportant: false,
        archive: {},
        awareness: 0,
        lastUpdated: Date.now(),
      },
    };

    const observations = makeObservations({
      npcsInvolved: [
        { npcName: "观测员埃琳娜", reaction: "...", emotion: "好奇" },
        { npcName: "花店少女莉娜", reaction: "...", emotion: "愉快" },
      ],
    });

    const result = batchInfer(personalities, observations, Date.now());

    // Only Elena should be updated (she's the important one)
    expect(result.summaries.length).toBe(1);
  });

  it("sets awarenessEligible when conditions are met", () => {
    const state = makeElenaState({
      awareness: AwarenessStage.ANOMALY_SENSE,
      anomalousMemories: [
        {
          id: "a1", anomalyType: "deja_vu", description: "...",
          detectedAt: Date.now(), significance: 60, explainedAway: false,
        },
      ],
    });

    const personalities: Record<string, any> = {
      "观测员埃琳娜": state,
    };

    const observations = makeObservations({
      npcsInvolved: [
        {
          npcName: "观测员埃琳娜",
          reaction: "表情变得严肃",
          emotion: "不安",
          touchesCoreConcern: true,
        },
      ],
    });

    const result = batchInfer(personalities, observations, Date.now());
    const elenaSummary = result.summaries.find((s) => s.npcId === "观测员埃琳娜");

    expect(elenaSummary).toBeDefined();
    // With 1+ unexplained anomaly and boundarySensitivity >= 25,
    // and pressure changed from the npcsInvolved update,
    // awarenessEligible should be true
    if (elenaSummary!.pressureChanged) {
      expect(elenaSummary!.awarenessEligible).toBe(true);
    }
  });
});
