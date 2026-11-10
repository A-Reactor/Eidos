import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_PRESETS,
  AI_QUALITY_PROFILES,
  getProviderPreset,
  getRoleModelForQuality,
} from "@/lib/ai/provider-presets";

describe("AI provider presets", () => {
  it("keeps DeepSeek as the default provider with role recommendations", () => {
    const preset = getProviderPreset("deepseek");

    expect(preset.id).toBe("deepseek");
    expect(preset.protocol).toBe("deepseek-native");
    expect(preset.defaultBaseUrl).toBe("https://api.deepseek.com/v1");
    expect(getRoleModelForQuality("deepseek", "alice", "balanced")).toBe("deepseek-v4-flash");
    expect(getRoleModelForQuality("deepseek", "kei", "balanced")).toBe("deepseek-v4-pro");
  });

  it("includes easy built-in choices plus custom compatible protocols", () => {
    expect(Object.keys(AI_PROVIDER_PRESETS).sort()).toEqual([
      "anthropic",
      "custom-anthropic-compatible",
      "custom-openai-compatible",
      "deepseek",
      "gemini",
      "lm-studio",
      "ollama",
      "openai",
      "openrouter",
    ]);
    expect(AI_PROVIDER_PRESETS["custom-openai-compatible"].protocol).toBe("openai-compatible");
    expect(AI_PROVIDER_PRESETS["custom-anthropic-compatible"].protocol).toBe("anthropic-compatible");
  });

  it("defines three quality profiles for simple mode", () => {
    expect(Object.keys(AI_QUALITY_PROFILES).sort()).toEqual(["balanced", "economy", "quality"]);
    expect(AI_QUALITY_PROFILES.economy.labelKey).toBe("settings.aiQualityEconomy");
    expect(AI_QUALITY_PROFILES.balanced.labelKey).toBe("settings.aiQualityBalanced");
    expect(AI_QUALITY_PROFILES.quality.labelKey).toBe("settings.aiQualityQuality");
  });

  it("falls back to provider default model if a role quality model is missing", () => {
    expect(getRoleModelForQuality("custom-openai-compatible", "uzq", "quality")).toBe("gpt-4o-mini");
  });
});
