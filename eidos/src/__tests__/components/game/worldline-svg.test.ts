import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  chooseNiceStep,
  getVisibleWorldRect,
} from "@/components/game/worldline/worldline-viewport";

describe("WorldlineSvg viewport model", () => {
  it("chooses graph-paper major ticks from viewport scale", () => {
    expect(chooseNiceStep(64, 92)).toBe(2);
    expect(chooseNiceStep(128, 92)).toBe(1);
  });

  it("derives visible world bounds from fixed paper viewport state", () => {
    expect(getVisibleWorldRect({
      plotRect: { x: 54, y: 30, width: 440, height: 300 },
      viewport: { scale: 40, origin: { x: 200, y: 80 } },
      bufferWorld: 1,
    })).toEqual({
      minX: -6,
      maxX: 7,
      minY: -3,
      maxY: 6.5,
    });
  });

  it("keeps expanded step labels guarded by scale and a tunable hitbox", () => {
    const source = readFileSync(join(process.cwd(), "src/components/game/worldline/WorldlineSvg.tsx"), "utf-8");

    expect(source).toContain("STEP_LABEL_MIN_SCALE");
    expect(source).toContain("STEP_LABEL_HITBOX_WIDTH_PX");
    expect(source).toContain("STEP_LABEL_HITBOX_HEIGHT_PX");
    expect(source).toContain("showStepLabels && semantic.stepLabels.map");
  });
});
