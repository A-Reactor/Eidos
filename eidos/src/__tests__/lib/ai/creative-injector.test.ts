// ============================================================
// Eidos · 创造模式 Prompt 注入工具测试
// ============================================================

import { describe, it, expect } from "vitest";
import { resolveAliceTemperature, resolveKeiTemperature, buildAlicePromptAdditions, buildKeiPromptAdditions } from "@/lib/ai/creative-injector";
import type { CreativeModeConfig } from "@/lib/game/types";
import { DEFAULT_CREATIVE_CONFIG } from "@/lib/game/types";

function makeCfg(overrides: Partial<CreativeModeConfig> = {}): CreativeModeConfig {
  return { ...DEFAULT_CREATIVE_CONFIG, ...overrides };
}

describe("resolveAliceTemperature", () => {
  it("returns default temperature when config is null", () => {
    expect(resolveAliceTemperature(null, 0.85)).toBe(0.85);
  });

  it("returns default temperature when config is undefined", () => {
    expect(resolveAliceTemperature(undefined, 0.85)).toBe(0.85);
  });

  it("returns default temperature when mode is narrative", () => {
    expect(resolveAliceTemperature(makeCfg({ gameMode: "narrative", aliceTemperature: 1.5 }), 0.85)).toBe(0.85);
  });

  it("ignores retained creative temperatures while the mode is suspended", () => {
    expect(resolveAliceTemperature(makeCfg({ gameMode: "creative", aliceTemperature: 1.2 }), 0.85)).toBe(0.85);
  });
});

describe("resolveKeiTemperature", () => {
  it("returns default temperature when config is null", () => {
    expect(resolveKeiTemperature(null, 0.3)).toBe(0.3);
  });

  it("returns default temperature when mode is narrative", () => {
    expect(resolveKeiTemperature(makeCfg({ gameMode: "narrative", keiTemperature: 0.8 }), 0.3)).toBe(0.3);
  });

  it("ignores retained creative temperatures while the mode is suspended", () => {
    expect(resolveKeiTemperature(makeCfg({ gameMode: "creative", keiTemperature: 0.5 }), 0.3)).toBe(0.3);
  });
});

describe("buildAlicePromptAdditions", () => {
  it("returns empty string when config is null", () => {
    expect(buildAlicePromptAdditions(null)).toBe("");
  });

  it("returns empty string when config is undefined", () => {
    expect(buildAlicePromptAdditions(undefined)).toBe("");
  });

  it("returns empty string when mode is narrative", () => {
    expect(buildAlicePromptAdditions(makeCfg({ gameMode: "narrative", aliceExpectations: "test" }))).toBe("");
  });

  it("returns empty string when mode is creative but expectations is empty", () => {
    expect(buildAlicePromptAdditions(makeCfg({ gameMode: "creative", aliceExpectations: "" }))).toBe("");
  });

  it("returns empty string when mode is creative but expectations is whitespace only", () => {
    expect(buildAlicePromptAdditions(makeCfg({ gameMode: "creative", aliceExpectations: "   " }))).toBe("");
  });

  it("ignores retained creative expectations while the mode is suspended", () => {
    const result = buildAlicePromptAdditions(makeCfg({
      gameMode: "creative",
      aliceExpectations: "偏好细腻的心理描写",
    }));
    expect(result).toBe("");
  });

  it("does not inject runtime meta reality context through creative expectations", () => {
    const result = buildAlicePromptAdditions({
      ...makeCfg({
        gameMode: "creative",
      }),
      // Runtime boundary context travels through ProcessActionOptions, not CreativeModeConfig.
      // Keep this assertion so OneShot-like interactions do not become creative-mode-only again.
      metaRealityContext: "## 现实边界材料\n- sea.png：一张来自边界外的海面图像。",
    } as CreativeModeConfig & { metaRealityContext: string });

    expect(result).not.toContain("sea.png");
  });

  it("does not inject meta reality context in narrative mode", () => {
    const result = buildAlicePromptAdditions({
      ...makeCfg({
        gameMode: "narrative",
      }),
      metaRealityContext: "## 现实边界材料\n- sea.png：一张来自边界外的海面图像。",
    } as CreativeModeConfig & { metaRealityContext: string });

    expect(result).not.toContain("sea.png");
  });

  it("returns empty string for creative mode when only runtime context is present", () => {
    const result = buildAlicePromptAdditions({
      ...makeCfg({
      gameMode: "creative",
      }),
      metaRealityContext: "## 现实边界材料\n- sea.png：一张来自边界外的海面图像。",
    } as CreativeModeConfig & { metaRealityContext: string });

    expect(result).toBe("");
  });
});

describe("buildKeiPromptAdditions", () => {
  it("returns empty string when config is null", () => {
    expect(buildKeiPromptAdditions(null)).toBe("");
  });

  it("returns empty string when mode is narrative", () => {
    expect(buildKeiPromptAdditions(makeCfg({ gameMode: "narrative", keiExpectations: "test" }))).toBe("");
  });

  it("returns empty string when mode is creative but expectations is empty", () => {
    expect(buildKeiPromptAdditions(makeCfg({ gameMode: "creative", keiExpectations: "" }))).toBe("");
  });

  it("ignores retained creative expectations while the mode is suspended", () => {
    const result = buildKeiPromptAdditions(makeCfg({
      gameMode: "creative",
      keiExpectations: "放宽编造检查",
    }));
    expect(result).toBe("");
  });

  it("does not inject runtime meta reality context into KEI creative additions", () => {
    const result = buildKeiPromptAdditions({
      ...makeCfg({
      gameMode: "creative",
      }),
      metaRealityContext: "## 现实边界材料\n- letter.txt：外部信件。",
    } as CreativeModeConfig & { metaRealityContext: string });

    expect(result).not.toContain("letter.txt");
  });
});
