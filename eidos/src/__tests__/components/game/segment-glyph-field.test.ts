// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SegmentGlyphField, buildSegmentGlyphModel } from "@/components/game/SegmentGlyphField";
import type { StorySegment } from "@/lib/ai/types";

afterEach(cleanup);

describe("SegmentGlyphField", () => {
  it("builds a slanted text field from the current segment text", () => {
    const segment: StorySegment = {
      type: "dialogue",
      speaker: "观测员埃琳娜",
      text: "这个日晷从来都不是指向北方。它指向的是还没有发生的事。",
    };

    const model = buildSegmentGlyphModel({
      currentSegment: segment,
      displayedText: "这个日晷从来都不是指向北方。",
      sceneName: "中央广场",
    });

    expect(model.label).toBe("观测员埃琳娜 / DIALOGUE");
    expect(model.mode).toBe("DIALOGUE");
    expect(model.primary).toBe("观测员埃琳娜");
    expect(model.excerpt).toContain("这个日晷");
    expect(model.excerpt).toBe("这个日晷从来都不是指向北方。");
    expect(model.marker).toBe("D");
  });

  it("can reduce dialogue text to an index label for the visual layout", () => {
    const segment: StorySegment = {
      type: "dialogue",
      speaker: "观测员埃琳娜",
      emotion: "thinking",
      text: "这个日晷从来都不是指向北方。它指向的是还没有发生的事。",
    };

    const model = buildSegmentGlyphModel({
      currentSegment: segment,
      displayedText: "这个日晷从来都不是指向北方。",
      sceneName: "中央广场",
      dialogueTextMode: "index",
    });

    expect(model.mode).toBe("DIALOGUE");
    expect(model.primary).toBe("观测员埃琳娜");
    expect(model.excerpt).toBe("EMOTION THINKING / SCENE 中央广场");
    expect(model.excerpt).not.toContain("日晷");
  });

  it("keeps full source text so available height decides truncation", () => {
    const extremelyLongText = "银曜石街道在清晨发亮，裂隙像一条没有尽头的蓝色伤口。路人都假装它只是天气造成的错觉，而钟楼下的每一盏灯都在记录还没有抵达的脚步声。人们低着头走过，没有人抬头看那道横贯天空的裂痕。它是被习惯了的，不是被遗忘的——卡尔知道这点，他走过这条街道已经一千次，每一次都数过钟楼的台阶，每一次都发现少了同一级。".repeat(2);
    const model = buildSegmentGlyphModel({
      currentSegment: {
        type: "narration",
        text: extremelyLongText,
      },
      displayedText: "",
      sceneName: "上城区中央大道",
    });

    expect(model.tone).toBe("narration");
    expect(model.primary).toBe("旁白");
    expect(model.marker).toBe("N");
    expect(model.excerpt).toBe(extremelyLongText);
  });

  it("renders the center diamond glyph layer", () => {
    render(React.createElement(SegmentGlyphField, {
      currentSegment: {
        type: "narration",
        text: "银曜石街道在清晨发亮，裂隙像一条没有尽头的蓝色伤口。",
      },
      displayedText: "",
      sceneName: "上城区中央大道",
    }));

    const region = screen.getByLabelText("当前段落字形场");
    expect(region.className).toContain("eidos-segment-glyph-field");
    expect(screen.getByText("NARRATION")).not.toBeNull();
    expect(screen.getByText("旁白")).not.toBeNull();
    expect(screen.queryByText("SCENE")).toBeNull();
    expect(screen.queryByText("TEXT")).toBeNull();
  });

  it("renders the glyph field for dialogue segments too", () => {
    render(React.createElement(SegmentGlyphField, {
      currentSegment: {
        type: "dialogue",
        speaker: "观测员埃琳娜",
        text: "这个日晷从来都不是指向北方。",
      },
      displayedText: "这个日晷从来都不是指向北方。",
      sceneName: "中央广场",
    }));

    // 对话和旁白都在中心的平行四边形块中独立展示
    const region = screen.getByLabelText("当前段落字形场");
    expect(region.className).toContain("eidos-segment-glyph-field");
    expect(region.className).toContain("is-dialogue");
    expect(screen.getByText("DIALOGUE")).not.toBeNull();
    expect(screen.getByText("观测员埃琳娜")).not.toBeNull();
  });
});
