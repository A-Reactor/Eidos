// ============================================================
// Eidos · 游戏阶段 Slice
// ============================================================

import { CREATIVE_MODE_ENABLED } from "@/lib/game/features";
import type { GamePhase } from "@/lib/game/types";
import { abortActiveStream, isPipelineBusy } from "@/lib/game/stream-lifecycle";
import { buildPlayerMap, findMapPath } from "@/lib/game/player-map";

export interface MapTravelRequest { worldId: string; from: string; to: string; path: string[]; }

/** 离开游戏（非子面板）的阶段——应该终止 SSE 流 */
const EXIT_PHASES: GamePhase[] = ["title", "world_select", "world_create"];

export interface PhaseSlice {
  phase: GamePhase;
  previousPhase: GamePhase;
  setPhase: (phase: GamePhase) => void;
  navigationStack: GamePhase[];
  goBack: () => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  mapTravelRequest: MapTravelRequest | null;
  requestMapTravel: (to: string) => boolean;
  takeMapTravelRequest: () => MapTravelRequest | null;
}

export const createPhaseSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): PhaseSlice => ({
  phase: "title",
  previousPhase: "title",
  navigationStack: [],
  mapTravelRequest: null,
  requestMapTravel: (to) => {
    const state = get();
    if (state.phase !== "map" || state.isLoading || isPipelineBusy() || state.mapTravelRequest) return false;
    const path = findMapPath(buildPlayerMap(state.currentWorld, state.currentSceneId, state.visitedScenes), state.currentSceneId, to);
    if (!path || path.length < 2 || path.length > 31) return false;
    const request = { worldId: state.currentWorld.id, from: state.currentSceneId, to, path };
    state.setPhase("playing");
    set({ mapTravelRequest: request });
    return true;
  },
  takeMapTravelRequest: () => {
    const request = get().mapTravelRequest;
    set({ mapTravelRequest: null });
    return request;
  },
  goBack: () => {
    // A pending identity is not a playable session, even when a world is loaded.
    if (get().phase === 'identity') { get().setPhase('world_select'); return; }
    const stack = [...(get().navigationStack ?? [])] as GamePhase[];
    const target = stack.pop() ?? (get().currentWorld ? "playing" : "title");
    get().setPhase(target);
    set({ navigationStack: stack });
  },

  setPhase: (phase) => {
    if (["intel_wall", "encyclopedia", "diary"].includes(phase)) phase = "reading";
    if (phase === "creative_settings" && !CREATIVE_MODE_ENABLED) phase = "settings";
    const prev = get().phase;
    if (prev === phase) return;
    const secondary: GamePhase[] = ["settings", "creative_settings", "gallery", "audio", "documents", "inventory", "encyclopedia", "intel_wall", "diary", "world_line_view", "reading", "map", "npc_dossiers"];
    const stack = [...(get().navigationStack ?? [])] as GamePhase[];
    // Secondary screens retain their actual entry point, including nested settings.
    if (secondary.includes(phase)) stack.push(prev);
    else stack.length = 0;

    // 离开游戏（非子面板）→ 终止 SSE 流，防止旧响应污染新游戏
    if (EXIT_PHASES.includes(phase)) {
      abortActiveStream();
    }

    // 进入世界线视图时先持久化数据（fire-and-forget）
    if (phase === "world_line_view") {
      get().persistWorldLineData?.()?.catch(() => {});
    }

    // 返回标题时存档 + 清理资源
    if (prev === "playing" && phase === "title") {
      get().autoSave?.()?.catch(() => {});

    }

    set({ phase, previousPhase: prev, navigationStack: stack, mapTravelRequest: null });
  },

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
});
