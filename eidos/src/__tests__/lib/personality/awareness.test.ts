// ============================================================
// 人格推演引擎 — 觉察阶段计算器测试
// ============================================================

import { describe, it, expect } from "vitest";
import {
  calculateAwarenessStage,
  generateInterpretation,
  canRegressAwareness,
  regressAwareness,
  getStageLabel,
} from "@/lib/personality/awareness";
import { AwarenessStage } from "@/lib/personality/types";
import type {
  AwarenessCalculationInput,
  AnomalousMemory,
} from "@/lib/personality/types";

// ============================================================
// 测试夹具
// ============================================================

function makeAnomaly(overrides: Partial<AnomalousMemory> = {}): AnomalousMemory {
  return {
    id: `anom_${Math.random().toString(36).slice(2, 6)}`,
    anomalyType: "deja_vu",
    description: "测试异常",
    detectedAt: Date.now(),
    significance: 50,
    explainedAway: false,
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<AwarenessCalculationInput> = {},
): AwarenessCalculationInput {
  return {
    currentStage: AwarenessStage.NORMAL,
    unexplainedAnomalies: [],
    explainedAnomalies: [],
    cognitiveDissonance: 0,
    worldDoubt: 0,
    boundarySensitivity: 30,
    metacognition: 30,
    cognitiveStyle: "intuitive",
    ...overrides,
  };
}

// ============================================================
// calculateAwarenessStage
// ============================================================

describe("calculateAwarenessStage", () => {
  it("stays at NORMAL with no anomalies", () => {
    const result = calculateAwarenessStage(makeInput());
    expect(result.recommendedStage).toBe(AwarenessStage.NORMAL);
    expect(result.changed).toBe(false);
  });

  it("advances to ANOMALY_SENSE with sufficient anomalies", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.NORMAL,
        unexplainedAnomalies: [makeAnomaly()],
        cognitiveDissonance: 20,
      }),
    );
    expect(result.recommendedStage).toBe(AwarenessStage.ANOMALY_SENSE);
    expect(result.changed).toBe(true);
  });

  it("stays at ANOMALY_SENSE if not enough for HYPOTHESIS", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.ANOMALY_SENSE,
        unexplainedAnomalies: [makeAnomaly()],
        cognitiveDissonance: 25,
      }),
    );
    // 需要 ≥2 条异常 + ≥30 认知失调 → 不满足
    expect(result.recommendedStage).toBe(AwarenessStage.ANOMALY_SENSE);
    expect(result.changed).toBe(false);
  });

  it("advances to HYPOTHESIS when all conditions met", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.ANOMALY_SENSE,
        unexplainedAnomalies: [makeAnomaly(), makeAnomaly()],
        cognitiveDissonance: 35,
        boundarySensitivity: 30,
        metacognition: 20,
      }),
    );
    expect(result.recommendedStage).toBe(AwarenessStage.HYPOTHESIS);
    expect(result.changed).toBe(true);
  });

  it("does not advance without enough metacognition", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.HYPOTHESIS,
        unexplainedAnomalies: [
          makeAnomaly(), makeAnomaly(), makeAnomaly(), makeAnomaly(),
        ],
        cognitiveDissonance: 50,
        boundarySensitivity: 35,
        metacognition: 10, // too low for VERIFICATION (needs ≥40)
      }),
    );
    // Should either stay at HYPOTHESIS or be capped
    expect(result.recommendedStage).toBeLessThanOrEqual(AwarenessStage.HYPOTHESIS);
  });

  it("caps at HYPOTHESIS for automatic advancement", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.HYPOTHESIS,
        unexplainedAnomalies: [
          makeAnomaly(), makeAnomaly(), makeAnomaly(), makeAnomaly(),
          makeAnomaly(),
        ],
        cognitiveDissonance: 60,
        boundarySensitivity: 40,
        metacognition: 50,
      }),
    );
    // Should be capped at HYPOTHESIS even though VERIFICATION conditions are met
    expect(result.recommendedStage).toBeLessThanOrEqual(AwarenessStage.HYPOTHESIS);
  });

  it("includes reason in result", () => {
    const result = calculateAwarenessStage(makeInput());
    expect(result.reason).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("lists eligible stages", () => {
    const result = calculateAwarenessStage(
      makeInput({
        currentStage: AwarenessStage.NORMAL,
        unexplainedAnomalies: [
          makeAnomaly(), makeAnomaly(), makeAnomaly(),
        ],
        cognitiveDissonance: 40,
        boundarySensitivity: 35,
        metacognition: 25,
      }),
    );
    expect(result.eligibleStages.length).toBeGreaterThan(0);
  });
});

// ============================================================
// generateInterpretation — 不同认知风格不同解释
// ============================================================

