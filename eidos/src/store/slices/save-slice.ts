import { withoutLegacyProgress } from '@/lib/game/legacy-progress';
import { parseChapterState } from '@/lib/game/chapters/validation';
import { reconcileAcceptedDocuments } from '@/lib/game/documents/repository';
import { parseReadingView } from '@/lib/game/reader-session';
import { parsePlaybackPosition, restoreNodePlayback, type PlaybackPosition } from '@/lib/game/playback-resume';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { mergePluginArchives, worldAtPluginSet } from '@/lib/game/plugins/package-history';
import { parseNarrativeBeat } from '@/lib/game/narrative-beat';
import { parseEntryContext } from '@/lib/game/world-entry';
import { parseRewindMemory } from '@/lib/game/rewind';
import { AutosaveCoordinator, AUTOSAVE_STATE_KEYS } from '@/lib/game/autosave-coordinator';
import { loadWorldAssetRegistry, hydrateWorldAssetLibrary } from '@/lib/game/midori/asset-library';
import { loadSettings } from '@/lib/game/settings';
import { isPipelineBusy } from '@/lib/game/stream-lifecycle';
import { normalizeGameplayResources } from '@/lib/game/plugins/resources';
import { normalizeGameplayModState } from '@/lib/game/plugins/mod-ui';
import { emptyMapState } from "@/lib/game/map-state";
import { clearVoiceResources } from "@/lib/game/momoi/resource-storage";
import { normalizeVoiceConfig, normalizeVoiceAssets } from "@/lib/game/momoi/model";
// ============================================================
// Eidos · 存档系统 Slice (V2 — World → Playthrough → Save)
// ============================================================
// 存储架构:
//   IndexedDB save_data   — 存档数据 (GameSave, 大体积)
//   IndexedDB meta_data   — 索引 (世界列表/周目列表/存档索引, 小体积)
//   localStorage          — 仅版本标记
// ============================================================

import type {
  ActionRecord,
  CriticalFactEntry,
  GameSave,
  GameTime,
  KnowledgeItem,
  PlaythroughMeta,
  SaveSlot,
  Scene,
  SerializedGameState,
  Weather,
  WorldDefinition,
  IdentityOption,
} from "@/lib/game/types";
import { DEFAULT_MIDORI_SETTINGS, type MidoriSettings } from "@/lib/game/midori/types";
import { normalizeMidoriAssetRegistry } from "@/lib/game/midori/asset-registry";
import type { StorySegment } from "@/lib/ai/types";
import {
  scopeStorageKey,
  writeCurrentSaveToSession,
  type ArchiveScopeSource,
} from "@/lib/game/archive-scope";
import { getSceneById } from "@/lib/game/scene-utils";
import { resetSegmentHashes } from "@/lib/ai/context-builder";
import {
  saveToDB,
  loadFromDB,
  removeFromDB,
  saveMeta,
  loadMeta,
  removeMeta,
  autoSaveDataKey,
} from "@/lib/game/storage";
import {
  buildNpcMemoryState,
  mergeNpcMemoryIntoEncyclopedia,
  projectNpcMemoryState,
  splitNpcKnowledgeFromEncyclopedia,
} from "@/lib/game/npc-memory-save";

// ============================================================
// 常量
// ============================================================

/** IndexedDB meta_data store 键 */
export const META_WORLDS_KEY = "worlds_index";
export const META_PLAYTHROUGHS_KEY = "playthrough_index";
export const META_SAVES_KEY = "save_index";

/** 存档身份选项的 localStorage 键（过渡期，后续迁入 IndexedDB） */
const IDENTITY_PREFIX = "eidos_identity_";

function scopedKey(state: ArchiveScopeSource, key: string): string {
  return scopeStorageKey(state, key);
}

// ============================================================
// 辅助函数
// ============================================================

/** 保存到 localStorage 的通用函数（仅用于 identity 等小型数据） */
export function saveToLocalStorage(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // 静默
  }
}

export function hasPlayableIdentityState(state: {
  playerName?: string | null;
  currentSceneId?: string | null;
  currentScene?: { id?: string | null } | null;
}): boolean {
  const playerName = state.playerName?.trim();
  const sceneId = state.currentSceneId?.trim();
  if (!playerName || !sceneId || !state.currentScene) return false;
  if (state.currentScene.id && state.currentScene.id !== sceneId) return false;
  return true;
}

export function isLoadableGameSave(
  save: Pick<GameSave, "state" | "world"> | null | undefined,
): save is Pick<GameSave, "state" | "world"> {
  if (!save?.state || !save.world) return false;

  const playerName = save.state.playerName?.trim();
  const sceneId = save.state.currentSceneId?.trim();
  if (!playerName || !sceneId) return false;

  return !!getSceneById(save.world, sceneId);
}

export function buildPreviousAutoSaveMeta(
  previousSave: GameSave | null | undefined,
  playthroughId: string,
): SaveSlot | null {
  if (!isLoadableGameSave(previousSave)) return null;

  return {
    ...previousSave.meta,
    id: `autosave_prev_${playthroughId}`,
    name: `[上一步存档] ${previousSave.world.name} · ${previousSave.state.playerName || previousSave.meta.playerName}`,
    worldId: previousSave.world.id,
    worldName: previousSave.world.name,
    playthroughId,
    playerName: previousSave.state.playerName || previousSave.meta.playerName,
    type: "autosave_prev",
  };
}

// ============================================================
// 身份选项持久化（过渡期用 localStorage）
// ============================================================

function identityStorageKey(worldId: string, scope?: ArchiveScopeSource): string {
  return scopeStorageKey(scope ?? {}, `${IDENTITY_PREFIX}${worldId}`);
}

export function saveIdentityOptions(
  worldId: string,
  options: IdentityOption[],
  scope?: ArchiveScopeSource,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(identityStorageKey(worldId, scope), JSON.stringify(options));
  } catch {}
}

export function loadIdentityOptions(
  worldId: string,
  scope?: ArchiveScopeSource,
): IdentityOption[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(identityStorageKey(worldId, scope));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ============================================================
// 世界列表持久化
// ============================================================

export async function loadPlayerWorldsAsync(): Promise<WorldDefinition[]> {
  const worlds = await loadMeta<WorldDefinition[]>(META_WORLDS_KEY);
  return (worlds ?? []).map(withoutLegacyProgress);
}

/** 同步版：从缓存读取（用于 UI 快速渲染） */
export function loadPlayerWorlds(): WorldDefinition[] {
  // 同步回退到 localStorage（过渡期）
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("eidos_player_worlds");
    if (raw) return (JSON.parse(raw) as WorldDefinition[]).map(withoutLegacyProgress);
  } catch {}
  return [];
}

