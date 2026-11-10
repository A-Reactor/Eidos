import { registerDocumentProjection } from '@/lib/game/documents/repository';
import { currentDocumentScope, documentScopeKey } from '@/lib/game/model-documents';
// ============================================================
// Eidos · 游戏状态管理 (Zustand) — 组合式 Slice
// ============================================================

import { create } from "zustand";
import { createPhaseSlice, type PhaseSlice } from "./slices/phase-slice";
import { createWorldSlice, type WorldSlice } from "./slices/world-slice";
import { createPlayerSlice, type PlayerSlice } from "./slices/player-slice";
import { createSaveSlice, type SaveSlice } from "./slices/save-slice";
import { createMidoriSlice, type MidoriSlice } from "./slices/midori-slice";
import { createMomoiSlice, type MomoiSlice } from "./slices/momoi-slice";
import { createTokenSlice, type TokenSlice } from "./slices/token-slice";
import { createCreativeSlice, type CreativeSlice } from "./slices/creative-slice";
import { createTelemetrySlice, type TelemetrySlice } from "./slices/telemetry-slice";
import { createWorldLineSlice, type WorldLineSlice } from "./slices/worldline-slice";
import { createQualitySlice, type QualitySlice } from "./slices/quality-slice";
import { createPersonalitySlice, type PersonalitySlice } from "./slices/personality-slice";
import { createSandboxSlice, type SandboxSlice } from "./slices/sandbox-slice";
import { createMetaRealitySlice, type MetaRealitySlice } from "./slices/meta-reality-slice";
import { createReaderSlice,type ReaderSlice } from './slices/reader-slice';

export type GameStore = PhaseSlice &
  WorldSlice &
  PlayerSlice &
  SaveSlice &
  WorldLineSlice &
  MidoriSlice &
  MomoiSlice &
  TokenSlice &
  CreativeSlice &
  TelemetrySlice &
  QualitySlice &
  PersonalitySlice &
  SandboxSlice &
  MetaRealitySlice & ReaderSlice;

export const useGameStore = create<GameStore>()((set, get, store) => ({
  ...createPhaseSlice(set, get, store),
  ...createWorldSlice(set, get, store),
  ...createPlayerSlice(set, get, store),
  ...createSaveSlice(set, get, store),
  ...createWorldLineSlice(set, get),
  ...createMidoriSlice(set, get, store),
  ...createMomoiSlice(set, get, store),
  ...createTokenSlice(set, get, store),
  ...createCreativeSlice(set, get),
  ...createTelemetrySlice(set, get, store),
  ...createQualitySlice(set, get, store),
  ...createPersonalitySlice(set, get, store),
  ...createSandboxSlice(set, get),
  ...createMetaRealitySlice(set, get),
  ...createReaderSlice(set,get),
}));

// ============================================================
// 重新导出持久化辅助
// ============================================================
export {
  saveToLocalStorage,
  loadPlayerWorlds,
  savePlayerWorlds,
  loadPlayerWorldsAsync,
  savePlayerWorldsAsync,
  saveIdentityOptions,
  loadIdentityOptions,
  filterSavesByWorld,
  filterSavesByPlaythrough,
  filterPlaythroughsByWorld,
  renameWorldData,
  META_WORLDS_KEY,
  META_PLAYTHROUGHS_KEY,
  META_SAVES_KEY,
} from "./slices/save-slice";

registerDocumentProjection({
  read(scope) { const state = useGameStore.getState(), active = currentDocumentScope(state); return active && documentScopeKey(active) === documentScopeKey(scope) ? state.documentHeads : undefined; },
  write(scope, ref) { const state = useGameStore.getState(), active = currentDocumentScope(state); if (active && documentScopeKey(active) === documentScopeKey(scope)) useGameStore.setState({ documentHeads: [...state.documentHeads.filter(old => old.documentId !== ref.documentId), ref] }); },
});
