// ============================================================
// 人格推演引擎 — 异常检测测试
// ============================================================

import { describe, it, expect } from "vitest";
import { detectAnomalies } from "@/lib/personality/anomaly";
import type { AnomalyDetectionInput } from "@/lib/personality/anomaly";
import type { WorldLineSummary } from "@/lib/ai/context-builder";

// ============================================================
// 测试夹具
// ============================================================

function makeWorldLineSummary(overrides: Partial<WorldLineSummary> = {}): WorldLineSummary {
  return {
    currentNodeId: "wl_test",
    stepNumber: 5,
    depth: 5,
    branchCount: 1,
    backtrackableNodes: [],
    siblingBranches: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<AnomalyDetectionInput> = {}): AnomalyDetectionInput {
  return {
    playerInput: "玩家向埃琳娜问好",
    episodicMemories: [],
    now: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe("detectAnomalies", () => {
  it("returns empty for normal player input", () => {
    const input = makeInput({ playerInput: "你好，最近还好吗？" });
    const anomalies = detectAnomalies(input);
    expect(anomalies.length).toBe(0);
  });

  it("detects deja vu from WorldLine sibling branches", () => {
    const input = makeInput({
      worldLineSummary: makeWorldLineSummary({
        siblingBranches: [
          { id: "wl_branch_1", summary: "选择了帮助管家" },
          { id: "wl_branch_2", summary: "选择了观察管家" },
        ],
      }),
    });

    const anomalies = detectAnomalies(input);
    const dejaVu = anomalies.find((a) => a.anomalyType === "deja_vu");
    expect(dejaVu).toBeDefined();
    expect(dejaVu!.significance).toBeGreaterThanOrEqual(40);
  });

  it("detects timeline jump on world line backtrack", () => {
    const input = makeInput({
      isWorldLineBacktrack: true,
    });

    const anomalies = detectAnomalies(input);
    const jump = anomalies.find((a) => a.anomalyType === "timeline_jump");
    expect(jump).toBeDefined();
    expect(jump!.significance).toBe(60);
  });

  it("detects metagaming in player input", () => {
    const input = makeInput({
      playerInput: "我要读档回到之前的状态",
    });

    const anomalies = detectAnomalies(input);
    const meta = anomalies.find((a) => a.anomalyType === "player_knows_too_much");
    expect(meta).toBeDefined();
  });

  it("detects 存档 keyword as metagaming", () => {
    const input = makeInput({
      playerInput: "这个存档能不能删掉？",
    });

    const anomalies = detectAnomalies(input);
    const meta = anomalies.find((a) => a.anomalyType === "player_knows_too_much");
    expect(meta).toBeDefined();
  });

  it("detects 游戏 keyword as metagaming", () => {
    const input = makeInput({
      playerInput: "我感觉这个游戏有人在操控",
    });

    const anomalies = detectAnomalies(input);
    const meta = anomalies.find((a) => a.anomalyType === "player_knows_too_much");
    expect(meta).toBeDefined();
  });

  it("does not flag normal vocabulary as metagaming", () => {
    const input = makeInput({
      playerInput: "我想重新考虑一下这个问题",
    });

    const anomalies = detectAnomalies(input);
    const meta = anomalies.find((a) => a.anomalyType === "player_knows_too_much");
    expect(meta).toBeUndefined();
  });

  it("detects memory gap from inconsistent timestamps", () => {
    const now = Date.now();
    const input = makeInput({
      episodicMemories: [
        { id: "e1", content: "最近的事", timestamp: now },
        { id: "e2", content: "更近的事", timestamp: now + 1000 },
        { id: "e3", content: "但这条时间更早", timestamp: now - 5000 },
      ],
    });

    const anomalies = detectAnomalies(input);
    const gap = anomalies.find((a) => a.anomalyType === "memory_gap");
    expect(gap).toBeDefined();
  });

  it("does not detect memory gap with normal timestamps", () => {
    const now = Date.now();
    const input = makeInput({
      episodicMemories: [
        { id: "e1", content: "第一件事", timestamp: now },
        { id: "e2", content: "第二件事", timestamp: now + 1000 },
        { id: "e3", content: "第三件事", timestamp: now + 2000 },
      ],
    });

    const anomalies = detectAnomalies(input);
    const gap = anomalies.find((a) => a.anomalyType === "memory_gap");
    expect(gap).toBeUndefined();
  });

  it("all anomalies start unexplained", () => {
    const input = makeInput({
      playerInput: "存档",
      isWorldLineBacktrack: true,
      worldLineSummary: makeWorldLineSummary({
        siblingBranches: [{ id: "b1", summary: "..." }],
      }),
    });

    const anomalies = detectAnomalies(input);
    expect(anomalies.length).toBeGreaterThan(0);
    for (const a of anomalies) {
      expect(a.explainedAway).toBe(false);
    }
  });

  it("respects explicit metagaming flag", () => {
    const input = makeInput({
      playerInput: "普通文本",
      playerInputIsMetagaming: true,
    });

    const anomalies = detectAnomalies(input);
    const meta = anomalies.find((a) => a.anomalyType === "player_knows_too_much");
    expect(meta).toBeDefined();
  });
});
