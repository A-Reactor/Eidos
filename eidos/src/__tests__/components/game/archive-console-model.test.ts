import { describe, expect, it } from "vitest";

import { buildArchiveConsoleModel } from "@/components/game/archive-console-model";
import type { CausalProjection } from "@/lib/game/types";

const time = { day: 7, hour: 22, minute: 40 };

function projection(ripples: CausalProjection["rippleEffects"]): CausalProjection {
  return {
    actionDescription: "交出损坏的钥匙",
    generatedAt: time,
    rippleEffects: ripples,
  };
}

describe("buildArchiveConsoleModel", () => {
  it("summarizes world archive modules from existing game state", () => {
    const model = buildArchiveConsoleModel({
      activeQuestCount: 2,
      branchCount: 3,
      criticalFactCount: 4,
      discoveredClueCount: 5,
      encyclopediaCount: 8,
      inventoryCount: 6,
      npcCount: 2,
      totalClueCount: 9,
      worldLineNodeCount: 12,
      causalProjections: [
        projection([
          {
            id: "ripple-a",
            triggerAction: "钥匙被交出",
            projectedOutcome: "守门人改变立场",
            confidence: 0.61,
            estimatedTime: { day: 8, hour: 6, minute: 0 },
            involvedNpcs: ["守门人"],
            involvedScenes: ["old-harbor"],
            status: "pending",
            createdAt: 1,
            resolvedAt: null,
            resolutionNote: "",
          },
          {
            id: "ripple-b",
            triggerAction: "灰衣人目击",
            projectedOutcome: "旧港区提前封锁",
            confidence: 0.91,
            estimatedTime: { day: 8, hour: 9, minute: 0 },
            involvedNpcs: [],
            involvedScenes: ["clocktower"],
            status: "fulfilled",
            createdAt: 2,
            resolvedAt: time,
            resolutionNote: "已在钟楼被验证",
          },
        ]),
      ],
    });

    expect(model.stats.pendingRipples).toBe(1);
    expect(model.stats.avgConfidencePercent).toBe(76);
    expect(model.modules.map((module) => module.id)).toEqual([
      "status",
      "causal",
      "worldline",
      "relations",
      "intel",
      "gallery",
    ]);
    expect(model.modules.find((module) => module.id === "intel")?.count).toBe(17);
    expect(model.modules.find((module) => module.id === "worldline")?.count).toBe(12);
  });
});