export async function savePlayerWorldsAsync(worlds: WorldDefinition[]): Promise<void> {
  worlds = worlds.map(withoutLegacyProgress);
  await saveMeta(META_WORLDS_KEY, worlds);
  // 过渡期同步到 localStorage
  saveToLocalStorage("eidos_player_worlds", worlds);
}

/** 同步保存世界列表（过渡期） */
export function savePlayerWorlds(worlds: WorldDefinition[]): void {
  worlds = worlds.map(withoutLegacyProgress);
  saveToLocalStorage("eidos_player_worlds", worlds);
  // 异步同步到 IndexedDB（fire-and-forget）
  saveMeta(META_WORLDS_KEY, worlds).catch(() => {});
}

// ============================================================
// SaveSlice 接口
// ============================================================

export interface SaveSlice {
  playbackPosition: PlaybackPosition | null;
  // 分段状态暂存
  savedSegments: StorySegment[];
  savedSegmentIndex: number;
  savedIsShowingSegments: boolean;
  saveSegmentState: (segments: StorySegment[], index: number, showing: boolean) => void;

  // 输入暂存
  pendingInput: string;
  setPendingInput: (text: string) => void;

  // 加载标记
  justLoadedSave: boolean;
  clearLoadedSaveFlag: () => void;

  // 行动历史
  history: ActionRecord[];
  addToHistory: (record: ActionRecord) => void;


  // === V2: 周目管理 ===
  currentPlaythroughId: string | null;
  cachedSaveSlots: SaveSlot[];
  cachedPlaythroughs: PlaythroughMeta[];

  /** 创建新周目，返回 playthroughId */
  createPlaythrough: (worldId: string, playerName?: string) => Promise<string>;
  /** 列出世界的所有周目 */
  listPlaythroughsForWorld: (worldId: string) => PlaythroughMeta[];
  /** 列出周目的所有存档 */
  listSavesForPlaythrough: (playthroughId: string) => SaveSlot[];
  /** 删除周目（级联删除所有子存档） */
  deletePlaythrough: (playthroughId: string) => Promise<void>;
  /** 重命名周目 */
  renamePlaythrough: (playthroughId: string, newName: string) => Promise<void>;
  /** 重命名存档 */
  renameSave: (saveId: string, newName: string) => Promise<void>;
  /** 标记周目已结束 */
  /** 更新周目元数据（每次行动后调用） */
  updatePlaythroughMeta: (updates: Partial<PlaythroughMeta>) => Promise<void>;

  // === V2: 存档管理 ===
  getSaveSlots: () => SaveSlot[];
  saveGame: (name?: string, overwriteSaveId?: string) => Promise<string>;
  loadGame: (saveId: string) => Promise<boolean>;
  autoSave: () => Promise<void>;
  requestAutoSave: () => void;
  cancelBackgroundAutoSave: () => void;
  setAutoSaveReadingBusy: (busy: boolean) => void;
  deleteSave: (saveId: string) => Promise<void>;

  // 序列化
  serializeState: () => SerializedGameState;
  deserializeState: (data: SerializedGameState, world: WorldDefinition) => void;

  // === V2: 存储初始化 ===
  /** 加载索引到缓存（应用启动时调用一次） */
  loadIndices: () => Promise<void>;
}

// ============================================================
// createSaveSlice
// ============================================================

