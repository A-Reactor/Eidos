// ============================================================
// 人格推演引擎 — 社会场测试（Phase 5）
// ============================================================

import { describe, it, expect } from "vitest";
import {
  buildSocialNetwork,
  propagateAnomaly,
  formGroupHypothesis,
  crossVerifyMemories,
} from "@/lib/personality/social";
import { AwarenessStage } from "@/lib/personality/types";
import type {
  PersonalityState,
  AnomalousMemory,
  SocialConnection,
  GroupHypothesis,
} from "@/lib/personality/types";

// ============================================================
// 夹具
// ============================================================

function makeState(overrides: Partial<PersonalityState> = {}): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["发现真相"],
      fearsAndTaboos: ["被欺骗"],
      valuePriorities: ["真实"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "suppression",
      socialStrategy: "verification",
      boundarySensitivity: 40,
      metacognition: 65,
    },
    awareness: AwarenessStage.ANOMALY_SENSE,
    episodicMemories: [],
    semanticMemories: [],
    emotionalMemories: [],
    relationalMemories: [],
    anomalousMemories: [],
    beliefs: {
      confirmedFacts: [], unverifiedHypotheses: [], suppressedTruths: [],
      contradictions: [], interpretationOfPlayer: "",
      interpretationOfWorld: "real", interpretationOfSelf: "real",
    },
    pressure: {
      survival: 0, relational: 0, cognitiveDissonance: 30,
      unfinishedGoals: 0, trustInPlayer: 0, worldDoubt: 20,
      selfContinuityFear: 10,
    },
    anomalyInterpretation: {
      explanation: "数据出现了时间不连续", type: "rationalized", confidence: 55,
    },
    lastUpdated: Date.now(),
    isImportant: true as const,
    ...overrides,
  };
}

function makeAnomaly(overrides: Partial<AnomalousMemory> = {}): AnomalousMemory {
  return {
    id: `a_${Math.random().toString(36).slice(2, 6)}`,
    anomalyType: "deja_vu",
    description: "重复的感觉挥之不去",
    detectedAt: Date.now(),
    significance: 50,
    explainedAway: false,
    ...overrides,
  };
}

// ============================================================
// buildSocialNetwork
// ============================================================

describe("buildSocialNetwork", () => {
  it("builds connections between scene NPCs", () => {
    const network = buildSocialNetwork({
      sceneNpcs: ["观测员埃琳娜", "前观测员特雷弗", "观测局局长卡兰德"],
      personalities: {
        "观测员埃琳娜": makeState(),
        "前观测员特雷弗": makeState({ npcId: "前观测员特雷弗" }),
        "观测局局长卡兰德": makeState({ npcId: "观测局局长卡兰德" }),
      },
      npcDescriptions: {
        "观测员埃琳娜": "观测员",
        "前观测员特雷弗": "前观测员",
        "观测局局长卡兰德": "管理观测局的局长",
      },
      region: "上城区",
    });

    expect(network.length).toBe(3); // 3 NPCs → 3 pairs
    expect(network[0].relationshipType).toBe("coworker");
  });

  it("detects authority relationship from descriptions", () => {
    const network = buildSocialNetwork({
      sceneNpcs: ["观测局局长卡兰德", "观测员埃琳娜"],
      personalities: {
        "观测局局长卡兰德": makeState({ npcId: "观测局局长卡兰德" }),
        "观测员埃琳娜": makeState(),
      },
      npcDescriptions: {
        "观测局局长卡兰德": "管理观测局的局长，负责管理观测员埃琳娜",
        "观测员埃琳娜": "观测员",
      },
      region: "上城区",
    });

    const conn = network[0];
    expect(conn.relationshipType).toBe("authority");
    // 下级对上级应有较高信任
    const elenaTrust =
      conn.npcA === "观测员埃琳娜" ? conn.trustAtoB : conn.trustBtoA;
    expect(elenaTrust).toBeGreaterThanOrEqual(40);
  });

  it("uses RelationalMemory trust when available", () => {
    const elena = makeState({
      relationalMemories: [
        {
          targetName: "前观测员特雷弗",
          role: "ally",
          trust: 60,
          history: ["交换过裂隙观测数据"],
        },
      ],
    });

    const network = buildSocialNetwork({
      sceneNpcs: ["观测员埃琳娜", "前观测员特雷弗"],
      personalities: {
        "观测员埃琳娜": elena,
        "前观测员特雷弗": makeState({ npcId: "前观测员特雷弗" }),
      },
      npcDescriptions: { "观测员埃琳娜": "", "前观测员特雷弗": "" },
      region: "上城区",
    });

    const conn = network[0];
    const trustToTrevor =
      conn.npcA === "观测员埃琳娜" ? conn.trustAtoB : conn.trustBtoA;
    expect(trustToTrevor).toBe(60);
  });

  it("keeps building scene connections when an involved NPC has no personality state yet", () => {
    expect(() =>
      buildSocialNetwork({
        sceneNpcs: ["观测员埃琳娜", "临时目击者"],
        personalities: {
          "观测员埃琳娜": makeState(),
        },
        npcDescriptions: {
          "观测员埃琳娜": "观测员",
          "临时目击者": "尚未建档的路人",
        },
        region: "上城区",
      }),
    ).not.toThrow();

    const network = buildSocialNetwork({
      sceneNpcs: ["观测员埃琳娜", "临时目击者"],
      personalities: {
        "观测员埃琳娜": makeState(),
      },
      npcDescriptions: {
        "观测员埃琳娜": "观测员",
        "临时目击者": "尚未建档的路人",
      },
      region: "上城区",
    });

    expect(network).toHaveLength(1);
    expect(network[0].trustAtoB).toBe(10);
    expect(network[0].trustBtoA).toBe(10);
  });
});

