import { describe, expect, it } from "vitest";

import {
  buildInterruptMetadata,
  shouldInterruptNarrative,
  isBeforeReadBoundary,
} from "@/components/game/pipeline-early-stop";

describe("pipeline early stop helpers", () => {
  it('allows new decisions at the furthest visited segment but prevents moving a decision behind already read prose', () => {
    expect(isBeforeReadBoundary(1, 3, '旧段落')).toBe(true);
    expect(isBeforeReadBoundary(3, 3, '正文')).toBe(false);
    expect(isBeforeReadBoundary(1, 1, '旧段落', '旧段落，后面已经读过')).toBe(true);
    expect(isBeforeReadBoundary(1, 1, '旧段落，正在读', '旧段落')).toBe(false);
  });
  it("detects player input while a generated narrative is mid-read", () => {
    expect(shouldInterruptNarrative({
      isShowingSegments: true,
      segmentIndex: 2,
      segmentsLength: 8,
    })).toBe(true);

    expect(shouldInterruptNarrative({
      isShowingSegments: true,
      segmentIndex: 7,
      segmentsLength: 8,
    })).toBe(false);

    expect(shouldInterruptNarrative({
      isShowingSegments: true,
      segmentIndex: 8,
      segmentsLength: 8,
    })).toBe(false);

    expect(shouldInterruptNarrative({
      isShowingSegments: false,
      segmentIndex: 0,
      segmentsLength: 8,
    })).toBe(false);
  });

  it("builds worldline metadata for an interrupted generation", () => {
    expect(buildInterruptMetadata({ segmentIndex: 3, segmentsLength: 8 })).toEqual({
      generationComplete: false,
      interruptedAtSegment: 3,
      totalSegmentsGenerated: 8,
    });
  });
});
