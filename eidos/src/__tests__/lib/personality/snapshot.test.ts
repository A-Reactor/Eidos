// ============================================================
// 人格推演引擎 — Snapshot 往返测试
// ============================================================

import { describe, it, expect } from "vitest";
import { AwarenessStage } from "@/lib/personality/types";
import type { PersonalityState, AnyPersonalityState, MinimalPersonalityState } from "@/lib/personality/types";
import type { WorldSnapshot } from "@/lib/game/types";

// ============================================================
// 测试夹具
// ============================================================

function makeElenaState(): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["找到裂隙中的那个人", "重新找回对未来的期待"],
      fearsAndTaboos: ["变成空壳", "失去意义"],
      valuePriorities: ["真实", "连接", "意义", "希望"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "suppression",
      socialStrategy: "verification",
      boundarySensitivity: 40,
      metacognition: 65,
    },
    awareness: AwarenessStage.NORMAL,
    episodicMemories: [
      {
        id: "ep_1",
        timestamp: Date.now(),
        content: "玩家在裂隙中出现了",
        importance: 90,
        emotion: "震惊",
        relatedNpcs: [],
        relatedBeliefs: [],
      },
    ],
    semanticMemories: [
      {
        id: "sem_1",
        fact: "裂隙展示未来",
        confidence: 95,
        source: "direct",
      },
    ],
    emotionalMemories: [
      {
        npcName: "玩家",
        eventType: "observation",
        emotionalResidue: "好奇",
        intensity: 60,
        lastTriggered: Date.now(),
      },
    ],
    relationalMemories: [
      {
        targetName: "玩家",
        role: "unknown",
        trust: 10,
        history: ["首次出现在裂隙中"],
      },
    ],
    anomalousMemories: [],
    beliefs: {
      confirmedFacts: [],
      unverifiedHypotheses: [],
      suppressedTruths: [],
      contradictions: [],
      interpretationOfPlayer: "一个不在未来里的人",
      interpretationOfWorld: "真实的世界",
      interpretationOfSelf: "真实的个体",
    },
    pressure: {
      survival: 0,
      relational: 10,
      cognitiveDissonance: 45,
      unfinishedGoals: 30,
      trustInPlayer: 20,
      worldDoubt: 5,
      selfContinuityFear: 0,
    },
    lastUpdated: Date.now(),
    isImportant: true as const,
  };
}

function makeMinimalState(): MinimalPersonalityState {
  return {
    npcId: "花店少女莉娜",
    archive: {
      coreDesires: ["过好自己的生活"],
      fearsAndTaboos: ["未知的威胁"],
      valuePriorities: ["安全", "连接"],
      cognitiveStyle: "intuitive",
      emotionalRegulation: "suppression",
      socialStrategy: "negotiation",
      boundarySensitivity: 15,
      metacognition: 20,
    },
    awareness: AwarenessStage.NORMAL,
    lastUpdated: Date.now(),
    isImportant: false as const,
  };
}

// Simulate the snapshot serialization pattern used in world-slice.ts
function simulateSnapshotCapture(personalities: Record<string, AnyPersonalityState>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(personalities).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v)),
    ])
  );
}

function simulateSnapshotRestore(snapshotPersonalities: Record<string, any> | undefined): Record<string, AnyPersonalityState> {
  if (!snapshotPersonalities) return {};
  return Object.fromEntries(
    Object.entries(snapshotPersonalities).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v)),
    ])
  ) as Record<string, AnyPersonalityState>;
}

// ============================================================
// Tests
// ============================================================

describe("Personality Snapshot Roundtrip", () => {
  it("captures full personality state for important NPC", () => {
    const personalities: Record<string, AnyPersonalityState> = {
      "观测员埃琳娜": makeElenaState(),
    };
    const captured = simulateSnapshotCapture(personalities);
    expect(captured["观测员埃琳娜"]).toBeDefined();
    expect(captured["观测员埃琳娜"].archive.coreDesires).toContain("找到裂隙中的那个人");
    expect(captured["观测员埃琳娜"].episodicMemories.length).toBe(1);
    expect(captured["观测员埃琳娜"].isImportant).toBe(true);
  });

  it("restores personality state exactly", () => {
    const original = makeElenaState();
    const personalities: Record<string, AnyPersonalityState> = {
      "观测员埃琳娜": original,
    };
    const captured = simulateSnapshotCapture(personalities);
    const restored = simulateSnapshotRestore(captured);

    expect(restored["观测员埃琳娜"]).toBeDefined();
    const restoredState = restored["观测员埃琳娜"] as PersonalityState;
    expect(restoredState.npcId).toBe("观测员埃琳娜");
    expect(restoredState.archive.cognitiveStyle).toBe("analytical");
    expect(restoredState.episodicMemories.length).toBe(1);
    expect(restoredState.episodicMemories[0].content).toBe("玩家在裂隙中出现了");
    expect(restoredState.isImportant).toBe(true);
  });

  it("handles minimal personality state for non-important NPC", () => {
    const personalities: Record<string, AnyPersonalityState> = {
      "花店少女莉娜": makeMinimalState(),
    };
    const captured = simulateSnapshotCapture(personalities);
    expect(captured["花店少女莉娜"]).toBeDefined();
    expect(captured["花店少女莉娜"].isImportant).toBe(false);
    // Minimal state should not have memory arrays
    expect((captured["花店少女莉娜"] as any).episodicMemories).toBeUndefined();
  });

  it("handles multiple NPCs in a single snapshot", () => {
    const personalities: Record<string, AnyPersonalityState> = {
      "观测员埃琳娜": makeElenaState(),
      "前观测员特雷弗": {
        ...makeElenaState(),
        npcId: "前观测员特雷弗",
        archive: {
          ...makeElenaState().archive,
          cognitiveStyle: "skeptical" as const,
        },
      },
      "花店少女莉娜": makeMinimalState(),
    };
    const captured = simulateSnapshotCapture(personalities);

    expect(Object.keys(captured).length).toBe(3);
  });

  it("returns empty state when npcPersonalities is undefined in snapshot", () => {
    const restored = simulateSnapshotRestore(undefined);
    expect(restored).toEqual({});
  });

  it("returns empty state when npcPersonalities is empty in snapshot", () => {
    const restored = simulateSnapshotRestore({});
    expect(restored).toEqual({});
  });

  it("preserves deep nested data through roundtrip", () => {
    const state = makeElenaState();
    state.semanticMemories = [
      { id: "sem_1", fact: "裂隙正在关闭", confidence: 80, source: "anomaly" },
    ];
    state.anomalousMemories = [
      {
        id: "anom_1",
        anomalyType: "deja_vu",
        description: "玩家重复了之前相同的行动",
        detectedAt: Date.now(),
        significance: 70,
        explainedAway: false,
      },
    ];

    const captured = simulateSnapshotCapture({ "观测员埃琳娜": state });
    const restored = simulateSnapshotRestore(captured);
    const restoredState = restored["观测员埃琳娜"] as PersonalityState;

    expect(restoredState.semanticMemories[0].fact).toBe("裂隙正在关闭");
    expect(restoredState.semanticMemories[0].confidence).toBe(80);
    expect(restoredState.anomalousMemories[0].anomalyType).toBe("deja_vu");
    expect(restoredState.anomalousMemories[0].significance).toBe(70);
  });
});
