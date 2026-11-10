// ============================================================
// Eidos · 创造模式 Slice
// ============================================================

import type { CreativeModeConfig, GameMode } from "@/lib/game/types";
import { DEFAULT_CREATIVE_CONFIG } from "@/lib/game/types";
import {
  loadCreativeConfig,
  saveCreativeConfig,
} from "@/lib/game/creative-config";

export interface CreativeSlice {
  creativeConfig: CreativeModeConfig;
  setCreativeConfig: (partial: Partial<CreativeModeConfig>) => void;
  setGameMode: (mode: GameMode) => void;
  resetCreativeConfig: () => void;
  /** 进入创造模式：保存原档 → 创建副本 → 切换到创造模式 */
  enterCreativeMode: () => void;
  /** 退出创造模式：保存副本 → 加载原档 → 回到推理模式 */
  exitCreativeMode: () => void;
  showCreativePanel: boolean;
  setShowCreativePanel: (show: boolean) => void;
}

export const createCreativeSlice = (
  set: (
    partial:
      | Partial<Record<string, any>>
      | ((state: Record<string, any>) => Partial<Record<string, any>>)
  ) => void,
  get: () => any
): CreativeSlice => ({
  creativeConfig: loadCreativeConfig(),
  showCreativePanel: false,

  setCreativeConfig: (partial) => {
    const next = {
      ...get().creativeConfig,
      ...partial,
    } as CreativeModeConfig;
    saveCreativeConfig(next);
    set({ creativeConfig: next });
  },

  setGameMode: (mode) => {
    const next = {
      ...get().creativeConfig,
      gameMode: mode,
    } as CreativeModeConfig;
    saveCreativeConfig(next);
    set({ creativeConfig: next });
  },

  resetCreativeConfig: () => {
    saveCreativeConfig(DEFAULT_CREATIVE_CONFIG);
    set({ creativeConfig: { ...DEFAULT_CREATIVE_CONFIG } });
  },

  enterCreativeMode: async () => {
    const state = get();
    const worldName = state.currentWorld?.name || "世界";
    const backupId = state.saveGame
      ? await state.saveGame(`${worldName} · 进入创造模式前的存档`)
      : "";
    if (!backupId && state.autoSave) {
      await state.autoSave().catch(() => {});
    }
    // 切换到创造模式
    const next = {
      ...state.creativeConfig,
      gameMode: "creative" as GameMode,
      originalSaveId: backupId || null,
    };
    saveCreativeConfig(next);
    set({ creativeConfig: next });
  },

  exitCreativeMode: () => {
    const state = get();
    const cfg = state.creativeConfig as CreativeModeConfig;
    // 1. 自动保存创造模式的修改（fire-and-forget）
    if (state.autoSave) state.autoSave().catch(() => {});
    // 2. 回到推理模式（不加载原档——玩家在创造模式的修改保留）
    const next = {
      ...cfg,
      gameMode: "narrative" as GameMode,
      originalSaveId: null,
    };
    saveCreativeConfig(next);
    set({
      creativeConfig: next,
      showCreativePanel: false,
    });
  },

  setShowCreativePanel: (show) => set({ showCreativePanel: show }),
});
