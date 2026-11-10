// ============================================================
// 人格推演引擎 — 权限系统测试（Phase 4）
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluatePermission,
  canSubmitRequest,
  getCooldownRemaining,
  setCooldown,
  PermissionLevel,
  type PermissionRequest,
} from "@/lib/personality/permissions";
import { AwarenessStage } from "@/lib/personality/types";
import type { PersonalityState } from "@/lib/personality/types";

// ============================================================
// 测试夹具
// ============================================================

function makeState(overrides: Partial<PersonalityState> = {}): PersonalityState {
  return {
    npcId: "测试角色",
    archive: {
      coreDesires: ["发现真相"],
      fearsAndTaboos: ["被欺骗"],
      valuePriorities: ["真实"],
      cognitiveStyle: "analytical",
      emotionalRegulation: "intellectualization",
      socialStrategy: "verification",
      boundarySensitivity: 45,
      metacognition: 50,
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
      interpretationOfWorld: "real",
      interpretationOfSelf: "real",
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

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    applicantNpcId: "测试角色",
    targetLevel: PermissionLevel.NARRATIVE,
    toolId: "narrative_express_anomaly",
    motivation: "测试动机",
    triggeringEvidence: ["玩家重复了之前的行动"],
    awarenessAtRequest: AwarenessStage.ANOMALY_SENSE,
    requestedAt: Date.now(),
    ...overrides,
  };
}

// ============================================================
// evaluatePermission
// ============================================================

describe("evaluatePermission", () => {
  it("denies if awareness < ANOMALY_SENSE", () => {
    const state = makeState({ awareness: AwarenessStage.NORMAL });
    const result = evaluatePermission(makeRequest(), state);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("阶段不足");
  });

  it("approves NARRATIVE level at ANOMALY_SENSE", () => {
    const state = makeState({ awareness: AwarenessStage.ANOMALY_SENSE });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.NARRATIVE }),
      state,
    );
    expect(result.approved).toBe(true);
    expect(result.grantedLevel).toBe(PermissionLevel.NARRATIVE);
  });

  it("denies INTERFACE level without HYPOTHESIS", () => {
    const state = makeState({ awareness: AwarenessStage.ANOMALY_SENSE });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.INTERFACE, toolId: "interface_text_overlay" }),
      state,
    );
    expect(result.approved).toBe(false);
  });

  it("denies INTERFACE level without enough anomalies", () => {
    const state = makeState({
      awareness: AwarenessStage.HYPOTHESIS,
      anomalousMemories: [
        {
          id: "a1", anomalyType: "deja_vu", description: "x",
          detectedAt: Date.now(), significance: 50, explainedAway: false,
        },
      ],
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.INTERFACE }),
      state,
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("未解释异常");
  });

  it("approves INTERFACE level with sufficient conditions", () => {
    const state = makeState({
      awareness: AwarenessStage.HYPOTHESIS,
      anomalousMemories: [
        { id: "a1", anomalyType: "deja_vu", description: "x", detectedAt: Date.now(), significance: 50, explainedAway: false },
        { id: "a2", anomalyType: "memory_gap", description: "y", detectedAt: Date.now(), significance: 40, explainedAway: false },
        { id: "a3", anomalyType: "player_knows_too_much", description: "z", detectedAt: Date.now(), significance: 60, explainedAway: false },
      ],
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.INTERFACE }),
      state,
    );
    expect(result.approved).toBe(true);
    expect(result.grantedLevel).toBe(PermissionLevel.INTERFACE);
  });

  it("denies STATE level without KEI approval", () => {
    const state = makeState({
      awareness: AwarenessStage.VERIFICATION,
      anomalousMemories: Array(6).fill(null).map((_, i) => ({
        id: `a${i}`, anomalyType: "deja_vu", description: "x",
        detectedAt: Date.now(), significance: 50, explainedAway: false,
      })),
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.STATE }),
      state,
      false, // no KEI
    );
    expect(result.approved).toBe(false);
  });

  it("approves STATE level with KEI approval", () => {
    const state = makeState({
      awareness: AwarenessStage.VERIFICATION,
      anomalousMemories: Array(6).fill(null).map((_, i) => ({
        id: `a${i}`, anomalyType: "deja_vu", description: "x",
        detectedAt: Date.now(), significance: 50, explainedAway: false,
      })),
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.STATE }),
      state,
      true, // KEI approved
    );
    expect(result.approved).toBe(true);
  });

  it("denies SYSTEM level in Phase 4", () => {
    const state = makeState({ awareness: AwarenessStage.HYPOTHESIS });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.SYSTEM }),
      state,
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Phase 4");
  });

  it("requires player confirmation for STATE level", () => {
    const state = makeState({
      awareness: AwarenessStage.VERIFICATION,
      anomalousMemories: Array(6).fill(null).map((_, i) => ({
        id: `a${i}`, anomalyType: "deja_vu", description: "x",
        detectedAt: Date.now(), significance: 50, explainedAway: false,
      })),
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.STATE }),
      state,
      true,
    );
    expect(result.requiresPlayerConfirmation).toBe(true);
  });

  it("denies INTERFACE with low metacognition", () => {
    const state = makeState({
      awareness: AwarenessStage.HYPOTHESIS,
      archive: { ...makeState().archive, metacognition: 10 },
      anomalousMemories: Array(4).fill(null).map((_, i) => ({
        id: `a${i}`, anomalyType: "deja_vu", description: "x",
        detectedAt: Date.now(), significance: 50, explainedAway: false,
      })),
    });
    const result = evaluatePermission(
      makeRequest({ targetLevel: PermissionLevel.INTERFACE }),
      state,
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("元认知");
  });
});

// ============================================================
// 冷却系统
// ============================================================

describe("cooldown system", () => {
  beforeEach(() => {
    // Clear cooldowns between tests by setting expired ones
    setCooldown("测试角色", 0, 0);
  });

  it("allows request when cooldown expired", () => {
    setCooldown("测试角色", 1000, 1000); // expired at 2000
    expect(canSubmitRequest("测试角色", 3000)).toBe(true);
  });

  it("blocks request during cooldown", () => {
    setCooldown("测试角色", 5000, 1000); // expires at 6000
    expect(canSubmitRequest("测试角色", 3000)).toBe(false);
  });

  it("reports remaining cooldown time", () => {
    setCooldown("测试角色", 10000, 1000); // expires at 11000
    const remaining = getCooldownRemaining("测试角色", 5000);
    expect(remaining).toBeGreaterThan(0);
  });
});