export const createSaveSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): SaveSlice => {
  let readingBusy = false;
  let indicesRequest = 0;
  const coordinator = new AutosaveCoordinator({
    revision: () => {
      const state = get();
      return { scope: scopedKey(state, `autosave_${state.currentPlaythroughId ?? ''}:${state.currentWorld?.id ?? ''}`), references: AUTOSAVE_STATE_KEYS.map(key => state[key]) };
    },
    write: () => writeRecoveryPoint(),
    interval: () => loadSettings().autoSaveInterval,
    busy: () => readingBusy || get().isLoading || isPipelineBusy(),
    onError: cause => console.warn('[AutoSave] Background recovery point failed:', cause),
  });
  const writeRecoveryPoint = async () => {
    const state = get();
    const world = state.currentWorld as WorldDefinition | null;
    if (!world || (state.history as ActionRecord[]).length === 0) return;
    if (!hasPlayableIdentityState(state)) {
      console.warn("[AutoSave] Identity selection is incomplete; skipping autosave.");
      return;
    }

    const playthroughId = state.currentPlaythroughId as string | null;
    if (!playthroughId) {
      console.warn("[AutoSave] No current playthrough, skipping");
      return;
    }

    const serialized = state.serializeState();
    let previousAutoSave: GameSave | null = null;
    const prevSaveId = `autosave_prev_${playthroughId}`;

    try {
      // 旋转：当前 → 上一步
      const current = await loadFromDB(scopedKey(state, autoSaveDataKey(playthroughId))) as GameSave | null;
      if (buildPreviousAutoSaveMeta(current, playthroughId)) {
        previousAutoSave = current;
        await saveToDB(scopedKey(state, `autosave_prev_data_${playthroughId}`), current);
      } else {
        await removeFromDB(scopedKey(state, `autosave_prev_data_${playthroughId}`));
      }
    } catch (cause) { console.warn("[AutoSave] Previous recovery point could not be rotated:", cause); throw cause; }

    const now = Date.now();
    const saveId = `autosave_${playthroughId}`;
    const recentSummary = (state.history as ActionRecord[])
      .slice(-3)
      .map((h: ActionRecord) => h.summary)
      .join("；");

    const meta: SaveSlot = {
      id: saveId,
      name: `[自动存档] ${world.name} · ${state.playerName}`,
      createdAt: now,
      updatedAt: now,
      gameTime: { ...state.gameTime },
      worldId: world.id,
      worldName: world.name,
      playthroughId,
      playerName: state.playerName ?? "",
      currentSceneName: state.currentScene?.name ?? "未知",
      actionCount: (state.currentNode as any)?.stepNumber ?? (state.history as ActionRecord[]).length,
      preview: recentSummary || "故事刚刚开始...",
      playDuration: state.getPlayDuration?.() ?? 0,
      type: "autosave",
    };

    // A navigation during an asynchronous save must not persist a different live world line.
    if (get().currentWorld === world && get().currentPlaythroughId === playthroughId) await state.persistWorldLineData?.();
    const save: GameSave = { meta, world, state: serialized };
    meta.sizeBytes = JSON.stringify(save).length;

    // 写入 IndexedDB
    await saveToDB(scopedKey(state, autoSaveDataKey(playthroughId)), save);

    // 更新存档索引缓存（替换同 playthrough + autosave 类型的条目）
    const indexState = scopedKey(get(), META_SAVES_KEY) === scopedKey(state, META_SAVES_KEY) ? get() : state;
    const slots = (indexState.cachedSaveSlots as SaveSlot[]).filter(
      (s) => !(s.playthroughId === playthroughId && (s.id === saveId || s.id === prevSaveId))
    );
    slots.push(meta);

    // 只有旧 autosave 本身可加载时才发布 _prev 条目，避免旧半初始化存档污染选择页。
    const prevMeta = buildPreviousAutoSaveMeta(previousAutoSave, playthroughId);
    if (prevMeta) slots.push(prevMeta);

    await saveMeta(scopedKey(state, META_SAVES_KEY), slots);
    if (scopedKey(get(), META_SAVES_KEY) === scopedKey(state, META_SAVES_KEY)) set({ cachedSaveSlots: slots });

    // 计算世界树数据大小
    let worldTreeSize: number | undefined;
    try {
      const wlData = { worldLine: state.worldLine, allNodes: state.allNodes };
      worldTreeSize = JSON.stringify(wlData).length;
    } catch { /* ignore */ }

    // 更新周目元数据
    const playthroughIndexState = scopedKey(get(), META_PLAYTHROUGHS_KEY) === scopedKey(state, META_PLAYTHROUGHS_KEY) ? get() : state;
    const playthroughs = (playthroughIndexState.cachedPlaythroughs as PlaythroughMeta[]).map((pt) =>
      pt.id === playthroughId
        ? {
            ...pt,
            updatedAt: now,
            actionCount: (state.currentNode as any)?.stepNumber ?? (state.history as ActionRecord[]).length,
            gameTime: { ...state.gameTime },
            currentSceneName: state.currentScene?.name ?? "未知",
            totalPlayDuration: state.getPlayDuration?.() ?? 0,
            playerName: state.playerName ?? pt.playerName,
            worldTreeSizeBytes: worldTreeSize ?? pt.worldTreeSizeBytes,
          }
        : pt
    );
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), playthroughs);
    if (scopedKey(get(), META_PLAYTHROUGHS_KEY) === scopedKey(state, META_PLAYTHROUGHS_KEY)) set({ cachedPlaythroughs: playthroughs });
  };
  return ({
  // ========== 分段/输入/历史（不变） ==========
  savedSegments: [],
  playbackPosition: null,
  savedSegmentIndex: 0,
  savedIsShowingSegments: false,
  saveSegmentState: (segments, index, showing) =>
    set({ savedSegments: [...segments], savedSegmentIndex: index, savedIsShowingSegments: showing,
      playbackPosition: get().currentNode ? { nodeId: get().currentNode.id, index, showing } : null }),

  pendingInput: "",
  setPendingInput: (text) => set({ pendingInput: text }),

  justLoadedSave: false,
  clearLoadedSaveFlag: () => set({ justLoadedSave: false }),

  history: [],
  addToHistory: (record) => set((s) => ({ history: [...s.history, record] })),

  // ========== V2: 周目状态 ==========
  currentPlaythroughId: null,
  cachedSaveSlots: [],
  cachedPlaythroughs: [],

  // ========== V2: 存储初始化 ==========
  loadIndices: async () => {
    const state = get(),request=++indicesRequest;
    const [saves, playthroughs] = await Promise.all([
      loadMeta<SaveSlot[]>(scopedKey(state, META_SAVES_KEY)),
      loadMeta<PlaythroughMeta[]>(scopedKey(state, META_PLAYTHROUGHS_KEY)),
    ]);
    const live=get();
    if(request!==indicesRequest || scopedKey(live,META_SAVES_KEY)!==scopedKey(state,META_SAVES_KEY)) return;
    // A late library read cannot erase a newly accepted save/playthrough or fill
    // another dossier's collection. Each cache may have changed while its peer read.
    set({
      ...(live.cachedSaveSlots===state.cachedSaveSlots ? {cachedSaveSlots:saves ?? []} : {}),
      ...(live.cachedPlaythroughs===state.cachedPlaythroughs ? {cachedPlaythroughs:playthroughs ?? []} : {}),
    });
  },

  // ========== V2: 周目管理 ==========

  createPlaythrough: async (worldId, playerName) => {
    const state = get();
    const now = Date.now();
    const id = `pt_${now}_${Math.random().toString(36).slice(2, 8)}`;

    // 计算当前世界的周目序号
    const existing = (state.cachedPlaythroughs as PlaythroughMeta[]).filter(
      (pt) => pt.worldId === worldId
    );
    const seqNum = existing.length + 1;

    const meta: PlaythroughMeta = {
      id,
      worldId,
      name: `世界树 #${seqNum}`,
      createdAt: now,
      updatedAt: now,
      playerName: playerName ?? "",
      actionCount: 0,
      gameTime: { day: 0, hour: 8, minute: 0 },
      currentSceneName: "",
      totalPlayDuration: 0,
      worldLineId: "", // 将在 initWorldLine 后更新
    };

    // 更新缓存 + IndexedDB
    // The index spans every world; the filtered list above only determines this world's sequence.
    const updated = [...state.cachedPlaythroughs, meta];
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), updated);
    set({ currentPlaythroughId: id, entryContext: null, cachedPlaythroughs: updated, voiceAssets: {}, voiceAssetScope: null, voiceSession: (get().voiceSession ?? 0) + 1 });
    return id;
  },

  listPlaythroughsForWorld: (worldId) => {
    return (get().cachedPlaythroughs as PlaythroughMeta[]).filter(
      (pt) => pt.worldId === worldId
    );
  },

  listSavesForPlaythrough: (playthroughId) => {
    return (get().cachedSaveSlots as SaveSlot[]).filter(
      (s) => s.playthroughId === playthroughId
    );
  },

  deletePlaythrough: async (playthroughId) => {
    const state = get();

    // 0. 重新从 IndexedDB 加载最新索引，确保缓存不过期
    const freshSaves = (await loadMeta<SaveSlot[]>(scopedKey(state, META_SAVES_KEY))) ?? [];
    const freshPts = (await loadMeta<PlaythroughMeta[]>(scopedKey(state, META_PLAYTHROUGHS_KEY))) ?? [];

    const slots = freshSaves.filter(
      (s) => s.playthroughId === playthroughId
    );

    if (state.currentPlaythroughId === playthroughId) {
      set({ voiceSession: (get().voiceSession ?? 0) + 1, voiceAssets: {}, voiceAssetScope: null });
    }
    const voiceWorldId = freshPts.find(p => p.id === playthroughId)?.worldId;
    if (voiceWorldId) await clearVoiceResources(scopedKey(state, JSON.stringify([voiceWorldId, playthroughId])));

    // 1. 删除所有子存档数据（从 save_data store）
    for (const slot of slots) {
      if (slot.id.startsWith("autosave_prev_")) {
        await removeFromDB(scopedKey(state, `autosave_prev_data_${playthroughId}`));
      } else if (slot.id.startsWith("autosave_")) {
        await removeFromDB(scopedKey(state, autoSaveDataKey(playthroughId)));
        await removeFromDB(scopedKey(state, `autosave_prev_data_${playthroughId}`));
      } else {
        await removeFromDB(scopedKey(state, `save_data_${slot.id}`));
      }
    }

    // 2. 清理世界线数据
    const worldLines = (await loadMeta<any[]>(scopedKey(state, "worldline_index_" + (freshPts.find(p => p.id === playthroughId)?.worldId ?? "")))) ?? [];
    const wlEntry = worldLines.find((wl: any) => wl.playthroughId === playthroughId);
    if (wlEntry) {
      await removeMeta(scopedKey(state, `worldline_data_${wlEntry.id}`));
      const remainingWLs = worldLines.filter((wl: any) => wl.id !== wlEntry.id);
      if (remainingWLs.length > 0) {
        await saveMeta(scopedKey(state, `worldline_index_${wlEntry.worldId}`), remainingWLs);
      } else {
        await removeMeta(scopedKey(state, `worldline_index_${wlEntry.worldId}`));
      }
    }

    // 3. 更新存档索引
    const remainingSaves = freshSaves.filter(
      (s) => s.playthroughId !== playthroughId
    );
    await saveMeta(scopedKey(state, META_SAVES_KEY), remainingSaves);

    // 4. 更新世界树索引
    const remainingPts = freshPts.filter(
      (pt) => pt.id !== playthroughId
    );
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), remainingPts);

    // 5. 更新缓存
    set({
      cachedSaveSlots: remainingSaves,
      cachedPlaythroughs: remainingPts,
      currentPlaythroughId:
        state.currentPlaythroughId === playthroughId ? null : state.currentPlaythroughId,
    });
  },

  renamePlaythrough: async (playthroughId, newName) => {
    const state = get();
    const updated = (state.cachedPlaythroughs as PlaythroughMeta[]).map((pt) =>
      pt.id === playthroughId ? { ...pt, name: newName, updatedAt: Date.now() } : pt
    );
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), updated);
    set({ cachedPlaythroughs: updated });
  },

  renameSave: async (saveId, newName) => {
    const state = get();
    const updated = (state.cachedSaveSlots as SaveSlot[]).map((s) =>
      s.id === saveId ? { ...s, name: newName, updatedAt: Date.now() } : s
    );
    await saveMeta(scopedKey(state, META_SAVES_KEY), updated);
    set({ cachedSaveSlots: updated });
  },

  updatePlaythroughMeta: async (updates) => {
    const state = get();
    const ptId = state.currentPlaythroughId as string | null;
    if (!ptId) return;
    const updated = (state.cachedPlaythroughs as PlaythroughMeta[]).map((pt) =>
      pt.id === ptId ? { ...pt, ...updates, updatedAt: Date.now() } : pt
    );
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), updated);
    set({ cachedPlaythroughs: updated });
  },

  // ========== V2: 存档管理 ==========

  getSaveSlots: () => {
    return (get().cachedSaveSlots as SaveSlot[]) ?? [];
  },

  saveGame: async (name, overwriteSaveId) => {
    const state = get();
    const world = state.currentWorld as WorldDefinition | null;
    const playthroughId = state.currentPlaythroughId as string | null;
    if (!world || !playthroughId) return "";
    if (!hasPlayableIdentityState(state)) {
      console.warn("[SaveGame] Identity selection is incomplete; skipping save.");
      return "";
    }

    const existing = overwriteSaveId ? (state.cachedSaveSlots as SaveSlot[]).find(slot => slot.id === overwriteSaveId) : undefined;
    // A slot can only be deliberately replaced inside the active archive, world and playthrough.
    if (overwriteSaveId && (!existing || existing.worldId !== world.id || existing.playthroughId !== playthroughId ||
      existing.type && existing.type !== 'manual' || existing.id.startsWith('autosave_'))) return '';
    const now = Date.now();
    const saveId = existing?.id ?? `save_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const recentSummary = (state.history as ActionRecord[])
      .slice(-3)
      .map((h: ActionRecord) => h.summary)
      .join("；");

    const meta: SaveSlot = {
      id: saveId,
      name: name ?? existing?.name ?? `${world.name} · ${state.playerName} · 第${state.gameTime.day}天`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      gameTime: { ...state.gameTime },
      worldId: world.id,
      worldName: world.name,
      playthroughId,
      playerName: state.playerName ?? "",
      currentSceneName: state.currentScene?.name ?? "未知",
      actionCount: (state.currentNode as any)?.stepNumber ?? (state.history as ActionRecord[]).length,
      preview: recentSummary || "故事刚刚开始...",
      playDuration: state.getPlayDuration?.() ?? 0,
      type: "manual",
    };

    await state.persistWorldLineData?.();
    const save: GameSave = { meta, world, state: state.serializeState() };
    meta.sizeBytes = JSON.stringify(save).length;

    // 2. 保存数据到 IndexedDB
    await saveToDB(scopedKey(state, `save_data_${saveId}`), save);

    // 3. 更新索引缓存 + IndexedDB
    const updatedSlots = existing
      ? (state.cachedSaveSlots as SaveSlot[]).map(slot => slot.id === saveId ? meta : slot)
      : [...(state.cachedSaveSlots as SaveSlot[]), meta];
    await saveMeta(scopedKey(state, META_SAVES_KEY), updatedSlots);
    set({ cachedSaveSlots: updatedSlots });

    // 4. 更新周目元数据
    const playthroughs = (state.cachedPlaythroughs as PlaythroughMeta[]).map((pt) =>
      pt.id === playthroughId
        ? {
            ...pt,
            updatedAt: now,
            actionCount: (state.currentNode as any)?.stepNumber ?? (state.history as ActionRecord[]).length,
            gameTime: { ...state.gameTime },
            currentSceneName: state.currentScene?.name ?? "未知",
            totalPlayDuration: state.getPlayDuration?.() ?? 0,
            playerName: state.playerName ?? pt.playerName,
          }
        : pt
    );
    await saveMeta(scopedKey(state, META_PLAYTHROUGHS_KEY), playthroughs);
    set({ cachedPlaythroughs: playthroughs });

    writeCurrentSaveToSession(state, saveId);
    return saveId;
  },

  loadGame: async (saveId) => {
    if (typeof window === "undefined") return false;
    try {
      const state = get();
      let key: string;
      if (saveId.startsWith("autosave_prev_")) {
        // V2: autosave_prev_{playthroughId}
        const ptId = saveId.slice("autosave_prev_".length);
        key = scopedKey(state, `autosave_prev_data_${ptId}`);
      } else if (saveId.startsWith("autosave_")) {
        // V2: autosave_{playthroughId}
        const ptId = saveId.slice("autosave_".length);
        key = scopedKey(state, autoSaveDataKey(ptId));
      } else {
        key = scopedKey(state, `save_data_${saveId}`);
      }

      const save = (await loadFromDB(key)) as GameSave | null;
      if (!save?.state || !save?.world) {
        console.error("[LoadGame] key not found or invalid:", key);
        return false;
      }
      if (!isLoadableGameSave(save)) {
        console.warn("[LoadGame] Save has no selected identity or starting scene:", saveId);
        return false;
      }

      await hydrateWorldAssetLibrary(save.world.id, get());
      get().deserializeState(save.state, save.world);
      resetSegmentHashes();

      // 设置当前周目并加载关联的世界线
      const ptId = save.meta?.playthroughId;
      if (ptId) {
        set({ currentPlaythroughId: ptId });

        // 从 IndexedDB 加载该周目的世界线数据
        try {
          const worldLines = (await loadMeta<any[]>(scopedKey(state, "worldline_index_" + save.world.id))) ?? [];
          const wlEntry = worldLines.find((wl: any) => wl.playthroughId === ptId);
          if (wlEntry) {
            const wlData = await loadMeta<{ meta: any; nodes: any }>(scopedKey(state, "worldline_data_" + wlEntry.id));
            if (wlData) {
              const savedNodeId = save.state.worldLineNodeId;
              const cn = wlData.nodes[savedNodeId ?? wlData.meta.currentNodeId] ?? null;
              const restoredWorld = mergePluginArchives(get().currentWorld, wlData.meta.gameplayPluginHistory);
              const savedSceneId = get().currentSceneId;
              // 世界线节点的 sceneId 可能存在陈旧闭包 bug，优先信任存档中的 sceneId
              const wlSceneId = cn?.sceneId;
              const correctedSceneId = (wlSceneId && wlSceneId === savedSceneId)
                ? savedSceneId   // 一致 → 任意一个都行
                : (savedSceneId || wlSceneId || get().currentSceneId);  // 不一致 → 信任存档
              if (wlSceneId && wlSceneId !== savedSceneId) {
                console.warn(
                  `[LoadGame] 世界线场景(${wlSceneId})与存档场景(${savedSceneId})不一致，以存档为准`
                );
              }
              const correctedScene = correctedSceneId
                ? getSceneById(restoredWorld, correctedSceneId)
                : get().currentScene;
              set({
                currentWorld: restoredWorld,
                worldLine: { ...wlData.meta, currentNodeId: cn?.id ?? wlData.meta.currentNodeId },
                allNodes: wlData.nodes,
                currentNode: cn,
                currentSceneId: correctedSceneId,
                currentScene: correctedScene,
                sceneNarrative: save.state.sceneNarrative || cn?.aiResponse || '',
              });
              if (cn) set(await restoreNodePlayback(cn, save.state.playbackPosition));
            }
          } else {
            // Imported game records contain a current state but no historical tree.
            await get().initWorldLine(ptId, save.world.id);
          }
        } catch (e: any) {
          console.warn("[LoadGame] 加载世界线数据失败:", e?.message);
        }
      }

      const documentScope = currentDocumentScope(get());
      if (documentScope) await reconcileAcceptedDocuments(documentScope, { history: get().history, nodes: get().allNodes });
      writeCurrentSaveToSession(state, saveId);
      set({ justLoadedSave: true });
      return true;
    } catch (e: any) {
      console.error("[LoadGame] 异常:", e?.message || e, e?.stack);
      return false;
    }
  },

  autoSave: () => coordinator.checkpoint(),
  requestAutoSave: () => coordinator.request(),
  cancelBackgroundAutoSave: () => coordinator.cancelBackground(),
  setAutoSaveReadingBusy: busy => { readingBusy = busy; },

  deleteSave: async (saveId) => {
    if (typeof window === "undefined") return;
    try {
      if (saveId.startsWith('autosave_')) coordinator.invalidate();
      if (saveId.startsWith("autosave_prev_")) {
        const ptId = saveId.slice("autosave_prev_".length);
        await removeFromDB(scopedKey(get(), `autosave_prev_data_${ptId}`));
      } else if (saveId.startsWith("autosave_")) {
        const ptId = saveId.slice("autosave_".length);
        await removeFromDB(scopedKey(get(), autoSaveDataKey(ptId)));
        await removeFromDB(scopedKey(get(), `autosave_prev_data_${ptId}`));
      } else {
        await removeFromDB(scopedKey(get(), `save_data_${saveId}`));
      }

      const slots = (get().cachedSaveSlots as SaveSlot[]).filter(
        (s: SaveSlot) => s.id !== saveId
      );
      await saveMeta(scopedKey(get(), META_SAVES_KEY), slots);
      set({ cachedSaveSlots: slots });
    } catch (e: any) {
      console.error("Failed to delete save:", e);
    }
  },

  // ========== 序列化/反序列化 ==========

  serializeState: () => {
    const s = get();
    const npcSave = splitNpcKnowledgeFromEncyclopedia({
      encyclopedia: s.encyclopedia,
      npcStates: s.npcStates,
      relationships: s.relationships,
      npcBehaviors: s.npcBehaviors,
      npcPersonalities: s.npcPersonalities,
    });

    return {
      gameTime: { ...s.gameTime },
      playerName: s.playerName,
      entryContext: parseEntryContext(s.entryContext, s.currentWorld?.id),
      currentSceneId: s.currentSceneId,
      sceneNarrative: s.sceneNarrative,
      ...(s.currentNode ? { worldLineNodeId: s.currentNode.id } : {}),
      playbackPosition: s.playbackPosition?.nodeId === s.currentNode?.id ? { ...s.playbackPosition } : null,
      readingView: s.readingView ? { ...s.readingView } : null,
      history: (s.history as ActionRecord[]).map((h: ActionRecord, i: number) => ({
        ...h,
        snapshot: i >= s.history.length - 3 ? h.snapshot : null,
      })),
      availableActions: [...s.availableActions],
      sceneDetailLevels: { ...s.sceneDetailLevels },
      discoveredSecrets: JSON.parse(JSON.stringify(s.discoveredSecrets)),
      worldFlags: { ...s.worldFlags },
      gameplayResources: normalizeGameplayResources(s.currentWorld ?? {}, s.gameplayResources),
      gameplayModState: normalizeGameplayModState(s.currentWorld ?? {}, s.gameplayModState),
      documentHeads: structuredClone(s.documentHeads), workspaceState: structuredClone(s.workspaceState),
      narrativeProgress: structuredClone(s.narrativeProgress),
      chapterState: structuredClone(s.chapterState),
      lastDirectorFrame: structuredClone(s.currentDirectorFrame ?? null),
      directorAdviceOrigin: structuredClone(s.directorAdviceOrigin ?? null),
      historyEpochPlan: structuredClone(s.historyEpochPlan ?? null),
      rewindMemory: parseRewindMemory(s.rewindMemory),
      ...(s.currentWorld?.gameplayPluginHistory ? { gameplayPluginSet: s.currentWorld.gameplayPluginHistory.current } : {}),
      resolvedTimelineEvents: [...s.resolvedTimelineEvents],
      deviatedEvents: { ...s.deviatedEvents },
      visitedScenes: [...s.visitedScenes],
      mapState: structuredClone(s.currentWorld?.mapState ?? emptyMapState()),
      inventory: [...s.inventory],
      clues: s.clues.map((c: any) => ({ ...c })),
      encyclopedia: npcSave.encyclopedia,
      criticalFacts: [...s.criticalFacts],
      questLog: JSON.parse(JSON.stringify(s.questLog)),
      npcMemory: npcSave.npcMemory,
      diary: s.diary.map((d: any) => ({ ...d })),
      weather: s.weather,
      protagonistState: { ...s.protagonistState },
      notebookEvents: [...s.notebookEvents],
      causalProjections: s.causalProjections.map((cp: any) => ({
        ...cp,
        rippleEffects: cp.rippleEffects.map((r: any) => ({ ...r })),
      })),
      sandboxToolAudit: Array.isArray(s.sandboxToolAudit)
        ? s.sandboxToolAudit.map((entry: any) => ({
            ...entry,
            requestedPaths: [...(entry.requestedPaths ?? [])],
            approvedPaths: [...(entry.approvedPaths ?? [])],
            evidenceRefs: [...(entry.evidenceRefs ?? [])],
          }))
        : undefined,
      sandboxSaveMarks: Array.isArray(s.sandboxSaveMarks)
        ? s.sandboxSaveMarks.map((mark: any) => ({ ...mark }))
        : undefined,
      sandboxActionLock: s.sandboxActionLock ? { ...s.sandboxActionLock } : null,
      realityArtifacts: Array.isArray(s.realityArtifacts)
        ? s.realityArtifacts.map((artifact: any) => ({
            ...artifact,
            consent: { ...(artifact.consent ?? {}) },
            visibleTo: [...(artifact.visibleTo ?? [])],
            safetyNotes: [...(artifact.safetyNotes ?? [])],
          }))
        : undefined,
      boundaryEvents: Array.isArray(s.boundaryEvents)
        ? s.boundaryEvents.map((event: any) => ({
            ...event,
            visibleConsequences: [...(event.visibleConsequences ?? [])],
            hiddenAudit: [...(event.hiddenAudit ?? [])],
          }))
        : undefined,
      metaChannelManifest: s.metaChannelManifest
        ? JSON.parse(JSON.stringify(s.metaChannelManifest))
        : (s.currentWorld?.metaChannelManifest
          ? JSON.parse(JSON.stringify(s.currentWorld.metaChannelManifest))
          : null),
      midoriSettings: s.midoriSettings ? { ...s.midoriSettings } : undefined,
      midoriAssetRegistry: normalizeMidoriAssetRegistry(s.midoriAssetRegistry),
      voiceAssets: s.voiceAssets ?? {},
      momoiVoiceSettings: (() => {
        const ms = s.momoiSettings;
        if (!ms) return undefined;
        // 从 localStorage 读取音色配置
        let voiceProfiles: any[] | undefined;
        let npcVoiceMap: Record<string, string> | undefined;
        if (typeof window !== "undefined") {
          try {
            const raw = localStorage.getItem("eidos_momoi_voice_profiles");
            if (raw) voiceProfiles = JSON.parse(raw);
          } catch {}
          try {
            const worldId = s.currentWorld?.id;
            if (worldId) {
              const raw = localStorage.getItem("eidos_momoi_npc_map_" + worldId);
              if (raw) npcVoiceMap = JSON.parse(raw);
            }
          } catch {}
        }
        return {
          config: normalizeVoiceConfig(s.voiceConfig),
          enabled: ms.enabled,
          autoPlay: ms.autoPlay,
          volume: ms.volume,
          speed: ms.speed,
          defaultVoiceProfileId: s.defaultVoiceProfileId ?? null,
          defaultVoiceEnabled: s.defaultVoiceEnabled ?? false,
          voiceProfiles,
          npcVoiceMap,
        };
      })(),
    };
  },

  deserializeState: (data, world) => {
    world = { ...withoutLegacyProgress(worldAtPluginSet(world, data.gameplayPluginSet)), mapState: structuredClone(data.mapState ?? emptyMapState()) };
    const normalizedEncyclopedia = Array.isArray(data.encyclopedia)
      ? data.encyclopedia.map((e: any) => ({
          ...e,
          knowledge: Array.isArray(e.knowledge)
            ? e.knowledge.map((k: any) =>
                typeof k === "string"
                  ? { text: k, source: "ai" as const, addedAt: { day: 0, hour: 0, minute: 0 }, importance: 50 } as KnowledgeItem
                  : k as KnowledgeItem
              )
            : [],
        }))
      : [];
    const npcMemory = data.npcMemory ?? buildNpcMemoryState({
      encyclopedia: normalizedEncyclopedia,
      npcStates: data.npcStates,
      relationships: data.relationships,
      npcBehaviors: data.npcBehaviors,
      npcPersonalities: data.npcPersonalities,
    });
    const npcProjection = projectNpcMemoryState(npcMemory, world);

    set({
      currentWorld: world,
      gameTime: data.gameTime
        ? { ...data.gameTime }
        : { day: 0, hour: 8, minute: 0 },
      playerName: data.playerName || "",
      entryContext: parseEntryContext(data.entryContext, world.id),
      currentSceneId: data.currentSceneId || "",
      currentScene: getSceneById(world, data.currentSceneId || ""),
      sceneNarrative:
        data.sceneNarrative ||
        getSceneById(world, data.currentSceneId || "")?.initialDescription ||
        "",
      history: Array.isArray(data.history) ? [...data.history] : [],
      availableActions: Array.isArray(data.availableActions)
        ? [...data.availableActions]
        : [],
      sceneDetailLevels: data.sceneDetailLevels ? { ...data.sceneDetailLevels } : {},
      discoveredSecrets: data.discoveredSecrets
        ? JSON.parse(JSON.stringify(data.discoveredSecrets))
        : {},
      worldFlags: data.worldFlags ? { ...data.worldFlags } : {},
      gameplayResources: normalizeGameplayResources(world, data.gameplayResources),
      gameplayModState: normalizeGameplayModState(world, data.gameplayModState),
      documentHeads: structuredClone(data.documentHeads ?? []), workspaceState: structuredClone(data.workspaceState ?? {}),
      narrativeProgress: parseNarrativeBeat(data.narrativeProgress) ?? null,
      chapterState: data.chapterState?.worldId === world.id ? parseChapterState(data.chapterState) : null,
      currentDirectorFrame: !data.directorAdviceOrigin || data.directorAdviceOrigin.worldId === world.id ? data.lastDirectorFrame ?? null : null,
      directorAdviceOrigin: data.directorAdviceOrigin?.worldId === world.id ? data.directorAdviceOrigin : null,
      historyEpochPlan: data.historyEpochPlan?.scope?.worldId === world.id ? data.historyEpochPlan : null,
      rewindMemory: parseRewindMemory(data.rewindMemory),
      npcStates: npcProjection.npcStates,
      resolvedTimelineEvents: Array.isArray(data.resolvedTimelineEvents)
        ? [...data.resolvedTimelineEvents]
        : [],
      deviatedEvents: data.deviatedEvents ? { ...data.deviatedEvents } : {},
      visitedScenes: Array.isArray(data.visitedScenes) ? [...data.visitedScenes] : [],
      inventory: Array.isArray(data.inventory) ? [...data.inventory] : [],
      clues: Array.isArray(data.clues)
        ? data.clues.map((c: any) => ({ ...c }))
        : [],
      encyclopedia: mergeNpcMemoryIntoEncyclopedia(normalizedEncyclopedia, npcMemory),
      criticalFacts: Array.isArray(data.criticalFacts)
        ? data.criticalFacts.map((f: any) =>
            typeof f === "string"
              ? { text: f, importanceScore: 50, referencedCount: 1, lastReferencedAt: null } as CriticalFactEntry
              : f as CriticalFactEntry
          )
        : [],
      questLog: Array.isArray(data.questLog) ? [...data.questLog] : [],
      relationships: npcProjection.relationships,
      weather: data.weather || ("晴" as Weather),
      protagonistState: data.protagonistState
        ? {
            health: data.protagonistState.health || "良好",
            mood: data.protagonistState.mood || "平静",
            statusEffects: Array.isArray(data.protagonistState.statusEffects)
              ? data.protagonistState.statusEffects
              : [],
            notes: data.protagonistState.notes || "",
          }
        : { health: "良好", mood: "平静", statusEffects: [], notes: "" },
      notebookEvents: Array.isArray(data.notebookEvents) ? [...data.notebookEvents] : [],
      causalProjections: Array.isArray(data.causalProjections)
        ? data.causalProjections.map((cp: any) => ({
            ...cp,
            rippleEffects: (cp.rippleEffects || []).map((r: any) => ({ ...r })),
          }))
        : [],
      sandboxToolAudit: Array.isArray(data.sandboxToolAudit)
        ? data.sandboxToolAudit.map((entry: any) => ({
            ...entry,
            requestedPaths: Array.isArray(entry.requestedPaths) ? [...entry.requestedPaths] : [],
            approvedPaths: Array.isArray(entry.approvedPaths) ? [...entry.approvedPaths] : [],
            evidenceRefs: Array.isArray(entry.evidenceRefs) ? [...entry.evidenceRefs] : [],
          }))
        : [],
      sandboxSaveMarks: Array.isArray(data.sandboxSaveMarks)
        ? data.sandboxSaveMarks.map((mark: any) => ({ ...mark }))
        : [],
      sandboxActionLock: data.sandboxActionLock ? { ...data.sandboxActionLock } : null,
      realityArtifacts: Array.isArray(data.realityArtifacts)
        ? data.realityArtifacts.map((artifact: any) => ({
            ...artifact,
            consent: { ...(artifact.consent ?? {}) },
            visibleTo: Array.isArray(artifact.visibleTo) ? [...artifact.visibleTo] : [],
            safetyNotes: Array.isArray(artifact.safetyNotes) ? [...artifact.safetyNotes] : [],
          }))
        : [],
      boundaryEvents: Array.isArray(data.boundaryEvents)
        ? data.boundaryEvents.map((event: any) => ({
            ...event,
            visibleConsequences: Array.isArray(event.visibleConsequences) ? [...event.visibleConsequences] : [],
            hiddenAudit: Array.isArray(event.hiddenAudit) ? [...event.hiddenAudit] : [],
          }))
        : [],
      metaChannelManifest: data.metaChannelManifest
        ? JSON.parse(JSON.stringify(data.metaChannelManifest))
        : (world.metaChannelManifest ? JSON.parse(JSON.stringify(world.metaChannelManifest)) : null),
      npcBehaviors: npcProjection.npcBehaviors,
      npcPersonalities: npcProjection.npcPersonalities,
      diary: Array.isArray(data.diary)
        ? data.diary.map((d: any) => ({ ...d }))
        : [],
      // 清空世界线数据（加载存档时重新关联）
      savedSegments: [], savedSegmentIndex: 0, savedIsShowingSegments: false,
      playbackPosition: parsePlaybackPosition(data.playbackPosition),
      readingView: parseReadingView(data.readingView), readingSegments: null,
      worldLine: null,
      allNodes: {},
      currentNode: null,
      // 清空重放状态
      replayState: { active: false, mode: "no_branch" as const, importData: null, currentNodeId: null, hasDiverged: false },
      midoriSettings: {
        ...DEFAULT_MIDORI_SETTINGS,
        ...(data.midoriSettings ?? {}),
        enabled: false,
        autoGenerate: false,
      } as MidoriSettings,
      midoriAssetRegistry: loadWorldAssetRegistry(world, data.midoriAssetRegistry, get()),
      voiceAssets: normalizeVoiceAssets(data.voiceAssets),
      voiceAssetScope: null,
      voiceSession: (get().voiceSession ?? 0) + 1,
      voiceConfig: normalizeVoiceConfig(data.momoiVoiceSettings?.config),
      voiceError: null,
      momoiStatus: "unverified",
      voiceServiceMessage: "",
      voiceServiceCheckedAt: null,
      voiceServiceGenerating: 0,
      isVoicePlaying: false,
      voiceProgress: null,
      momoiSettings: { enabled: false, autoPlay: true, volume: .8, speed: 1 },
      // 恢复 MOMOI 语音设置
      ...(data.momoiVoiceSettings ? {
        momoiSettings: {
          enabled: data.momoiVoiceSettings.enabled ?? false,
          autoPlay: data.momoiVoiceSettings.autoPlay ?? true,
          volume: data.momoiVoiceSettings.volume ?? 0.8,
          speed: data.momoiVoiceSettings.speed ?? 1.0,
        },
        defaultVoiceProfileId: data.momoiVoiceSettings.defaultVoiceProfileId ?? null,
        defaultVoiceEnabled: data.momoiVoiceSettings.defaultVoiceEnabled ?? false,
      } : {}),
      sceneImageUrl: null,
      examineState: null,
      phase: "playing",
      realPlayStartTime: Date.now(),
    });

    // 恢复 MOMOI 音色数据到 localStorage（仅当 localStorage 为空时才从存档恢复，防止覆盖用户的手动删除）
    if (data.momoiVoiceSettings && typeof window !== "undefined") {
      const v = data.momoiVoiceSettings;
      try {
        const existing = localStorage.getItem("eidos_momoi_voice_profiles");
        if (v.voiceProfiles && v.voiceProfiles.length > 0 && (!existing || existing === "[]")) {
          localStorage.setItem("eidos_momoi_voice_profiles", JSON.stringify(v.voiceProfiles));
        }
        const mapKey = "eidos_momoi_npc_map_" + world.id;
        const existingMap = localStorage.getItem(mapKey);
        if (v.npcVoiceMap && Object.keys(v.npcVoiceMap).length > 0 && !existingMap) {
          localStorage.setItem(mapKey, JSON.stringify(v.npcVoiceMap));
        }
      } catch {}
    }
  },
});
};

// ============================================================
// 公开辅助函数（供 UI 组件使用，纯数据查询，不依赖 store 导入）
// ============================================================

/** 列出所有存档（纯函数，需传入缓存数据） */
export function filterSavesByWorld(saves: SaveSlot[], worldId: string): SaveSlot[] {
  return saves.filter((s) => s.worldId === worldId);
}

/** 按周目 ID 列出存档 */
export function filterSavesByPlaythrough(saves: SaveSlot[], playthroughId: string): SaveSlot[] {
  return saves.filter((s) => s.playthroughId === playthroughId);
}

/** 按世界 ID 列出周目 */
export function filterPlaythroughsByWorld(playthroughs: PlaythroughMeta[], worldId: string): PlaythroughMeta[] {
  return playthroughs.filter((pt) => pt.worldId === worldId);
}

/**
 * 重命名世界，同步更新所有相关元数据。
 * 需要传入当前状态以便更新缓存。
 */
export async function renameWorldData(
  worldId: string,
  newName: string,
  cachedSlots: SaveSlot[],
  newSubtitle?: string,
  definition?: WorldDefinition,
): Promise<{ slots: SaveSlot[]; worlds: WorldDefinition[] } | null> {
  if (typeof window === "undefined") return null;

  try {
    // 1. 更新世界列表
    const stored = await loadMeta<WorldDefinition[]>(META_WORLDS_KEY) ?? loadPlayerWorlds();
    // Seed worlds enter the same persisted collection when first edited.
    const worlds = definition && !stored.some(world => world.id === worldId) ? [...stored, definition] : stored;
    let updatedWorlds: WorldDefinition[] = [];
    if (worlds) {
      updatedWorlds = worlds.map((w) =>
        w.id === worldId
          ? { ...w, name: newName, ...(newSubtitle !== undefined ? { subtitle: newSubtitle } : {}) }
          : w
      );
      await saveMeta(META_WORLDS_KEY, updatedWorlds);
      saveToLocalStorage("eidos_player_worlds", updatedWorlds);
    }

    // 2. 更新存档索引中的 worldName
    const updatedSlots = cachedSlots.map((s) =>
      s.worldId === worldId ? { ...s, worldName: newName } : s
    );
    await saveMeta(META_SAVES_KEY, updatedSlots);

    return { slots: updatedSlots, worlds: updatedWorlds };
  } catch (e: any) {
    console.error("[renameWorld] 失败:", e);
    return null;
  }
}
