import { describe, expect, it } from "vitest";

import {
  NARRATIVE_STYLE_PRESETS,
  buildNarrativeStyleProfile,
  formatNarrativeStyleForAlice,
  formatNarrativeStyleForKei,
} from "@/lib/game/narrative-style";

describe("narrative style profiles", () => {
  it("ships player-facing presets with usable original examples", () => {
    expect(NARRATIVE_STYLE_PRESETS.length).toBeGreaterThanOrEqual(5);

    for (const preset of NARRATIVE_STYLE_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.example.length).toBeGreaterThanOrEqual(200);
      expect(preset.example.length).toBeLessThanOrEqual(600);
      expect(preset.aliceGuidance.length).toBeGreaterThan(40);
      expect(preset.keiGuidance.length).toBeGreaterThan(20);
    }
  });

  it("builds a compact profile without copying the example into runtime guidance", () => {
    const profile = buildNarrativeStyleProfile("realist", "多写市井、人情和制度压力，不要文绉绉。");

    expect(profile.id).toBe("realist");
    expect(profile.customDescription).toContain("制度压力");

    const alice = formatNarrativeStyleForAlice(profile);
    expect(alice).toContain("现实主义");
    expect(alice).toContain("制度压力");
    expect(alice).toContain("不要复写示例");
    expect(alice).not.toContain(profile.example.slice(0, 40));

    const kei = formatNarrativeStyleForKei(profile);
    expect(kei).toContain("低权重参考");
    expect(kei).toContain("世界结构");
    expect(kei).not.toContain(profile.example.slice(0, 40));
  });

  it("includes generalized anime-game and curiosity-exploration style presets without copyrighted labels", () => {
    const labels = NARRATIVE_STYLE_PRESETS.map((preset) => preset.label);

    expect(labels).toContain("轻快群像日常");
    expect(labels).toContain("清透感抒情");
    expect(labels).toContain("知识考古探索");
    expect(labels.join(" ")).not.toMatch(/蔚蓝档案|ATRI|Outer Wilds/i);

    const ensemble = buildNarrativeStyleProfile("school_ensemble");
    const lyrical = buildNarrativeStyleProfile("summer_sci_fi");
    const animeInspiredText = [
      ensemble.label,
      ensemble.summary,
      ensemble.aliceGuidance,
      ensemble.keiGuidance,
      ensemble.example,
      lyrical.label,
      lyrical.summary,
      lyrical.aliceGuidance,
      lyrical.keiGuidance,
      lyrical.example,
    ].join("\n");
    expect(animeInspiredText).not.toMatch(/学院|社团|老师学生|海边|海水|机器人|发电机|旧设施|夏日|夏天/);
    expect(animeInspiredText).toContain("对话接力");
    expect(animeInspiredText).toContain("留白");

    const archaeology = buildNarrativeStyleProfile("curiosity_archaeology");
    const alice = formatNarrativeStyleForAlice(archaeology);
    expect(alice).toContain("碎片记录");
    expect(alice).toContain("不要直接解释谜底");
  });
});
