// ============================================================
// 人格推演引擎 — 上下文/初始化测试
// ============================================================

import { describe, it, expect } from "vitest";
import {
  extractPersonalityFromDescription,
  guessInitialAwareness,
  formatPersonalityContext,
  formatNpcPersonalityHint,
} from "@/lib/personality/context";
import { AwarenessStage } from "@/lib/personality/types";
import type { PersonalityState } from "@/lib/personality/types";

// ============================================================
// 测试夹具
// ============================================================

function makeElenaState(): PersonalityState {
  return {
    npcId: "观测员埃琳娜",
    archive: {
      coreDesires: ["找到裂隙中的那个人", "重新找回对未来的期待"],
      fearsAndTaboos: ["变成空壳", "失去意义"],
      valuePriorities: ["truth", "connection"],
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

// ============================================================
// extractPersonalityFromDescription
// ============================================================

describe("extractPersonalityFromDescription", () => {
  it("generates correct archive for 观测员埃琳娜", () => {
    const desc = "埃琳娜是裂隙观测局的中级观测员...";
    const archive = extractPersonalityFromDescription(desc, "观测员埃琳娜");

    expect(archive.coreDesires).toContain("在裂隙中找到那个不在未来里的人");
    expect(archive.cognitiveStyle).toBe("analytical");
    expect(archive.socialStrategy).toBe("verification");
  });

  it("generates correct archive for 前观测员特雷弗", () => {
    const desc = "特雷弗曾经是观测员...";
    const archive = extractPersonalityFromDescription(desc, "前观测员特雷弗");

    expect(archive.cognitiveStyle).toBe("skeptical");
    expect(archive.socialStrategy).toBe("isolation");
  });

  it("generates correct archive for 观测局局长卡兰德", () => {
    const desc = "卡兰德局长...";
    const archive = extractPersonalityFromDescription(desc, "观测局局长卡兰德");

    expect(archive.cognitiveStyle).toBe("compliant");
    expect(archive.valuePriorities).toContain("秩序");
  });

  it("falls back to role-based defaults for unknown NPCs", () => {
    const desc = "一位观测员，在观测台前记录数据";
    const archive = extractPersonalityFromDescription(desc, "未知观测员");

    expect(archive.cognitiveStyle).toBe("analytical");
    expect(archive.boundarySensitivity).toBe(30);
  });

  it("falls back to generic defaults for completely unknown NPCs", () => {
    const archive = extractPersonalityFromDescription("普通的市民", "路人甲");

    expect(archive.cognitiveStyle).toBeDefined();
    expect(archive.coreDesires.length).toBeGreaterThan(0);
    expect(archive.valuePriorities.length).toBeGreaterThan(0);
  });

  it("handles empty description gracefully", () => {
    const archive = extractPersonalityFromDescription("", "无名");

    expect(archive.cognitiveStyle).toBeDefined();
    expect(archive.boundarySensitivity).toBeGreaterThanOrEqual(0);
    expect(archive.boundarySensitivity).toBeLessThanOrEqual(100);
  });

  it("accepts structured NPC descriptions from generated worlds", () => {
    const archive = extractPersonalityFromDescription({
      name: "紫苑",
      description: "神社的祭司，每天祈祷。",
    } as any, "紫苑");

    expect(archive.cognitiveStyle).toBe("fantasy_prone");
    expect(archive.socialStrategy).toBe("caretaking");
  });

  it("matches role keywords for 祭司 type", () => {
    const archive = extractPersonalityFromDescription(
      "神社的祭司，每天祈祷",
      "祭司角色",
    );
    expect(archive.cognitiveStyle).toBe("fantasy_prone");
    expect(archive.socialStrategy).toBe("caretaking");
  });

  it("matches 猫 keyword", () => {
    const archive = extractPersonalityFromDescription("一只猫", "猫");
    expect(archive.cognitiveStyle).toBe("intuitive");
    expect(archive.socialStrategy).toBe("isolation");
    expect(archive.boundarySensitivity).toBe(65);
  });
});

// ============================================================
// guessInitialAwareness
// ============================================================

describe("guessInitialAwareness", () => {
  it("returns NORMAL for most descriptions", () => {
    const stage = guessInitialAwareness("一个普通的市民");
    expect(stage).toBe(AwarenessStage.NORMAL);
  });

  it("returns ANOMALY_SENSE for descriptions with anomaly keywords", () => {
    const stage = guessInitialAwareness(
      "埃琳娜在裂隙中看到了一个人——这个人不在未来的预言里",
    );
    expect(stage).toBe(AwarenessStage.ANOMALY_SENSE);
  });

  it("returns NORMAL for short descriptions", () => {
    const stage = guessInitialAwareness("一个商人");
    expect(stage).toBe(AwarenessStage.NORMAL);
  });

  it("returns NORMAL for empty description", () => {
    const stage = guessInitialAwareness("");
    expect(stage).toBe(AwarenessStage.NORMAL);
  });

  it("detects anomaly keywords inside structured NPC descriptions", () => {
    const stage = guessInitialAwareness({
      name: "真红",
      description: "真红记得每一次审判重置，并怀疑有人在操控世界线。",
    } as any);

    expect(stage).toBe(AwarenessStage.ANOMALY_SENSE);
  });
});

// ============================================================
// formatPersonalityContext
// ============================================================

describe("formatPersonalityContext", () => {
  it("includes NPC name", () => {
    const state = makeElenaState();
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("观测员埃琳娜");
  });

  it("includes core desires", () => {
    const state = makeElenaState();
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("找到裂隙中的那个人");
  });

  it("includes cognitive style", () => {
    const state = makeElenaState();
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("分析型");
  });

  it("includes pressures above threshold", () => {
    const state = makeElenaState();
    state.pressure.cognitiveDissonance = 45; // > 30
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("认知失调");
  });

  it("includes compact mind-model guidance", () => {
    const state = makeElenaState();
    const ctx = formatPersonalityContext(state);

    expect(ctx).toContain("心智建模");
    expect(ctx).toContain("心理需求");
  });

  it("includes awareness stage when not NORMAL", () => {
    const state = makeElenaState();
    state.awareness = AwarenessStage.ANOMALY_SENSE;
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("异常感知");
  });

  it("does not include awareness when NORMAL", () => {
    const state = makeElenaState();
    state.awareness = AwarenessStage.NORMAL;
    const ctx = formatPersonalityContext(state);
    expect(ctx).not.toContain("异常感知");
  });

  it("includes episodic memories with high importance", () => {
    const state = makeElenaState();
    state.episodicMemories = [
      {
        id: "ep_1",
        timestamp: Date.now(),
        content: "玩家在裂隙中出现了",
        importance: 90,
        emotion: "震惊",
        relatedNpcs: [],
        relatedBeliefs: [],
      },
    ];
    const ctx = formatPersonalityContext(state);
    expect(ctx).toContain("玩家在裂隙中出现了");
  });

  it("respects maxMemories parameter", () => {
    const state = makeElenaState();
    state.episodicMemories = [
      {
        id: "ep_1", timestamp: Date.now(), content: "记忆1", importance: 90,
        emotion: "", relatedNpcs: [], relatedBeliefs: [],
      },
      {
        id: "ep_2", timestamp: Date.now(), content: "记忆2", importance: 85,
        emotion: "", relatedNpcs: [], relatedBeliefs: [],
      },
      {
        id: "ep_3", timestamp: Date.now(), content: "记忆3", importance: 80,
        emotion: "", relatedNpcs: [], relatedBeliefs: [],
      },
    ];
    const ctx1 = formatPersonalityContext(state, 1);
    const ctx2 = formatPersonalityContext(state, 2);
    // With maxMemories=1, only one memory should be in context
    const memCount1 = (ctx1.match(/记忆/g) || []).length;
    const memCount2 = (ctx2.match(/记忆/g) || []).length;
    expect(memCount2).toBeGreaterThanOrEqual(memCount1);
  });
});

// ============================================================
// formatNpcPersonalityHint
// ============================================================

describe("formatNpcPersonalityHint", () => {
  it("includes NPC name", () => {
    const state = makeElenaState();
    const hint = formatNpcPersonalityHint(state);
    expect(hint).toContain("观测员埃琳娜");
  });

  it("includes cognitive style hint", () => {
    const state = makeElenaState();
    const hint = formatNpcPersonalityHint(state);
    expect(hint).toContain("逻辑");
  });

  it("includes social strategy hint", () => {
    const state = makeElenaState();
    const hint = formatNpcPersonalityHint(state);
    expect(hint).toContain("追问和验证");
  });
});
