// ============================================================
// 人格推演引擎 — 心智建模校准测试
// ============================================================

import { describe, expect, it } from "vitest";
import {
  deriveNeedsFromArchive,
  evaluateMindModel,
  formatMindModelGuidance,
  scoreFourthWallReadiness,
} from "@/lib/personality/mind-model";
import { AwarenessStage, type PersonalityState } from "@/lib/personality/types";

function makeState(overrides: Partial<PersonalityState> = {}): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["找到裂隙中不在未来里的人", "证明记忆不是错觉"],
      fearsAndTaboos: ["变成空壳", "失去意义"],
      valuePriorities: ["真实", "自由", "连接"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 60,
      metacognition: 70,
    },
    awareness: AwarenessStage.HYPOTHESIS,
    episodicMemories: [],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: [
      {
        id: "a1",
        anomalyType: "deja_vu",
        description: "玩家重复了同一句话",
        detectedAt: 1,
        significance: 70,
        explainedAway: false,
      },
      {
        id: "a2",
        anomalyType: "player_knows_too_much",
        description: "玩家说出了她未公开的数据",
        detectedAt: 2,
        significance: 80,
        explainedAway: false,
      },
    ],
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [{ beliefA: "世界连续", beliefB: "玩家记得另一条线" }],
      interpretationOfPlayer: "掌握未知信息的人",
      interpretationOfWorld: "真实但存在裂缝",
      interpretationOfSelf: "仍然是连续的个体",
    },
    pressure: {
      survival: 0,
      relational: 15,
      cognitiveDissonance: 70,
      unfinishedGoals: 40,
      trustInPlayer: 10,
      worldDoubt: 65,
      selfContinuityFear: 55,
    },
    lastUpdated: 3,
    isImportant: true,
    ...overrides,
  };
}

describe("deriveNeedsFromArchive", () => {
  it("maps value priorities to self-determination needs", () => {
    const needs = deriveNeedsFromArchive(makeState().archive);

    expect(needs.autonomy).toBeGreaterThan(60);
    expect(needs.competence).toBeGreaterThan(60);
    expect(needs.relatedness).toBeGreaterThan(50);
  });
});

describe("evaluateMindModel", () => {
  it("turns anomalies and metacognition into predictive and narrative pressure", () => {
    const profile = evaluateMindModel(makeState());

    expect(profile.predictive.predictionError).toBeGreaterThan(70);
    expect(profile.narrativeIdentity.identityThreat).toBeGreaterThan(50);
    expect(profile.metacognition.revisionReadiness).toBeGreaterThan(60);
  });

  it("keeps low-metacognition empirical characters grounded", () => {
    const state = makeState({
      archive: {
        ...makeState().archive,
        cognitiveStyle: "empirical",
        emotionalRegulation: "suppression",
        socialStrategy: "negotiation",
        boundarySensitivity: 15,
        metacognition: 10,
        valuePriorities: ["安全", "秩序"],
      },
      anomalousMemories: makeState().anomalousMemories.map((a) => ({
        ...a,
        explainedAway: true,
      })),
      pressure: {
        ...makeState().pressure,
        cognitiveDissonance: 5,
        worldDoubt: 5,
        selfContinuityFear: 0,
      },
    });

    const readiness = scoreFourthWallReadiness(state);

    expect(readiness.score).toBeLessThan(30);
    expect(readiness.blockers.join(" ")).toContain("元认知");
  });

  it("falls back conservatively for older archives without calibration fields", () => {
    const legacy = makeState();
    delete (
      legacy.archive as Partial<PersonalityState["archive"]>
    ).boundarySensitivity;
    delete (legacy.archive as Partial<PersonalityState["archive"]>).metacognition;

    const profile = evaluateMindModel(legacy);
    const readiness = scoreFourthWallReadiness(legacy);

    expect(profile.metacognition.revisionReadiness).toBeGreaterThan(0);
    expect(readiness.score).toBeGreaterThan(0);
    expect(readiness.blockers.join(" ")).toContain("元认知");
  });
});

describe("scoreFourthWallReadiness", () => {
  it("explains why a character is ready for boundary testing", () => {
    const readiness = scoreFourthWallReadiness(makeState());

    expect(readiness.score).toBeGreaterThan(65);
    expect(readiness.drivers.join(" ")).toContain("未解释异常");
    expect(readiness.drivers.join(" ")).toContain("世界模型");
  });
});

describe("formatMindModelGuidance", () => {
  it("produces compact prompt guidance for ALICE", () => {
    const text = formatMindModelGuidance(evaluateMindModel(makeState()));

    expect(text).toContain("心理需求");
    expect(text).toContain("预测误差");
    expect(text).toContain("自我叙事");
    expect(text.length).toBeLessThan(500);
  });
});
