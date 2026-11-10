import { describe, expect, it } from "vitest";

import {
  buildStepRulerMarkers,
  resolveCenterExpandWindow,
} from "@/components/game/worldline/worldline-interactions";
import { computeWorldlineGeometry } from "@/lib/game/worldline-geometry";
import type { WorldLineNode } from "@/lib/game/types";

function node(stepNumber: number): WorldLineNode {
  return {
    id: `n-${stepNumber}`,
    parentId: stepNumber === 0 ? null : `n-${stepNumber - 1}`,
    stepNumber,
    playerInput: "",
    aiResponse: "",
    summary: "",
    snapshotHash: "",
    segmentHash: "",
    childIds: stepNumber < 30 ? [`n-${stepNumber + 1}`] : [],
    createdAt: stepNumber,
    gameTime: { day: 0, hour: 0, minute: stepNumber },
    sceneId: "scene",
    sceneName: "Scene",
    dayNumber: 0,
    timeSpent: { day: 0, hour: 0, minute: 1 },
    worldImpacts: [],
    generationComplete: true,
  };
}

describe("worldline interactions", () => {
  it("moves the active expand window to the screen-centered step on the same day", () => {
    expect(resolveCenterExpandWindow({ day: 2, centerStep: 10 }, 2, 13)).toEqual({
      day: 2,
      centerStep: 13,
    });
  });

  it("ignores center updates when no matching day is expanded", () => {
    expect(resolveCenterExpandWindow(null, 2, 13)).toBeNull();
    expect(resolveCenterExpandWindow({ day: 1, centerStep: 10 }, 2, 13)).toEqual({
      day: 1,
      centerStep: 10,
    });
    expect(resolveCenterExpandWindow({ day: 2, centerStep: 10 }, 2, 11)).toEqual({
      day: 2,
      centerStep: 10,
    });
  });

  it("exposes only seven steps above and below the hovered center", () => {
    const allNodes = Object.fromEntries(Array.from({ length: 31 }, (_, step) => {
      const entry = node(step);
      return [entry.id, entry];
    }));

    const geometry = computeWorldlineGeometry(allNodes, "n-0", "n-30", null, {
      day: 0,
      centerStep: 10,
    });

    expect(geometry.stepLabels.map((label) => label.stepNumber)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
      10,
      11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  it("labels ruler ticks with the greatest rendered step at or above that y coordinate", () => {
    const markers = buildStepRulerMarkers({
      expandedDay: 0,
      minGapPx: 13,
      tickYs: [100, 126, 152],
      bars: Array.from({ length: 15 }, (_, index) => ({
        dayNumber: 0,
        stepNumber: index + 5,
        nodeId: `n-${index + 5}`,
        y: 100 + index * 7,
      })),
    });

    expect(markers.map((marker) => marker.stepNumber)).toEqual([
      5, 8, 12,
    ]);
  });
});
