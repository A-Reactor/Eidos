// ============================================================
// Eidos · 创造模式配置持久化测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadCreativeConfig, saveCreativeConfig, isCreativeMode } from "@/lib/game/creative-config";
import { DEFAULT_CREATIVE_CONFIG } from "@/lib/game/types";

// Mock localStorage (test environment is Node)
const storage = new Map<string, string>();
vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  clear: vi.fn(() => storage.clear()),
});

beforeEach(() => {
  storage.clear();
});

describe("loadCreativeConfig", () => {
  it("returns defaults when localStorage is empty", () => {
    localStorage.clear();
    const cfg = loadCreativeConfig();
    expect(cfg).toEqual(DEFAULT_CREATIVE_CONFIG);
  });

  it("returns defaults when localStorage has corrupted JSON", () => {
    localStorage.setItem("eidos_creative_config", "not valid json{{{");
    const cfg = loadCreativeConfig();
    expect(cfg).toEqual(DEFAULT_CREATIVE_CONFIG);
  });

  it("loads saved config from localStorage", () => {
    const saved = { ...DEFAULT_CREATIVE_CONFIG, gameMode: "creative" as const, aliceTemperature: 1.2 };
    localStorage.setItem("eidos_creative_config", JSON.stringify(saved));
    const cfg = loadCreativeConfig();
    expect(cfg.gameMode).toBe("creative");
    expect(cfg.aliceTemperature).toBe(1.2);
  });

  it("clamps aliceTemperature to range 0-2", () => {
    localStorage.setItem("eidos_creative_config", JSON.stringify({ aliceTemperature: 5 }));
    expect(loadCreativeConfig().aliceTemperature).toBe(2);

    localStorage.setItem("eidos_creative_config", JSON.stringify({ aliceTemperature: -1 }));
    expect(loadCreativeConfig().aliceTemperature).toBe(0);
  });

  it("clamps keiTemperature to range 0-2", () => {
    localStorage.setItem("eidos_creative_config", JSON.stringify({ keiTemperature: 3 }));
    expect(loadCreativeConfig().keiTemperature).toBe(2);

    localStorage.setItem("eidos_creative_config", JSON.stringify({ keiTemperature: -0.5 }));
    expect(loadCreativeConfig().keiTemperature).toBe(0);
  });

  it("fills missing fields from defaults", () => {
    localStorage.setItem("eidos_creative_config", JSON.stringify({ gameMode: "creative" }));
    const cfg = loadCreativeConfig();
    expect(cfg.gameMode).toBe("creative");
    expect(cfg.aliceExpectations).toBe(DEFAULT_CREATIVE_CONFIG.aliceExpectations);
    expect(cfg.keiExpectations).toBe(DEFAULT_CREATIVE_CONFIG.keiExpectations);
  });
});

describe("saveCreativeConfig", () => {
  it("saves config to localStorage", () => {
    const cfg = { ...DEFAULT_CREATIVE_CONFIG, gameMode: "creative" as const, aliceExpectations: "test" };
    saveCreativeConfig(cfg);
    const raw = localStorage.getItem("eidos_creative_config");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.gameMode).toBe("creative");
    expect(parsed.aliceExpectations).toBe("test");
  });
});

describe("isCreativeMode", () => {
  it("returns false when mode is narrative", () => {
    localStorage.setItem("eidos_creative_config", JSON.stringify({ ...DEFAULT_CREATIVE_CONFIG, gameMode: "narrative" }));
    expect(isCreativeMode()).toBe(false);
  });

  it("keeps legacy creative settings but does not activate the suspended mode", () => {
    localStorage.setItem("eidos_creative_config", JSON.stringify({ ...DEFAULT_CREATIVE_CONFIG, gameMode: "creative" }));
    expect(isCreativeMode()).toBe(false);
    expect(loadCreativeConfig().gameMode).toBe("creative");
  });
});