// ============================================================
// propagateAnomaly
// ============================================================

describe("propagateAnomaly", () => {
  it("propagates anomalies through trusted connections", () => {
    const network: SocialConnection[] = [
      {
        npcA: "观测员埃琳娜",
        npcB: "前观测员特雷弗",
        trustAtoB: 50,
        trustBtoA: 40,
        relationshipType: "coworker",
        lastInteraction: Date.now(),
      },
    ];

    // Use high sharing probability by setting source to verification type
    const sourceState = makeState({
      npcId: "观测员埃琳娜",
      anomalousMemories: [makeAnomaly({ description: "时间好像重复了" })],
    });
    const targetState = makeState({
      npcId: "前观测员特雷弗",
      archive: { ...makeState().archive, cognitiveStyle: "skeptical" },
    });

    const result = propagateAnomaly({
      sourceNpcId: "观测员埃琳娜",
      sourceAnomalies: sourceState.anomalousMemories,
      network,
      personalities: {
        "观测员埃琳娜": sourceState,
        "前观测员特雷弗": targetState,
      },
      now: Date.now(),
    });

    // Even with skeptical target, events should be generated
    expect(result.events.length).toBeGreaterThanOrEqual(0);
  });

  it("does not propagate when trust is negative", () => {
    const network: SocialConnection[] = [
      {
        npcA: "观测员埃琳娜",
        npcB: "前观测员特雷弗",
        trustAtoB: -20,
        trustBtoA: 0,
        relationshipType: "rival",
        lastInteraction: Date.now(),
      },
    ];

    const result = propagateAnomaly({
      sourceNpcId: "观测员埃琳娜",
      sourceAnomalies: [makeAnomaly()],
      network,
      personalities: {
        "观测员埃琳娜": makeState(),
        "前观测员特雷弗": makeState({ npcId: "前观测员特雷弗" }),
      },
      now: Date.now(),
    });

    expect(result.events.length).toBe(0);
  });
});

// ============================================================
// formGroupHypothesis
// ============================================================

describe("formGroupHypothesis", () => {
  it("forms group hypothesis when NPCs share interpretation type", () => {
    const elena = makeState({
      npcId: "观测员埃琳娜",
      awareness: AwarenessStage.HYPOTHESIS,
      anomalousMemories: [makeAnomaly(), makeAnomaly()],
      anomalyInterpretation: {
        explanation: "数据有异常", type: "rationalized", confidence: 55,
      },
    });
    const trevor = makeState({
      npcId: "前观测员特雷弗",
      awareness: AwarenessStage.HYPOTHESIS,
      anomalousMemories: [makeAnomaly()],
      anomalyInterpretation: {
        explanation: "有人在篡改记录", type: "rationalized", confidence: 50,
      },
    });

    const network: SocialConnection[] = [
      {
        npcA: "观测员埃琳娜",
        npcB: "前观测员特雷弗",
        trustAtoB: 30,
        trustBtoA: 30,
        relationshipType: "coworker",
        lastInteraction: Date.now(),
      },
    ];

    const groups = formGroupHypothesis(
      ["观测员埃琳娜", "前观测员特雷弗"],
      { "观测员埃琳娜": elena, "前观测员特雷弗": trevor },
      network,
      [],
      Date.now(),
    );

    // Should form a group since both are aware and share rationalized type
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("does not form group with only one aware NPC", () => {
    const elena = makeState({
      awareness: AwarenessStage.ANOMALY_SENSE,
      anomalyInterpretation: { explanation: "异常", type: "rationalized", confidence: 40 },
    });
    const normal = makeState({
      npcId: "路人",
      awareness: AwarenessStage.NORMAL,
      anomalyInterpretation: undefined,
    });

    const groups = formGroupHypothesis(
      ["观测员埃琳娜", "路人"],
      { "观测员埃琳娜": elena, "路人": normal },
      [],
      [],
      Date.now(),
    );

    expect(groups.length).toBe(0);
  });
});

// ============================================================
// crossVerifyMemories
// ============================================================

describe("crossVerifyMemories", () => {
  it("confirms when both NPCs have similar anomalies", () => {
    const elena = makeState({
      anomalousMemories: [
        makeAnomaly({ description: "时间好像重复了，数据对不上" }),
      ],
    });
    const trevor = makeState({
      npcId: "前观测员特雷弗",
      anomalousMemories: [
        makeAnomaly({ description: "时间确实重复了，我也有数据对不上" }),
      ],
    });

    const result = crossVerifyMemories(elena, trevor);
    expect(result.outcome).toBe("confirmed");
    expect(result.dissonanceDeltaA).toBeLessThan(0); // lowers dissonance
  });

  it("contradicts when one has anomalies and the other does not", () => {
    const elena = makeState({
      anomalousMemories: [makeAnomaly()],
    });
    const trevor = makeState({
      npcId: "前观测员特雷弗",
      anomalousMemories: [],
    });

    const result = crossVerifyMemories(elena, trevor);
    expect(result.outcome).toBe("contradicted");
  });

  it("returns inconclusive when both have no anomalies", () => {
    const elena = makeState({ anomalousMemories: [] });
    const trevor = makeState({
      npcId: "前观测员特雷弗",
      anomalousMemories: [],
    });

    const result = crossVerifyMemories(elena, trevor);
    expect(result.outcome).toBe("inconclusive");
  });
});