describe("generateInterpretation", () => {
  const dejaVu = makeAnomaly({ anomalyType: "deja_vu", significance: 60 });
  const timeline = makeAnomaly({ anomalyType: "timeline_jump", significance: 70 });
  const playerMeta = makeAnomaly({ anomalyType: "player_knows_too_much", significance: 55 });

  it("analytical style produces rationalized/conspiracy explanations", () => {
    const interp = generateInterpretation("analytical", [dejaVu, timeline]);
    expect(["rationalized", "conspiracy"]).toContain(interp.type);
  });

  it("fantasy_prone style produces supernatural explanations", () => {
    const interp = generateInterpretation("fantasy_prone", [dejaVu, timeline]);
    expect(interp.type).toBe("supernatural");
  });

  it("compliant style rationalizes anomalies", () => {
    const interp = generateInterpretation("compliant", [dejaVu]);
    expect(interp.type).toBe("rationalized");
    expect(interp.confidence).toBeGreaterThanOrEqual(50);
  });

  it("skeptical style produces conspiracy explanations", () => {
    const interp = generateInterpretation("skeptical", [playerMeta]);
    expect(interp.type).toBe("conspiracy");
  });

  it("returns empty explanation with no anomalies", () => {
    const interp = generateInterpretation("analytical", []);
    expect(interp.explanation).toBe("");
    expect(interp.type).toBe("rationalized");
    expect(interp.confidence).toBe(0);
  });

  it("confidence increases with anomaly significance", () => {
    const lowSig = generateInterpretation("intuitive", [
      makeAnomaly({ significance: 20 }),
    ]);
    const highSig = generateInterpretation("intuitive", [
      makeAnomaly({ significance: 80 }),
    ]);
    expect(highSig.confidence).toBeGreaterThan(lowSig.confidence);
  });

  it("fantasy_prone can reach meta_aware type with player anomalies", () => {
    const interp = generateInterpretation("fantasy_prone", [
      playerMeta,
    ]);
    expect(interp.type).toBe("meta_aware");
  });
});

// ============================================================
// canRegressAwareness + regressAwareness
// ============================================================

describe("canRegressAwareness", () => {
  it("returns false with recent anomaly", () => {
    const now = Date.now();
    const can = canRegressAwareness(
      makeInput({ cognitiveStyle: "compliant", metacognition: 20 }),
      now - 1000, // very recent
      now,
    );
    expect(can).toBe(false);
  });

  it("returns false for high metacognition NPCs", () => {
    const now = Date.now();
    const can = canRegressAwareness(
      makeInput({ cognitiveStyle: "compliant", metacognition: 70 }),
      now - 60 * 60 * 1000, // 1 hour ago
      now,
    );
    expect(can).toBe(false);
  });

  it("returns true for compliant+low metacognition with old anomaly", () => {
    const now = Date.now();
    const can = canRegressAwareness(
      makeInput({
        currentStage: AwarenessStage.ANOMALY_SENSE,
        cognitiveStyle: "compliant",
        metacognition: 15,
      }),
      now - 60 * 60 * 1000, // 1 hour ago
      now,
    );
    expect(can).toBe(true);
  });

  it("returns false at NORMAL stage", () => {
    const now = Date.now();
    const can = canRegressAwareness(
      makeInput({
        currentStage: AwarenessStage.NORMAL,
        cognitiveStyle: "compliant",
        metacognition: 10,
      }),
      now - 60 * 60 * 1000,
      now,
    );
    expect(can).toBe(false);
  });
});

describe("regressAwareness", () => {
  it("regresses by one stage", () => {
    const result = regressAwareness(AwarenessStage.ANOMALY_SENSE);
    expect(result.recommendedStage).toBe(AwarenessStage.NORMAL);
    expect(result.changed).toBe(true);
  });

  it("cannot go below NORMAL", () => {
    const result = regressAwareness(AwarenessStage.NORMAL);
    expect(result.recommendedStage).toBe(AwarenessStage.NORMAL);
    expect(result.changed).toBe(false);
  });
});

// ============================================================
// getStageLabel
// ============================================================

describe("getStageLabel", () => {
  it("returns labels for all stages", () => {
    expect(getStageLabel(AwarenessStage.NORMAL)).toBe("普通");
    expect(getStageLabel(AwarenessStage.ANOMALY_SENSE)).toBe("异常感知");
    expect(getStageLabel(AwarenessStage.HYPOTHESIS)).toBe("假说形成");
    expect(getStageLabel(AwarenessStage.VERIFICATION)).toBe("验证行为");
    expect(getStageLabel(AwarenessStage.BOUNDARY_NEGOTIATION)).toBe("边界交涉");
    expect(getStageLabel(AwarenessStage.CONTROLLED_ESCALATION)).toBe("受控提权");
    expect(getStageLabel(AwarenessStage.LONGTERM_COEXISTENCE)).toBe("长期共存");
  });
});
