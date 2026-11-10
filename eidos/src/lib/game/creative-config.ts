// ============================================================
// Eidos · 创造模式配置（localStorage 持久化）
// ============================================================

import { CREATIVE_MODE_ENABLED } from "./features";
import { DEFAULT_CREATIVE_CONFIG, type CreativeModeConfig } from "./types";

const STORAGE_KEY = "eidos_creative_config";

export function loadCreativeConfig(): CreativeModeConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CREATIVE_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CREATIVE_CONFIG };
    const saved = JSON.parse(raw) as Record<string, any>;
    // 温度 clamp（0-2）
    if (typeof saved.aliceTemperature === "number") {
      saved.aliceTemperature = Math.max(0, Math.min(2, saved.aliceTemperature));
    }
    if (typeof saved.keiTemperature === "number") {
      saved.keiTemperature = Math.max(0, Math.min(2, saved.keiTemperature));
    }
    return { ...DEFAULT_CREATIVE_CONFIG, ...saved } as CreativeModeConfig;
  } catch {
    return { ...DEFAULT_CREATIVE_CONFIG };
  }
}

export function saveCreativeConfig(config: CreativeModeConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e: any) {
    console.warn("[CreativeConfig] save failed:", e?.message || e);
  }
}

export function isCreativeMode(): boolean {
  return CREATIVE_MODE_ENABLED && loadCreativeConfig().gameMode === "creative";
}
