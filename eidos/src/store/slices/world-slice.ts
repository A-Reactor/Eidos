import { archiveScopeSessionValue } from '@/lib/game/archive-scope';
import { captureDirectorCue } from '@/lib/game/director-cues';
import { withoutLegacyProgress } from '@/lib/game/legacy-progress';
import { parseChapterState } from '@/lib/game/chapters/validation';
import { presentationContext } from '@/lib/game/presentation';
import { worldAtPluginSet } from '@/lib/game/plugins/package-history';
import { parseEntryContext, type WorldEntryContext } from '@/lib/game/world-entry';
import { parseNarrativeBeat } from '@/lib/game/narrative-beat';
import { parseRewindMemory, type RewindMemory } from '@/lib/game/rewind';
import { normalizeGameplayResources } from '@/lib/game/plugins/resources';
import { normalizeGameplayModState, type GameplayModState } from '@/lib/game/plugins/mod-ui';
import { applyMapUpdates as updateWorldMap, emptyMapState, mapRoutes } from "@/lib/game/map-state";
// ============================================================
// Eidos · 世界管理系统 Slice
// ============================================================

import type {
  GameTime,
  IdentityOption,
  Scene,
  Weather,
  WorldDefinition,
  WorldSnapshot,
  WorldTimelineEvent,
  CausalProjection,
  RippleEffect,
  NpcBehavior,
  CausalStats,
} from "@/lib/game/types";
import type { DirectorFrame } from "@/lib/ai/types";
import type { AnyPersonalityState } from "@/lib/personality/types";
import { ensureSceneNpcBehaviors, mergeNpcBehavior } from "@/lib/game/npc-behavior";
import { normalizeNpcDescriptions } from "@/lib/game/npc-description";
import { loadWorldAssetRegistry } from '@/lib/game/midori/asset-library';
import { nextWeather } from "@/lib/game/calendar";
import { addTime, timeToMinutes } from "@/lib/game/time";
import { loadPlayerWorlds, savePlayerWorlds } from "./save-slice";
import { getSceneById, resolveSceneReference } from "@/lib/game/scene-utils";
import { cancelKeiQueue } from "@/lib/ai/kei-review";
import {
  buildNpcMemoryState,
  mergeNpcMemoryIntoEncyclopedia,
  projectNpcMemoryState,
  splitNpcKnowledgeFromEncyclopedia,
} from "@/lib/game/npc-memory-save";

export interface WorldSlice {
  rewindMemory: RewindMemory | null;
  currentWorld: WorldDefinition | null;
  applyMapUpdates: (input: unknown) => boolean;
  setCurrentWorld: (world: WorldDefinition) => void;
  playerWorlds: WorldDefinition[];
  addPlayerWorld: (world: WorldDefinition) => void;
  removePlayerWorld: (worldId: string) => void;

  /** V2: 当前周目 ID */
  currentPlaythroughId: string | null;
  setCurrentPlaythrough: (id: string | null) => void;

  gameTime: GameTime;
  advanceTime: (timeSpent: GameTime) => void;
  setGameTime: (time: GameTime) => void;
  realPlayStartTime: number;
  getPlayDuration: () => number;

  weather: Weather;
  updateWeather: () => void;

  resolvedTimelineEvents: string[];
  deviatedEvents: Record<string, string>;
  resolveTimelineEvent: (eventId: string) => void;
  deviateEvent: (eventId: string, newOutcome: string) => void;
  getNearbyEvents: () => WorldTimelineEvent[];

  worldFlags: Record<string, boolean>;
  gameplayResources: Record<string, number>;
  gameplayModState: GameplayModState;
  documentHeads: import('@/lib/game/documents/types').DocumentRef[];
  workspaceState: import('@/lib/game/workspace/types').WorkspaceFiles;
  chapterState: import("@/lib/game/chapters/types").ChapterState | null;
  narrativeProgress: import("@/lib/game/narrative-beat").NarrativeBeat | null;
  setWorldFlag: (flag: string, value: boolean) => void;

  npcStates: Record<string, string>;
  setNPCState: (npcId: string, state: string) => void;

  sceneDetailLevels: Record<string, number>;
  increaseSceneDetail: (sceneId: string, amount: number) => void;

  discoveredSecrets: Record<string, string[]>;
  discoverSecret: (sceneId: string, secret: string) => void;

  createSnapshot: () => WorldSnapshot;
  /** Prepare every restored field before a worldline pointer can be persisted. */
  prepareSnapshotRestore: (snapshot: WorldSnapshot) => Record<string, unknown> | null;
  restoreSnapshot: (snapshot: WorldSnapshot) => void;

  visitedScenes: string[];
  currentSceneId: string;
  currentScene: Scene | null;
  sceneNarrative: string;
  navigateToScene: (sceneId: string) => void;
  setSceneNarrative: (narrative: string) => void;

  playerName: string;
  entryContext: WorldEntryContext | null;
  setEntryContext: (context: WorldEntryContext | null) => void;
  identityOptions: IdentityOption[];
  setIdentityOptions: (options: IdentityOption[]) => void;
  setPlayerName: (name: string) => void;

  availableActions: string[];
  setAvailableActions: (actions: string[]) => void;

  worldConcept: string;
  setWorldConcept: (concept: string) => void;

  notebookEvents: string[];
  addNotebookEvent: (event: string) => void;
  removeNotebookEvent: (index: number) => void;

  /** NPC 行为快照（按 NPC 名称索引） */
  npcBehaviors: Record<string, NpcBehavior>;
  /** 更新单个 NPC 的行为快照 */
  setNpcBehavior: (name: string, behavior: Partial<NpcBehavior> & { currentScene: string }) => void;
  /** 为当前场景 NPC 批量生成默认行为（进入场景时调用） */
  ensureSceneBehaviors: (sceneId: string) => void;

  /** 因果推演：KEI 预测的连锁反应 */
  causalProjections: CausalProjection[];
  /** 追加一组因果预测（去重：同 triggerAction 替换旧预测） */
  setCausalProjections: (projections: CausalProjection[]) => void;
  /** 更新单条 ripple 的状态（fulfilled/defied/expired） */
  resolveRippleEffect: (rippleId: string, status: "fulfilled" | "defied" | "expired", note: string) => void;
  /** 检查 pending 预测是否应该触发验证（advanceTime 调用） */
  checkPendingProjections: (currentTime: GameTime) => void;
  /** 计算因果推演统计（从 causalProjections 推导） */
  getCausalStats: () => import("@/lib/game/types").CausalStats;

  // ========== 直接编辑 setter（创造模式） ==========
  /** 覆写场景探索度 */
  setSceneDetailLevel: (sceneId: string, level: number) => void;
  /** 删除世界标志 */
  deleteWorldFlag: (key: string) => void;
  /** 全量覆写 NPC 行为快照 */
  setNpcBehaviorDirect: (name: string, behavior: NpcBehavior) => void;
  /** 覆写 NPC 状态 */
  setNpcStateDirect: (npcId: string, state: string) => void;
  /** 删除已发现秘密 */
  removeDiscoveredSecret: (sceneId: string, index: number) => void;

  /** 文学控制：当前导演帧（KEI Quality Review 产出，供下一轮 ALICE 使用） */
  currentDirectorFrame: DirectorFrame | null;
  /** 设置导演帧 */
  historyEpochPlan: import('@/lib/ai/history-epoch').HistoryEpochPlan | null;
  directorAdviceOrigin: import('@/lib/ai/types').KeiReviewOrigin | null;
  setDirectorFrame: (frame: DirectorFrame | null, origin?: import('@/lib/ai/types').KeiReviewOrigin) => void;
}

// getSceneById 定义在 @/lib/game/scene-utils 中

export const createWorldSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): WorldSlice => ({
  // ========== 世界管理 ==========
  currentWorld: null,
  applyMapUpdates: (input) => {
    const state = get();
    if (!state.currentWorld) return false;
    try {
      const world = updateWorldMap(state.currentWorld, input);
      set({ currentWorld: world, currentScene: getSceneById(world, state.currentSceneId) });
      return true;
    } catch (error) {
      console.warn('[地图更新] 已拒绝无效更新', error);
      return false;
    }
  },
  currentPlaythroughId: null,
  currentDirectorFrame: null,
  directorAdviceOrigin: null,
  historyEpochPlan: null,
  setCurrentPlaythrough: (id) => set({ currentPlaythroughId: id }),

  setCurrentWorld: (world) => {
    world = withoutLegacyProgress(world);
    const gameplayResources = normalizeGameplayResources(world);
    const gameplayModState = normalizeGameplayModState(world);
    // 切换世界时清空 KEI 队列，防止旧世界的审核污染新世界
    cancelKeiQueue();
    // 初始化世界的线索
    const clues = world.clues.map((c) => ({ ...c }));
    set({
      // 新周目从原始地图开始；读档由 deserializeState 恢复对应分支的覆盖层。
      currentWorld: { ...world, mapState: emptyMapState() },
      midoriAssetRegistry: loadWorldAssetRegistry(world, null, get()),
      sceneImageUrl: null,
      examineState: null,
      voiceAssets: {},
      voiceAssetScope: null,
      voiceSession: (get().voiceSession ?? 0) + 1,
      currentPlaythroughId: null, // 世界切换时重置周目
      worldFlags: {},
      gameplayResources,
      gameplayModState,
      documentHeads: [], workspaceState: {},
      narrativeProgress: null, chapterState: null,
      rewindMemory: null,
      resolvedTimelineEvents: [],
      deviatedEvents: {},
      npcStates: {},
      sceneDetailLevels: {},
      discoveredSecrets: {},
      inventory: [],
      clues,
      gameTime: { day: 0, hour: 8, minute: 0 },
      // 清空旧世界的所有玩家数据，防止跨世界污染
      history: [],
      relationships: {},
      encyclopedia: [],
      diary: [],
      questLog: [],
      criticalFacts: [],
      playerName: "",
      entryContext: null,
      identityOptions: world.identityOptions ?? [],
      availableActions: [],
      notebookEvents: [],
      protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
      weather: "晴" as Weather,
      causalProjections: [] as CausalProjection[],
      npcBehaviors: {} as Record<string, NpcBehavior>,
      npcPersonalities: {} as Record<string, AnyPersonalityState>,
      metaChannelManifest: world.metaChannelManifest
        ? JSON.parse(JSON.stringify(world.metaChannelManifest))
        : null,
      realityArtifacts: [],
      boundaryEvents: [],
      currentDirectorFrame: null as DirectorFrame | null,
      directorAdviceOrigin: null,
      historyEpochPlan: null,
      // 清空世界线数据（新世界需重新初始化）
      worldLine: null,
      allNodes: {},
      currentNode: null,
      // 清空场景状态，防止旧存档场景泄漏到新游戏
      currentSceneId: "",
      currentScene: null,
      sceneNarrative: "",
      // 清空其他可能泄漏的 UI 状态
      savedSegments: [],
      savedSegmentIndex: 0,
      savedIsShowingSegments: false,
      readingView: null,
      readingSegments: null,
      pendingInput: "",
      justLoadedSave: false,
      // 清空推测缓存
      cachedSpeculation: null,
      realPlayStartTime: Date.now(),
    });
  },

  playerWorlds: [],
  addPlayerWorld: (world) =>
    set((s) => {
      // The collection can still be on disk after startup; an empty cache is not
      // evidence that older worlds were removed. Live definitions win by ID.
      const updated = [...new Map([...loadPlayerWorlds(), ...s.playerWorlds, world].map(item => [item.id, item])).values()];
      savePlayerWorlds(updated);
      return { playerWorlds: updated };
    }),
  removePlayerWorld: (worldId) =>
    set((s) => {
      const worlds = new Map([...loadPlayerWorlds(), ...s.playerWorlds].map(world => [world.id, world]));
      const updated = [...worlds.values()].filter(world => world.id !== worldId);
      savePlayerWorlds(updated);
      return { playerWorlds: updated };
    }),

  // ========== 游戏时间 ==========
  gameTime: { day: 0, hour: 8, minute: 0 },
  advanceTime: (timeSpent) => {
    const newTime = addTime(get().gameTime, timeSpent);
    set({ gameTime: newTime });

    // 检查基线事件
    const world = get().currentWorld;
    if (world) {
      const already = new Set(get().resolvedTimelineEvents);
      const deviated = get().deviatedEvents;
      const toResolve: string[] = [];
      const flags = { ...get().worldFlags };

      for (const event of world.timeline) {
        if (already.has(event.id)) continue;
        if (deviated[event.id]) continue;
        if (timeToMinutes(newTime) >= timeToMinutes(event.timePoint)) {
          toResolve.push(event.id);
          event.worldFlags?.forEach((f: string) => (flags[f] = true));
        }
      }

      if (toResolve.length > 0) {
        set((s) => ({
          resolvedTimelineEvents: [
            ...s.resolvedTimelineEvents,
            ...toResolve,
          ],
          worldFlags: flags,
        }));
      }

      // 因果推演自动验证：检查 pending 预测是否到期
      get().checkPendingProjections(newTime);
    }
  },
  setGameTime: (time) => set({ gameTime: time }),

  realPlayStartTime: Date.now(),
  getPlayDuration: () =>
    Math.floor((Date.now() - get().realPlayStartTime) / 60000),

  weather: "晴",
  updateWeather: () =>
    set((s) => ({
      weather: nextWeather(s.weather, s.gameTime.hour + s.gameTime.day * 24),
    })),

  // ========== 世界推演事件 ==========
  resolvedTimelineEvents: [],
  deviatedEvents: {},
  resolveTimelineEvent: (eventId) =>
    set((s) => ({
      resolvedTimelineEvents: [...s.resolvedTimelineEvents, eventId],
    })),
  deviateEvent: (eventId, newOutcome) =>
    set((s) => ({
      deviatedEvents: { ...s.deviatedEvents, [eventId]: newOutcome },
    })),
  getNearbyEvents: () => {
    const { gameTime, currentWorld } = get();
    if (!currentWorld) return [];
    const currentMins = timeToMinutes(gameTime);
    const windowMins = 120;
    return currentWorld.timeline.filter((e: WorldTimelineEvent) => {
      const diff = Math.abs(timeToMinutes(e.timePoint) - currentMins);
      return diff <= windowMins;
    });
  },

  // ========== 世界标志 ==========
  gameplayResources: {},
  gameplayModState: {},
  documentHeads: [], workspaceState: {},
  narrativeProgress: null, chapterState: null,
  rewindMemory: null,
  worldFlags: {},
  setWorldFlag: (flag, value) =>
    set((s) => ({ worldFlags: { ...s.worldFlags, [flag]: value } })),

  // ========== NPC 状态 ==========
  npcStates: {},
  setNPCState: (npcId, state) => {
    // 首次设置 NPC 状态时自动初始化关系
    const rels = get().relationships;
    if (!rels[npcId]) {
      get().updateRelationship({ npcName: npcId });
    }
    set((s) => ({ npcStates: { ...s.npcStates, [npcId]: state } }));
  },

  // ========== NPC 行为快照 ==========
  npcBehaviors: {} as Record<string, NpcBehavior>,

  setNpcBehavior: (name, partial) =>
    set((s) => ({
      npcBehaviors: mergeNpcBehavior(name, partial, get().gameTime, s.npcBehaviors),
    })),

  ensureSceneBehaviors: (sceneId) => {
    const s = get();
    const world = s.currentWorld as WorldDefinition | null;
    if (!world) return;
    const regionScenes: any[] = [];
    for (const region of Object.values(world.regions)) {
      const scenes = (region as any).scenes;
      if (scenes) {
        for (const sc of Object.values(scenes)) {
          regionScenes.push(sc);
        }
      }
    }
    const scene = regionScenes.find((sc: any) => sc.id === sceneId);
    if (!scene || !scene.npcs?.length) return;
    const npcDescriptions = normalizeNpcDescriptions(world.npcs as Record<string, unknown>);
    const updated = ensureSceneNpcBehaviors(
      scene.npcs as string[],
      npcDescriptions,
      sceneId,
      s.gameTime,
      s.npcBehaviors,
    );
    set({ npcBehaviors: updated });

    // 人格自动初始化——不设角色白名单，从 NPC 描述提取人格档案，
    // 边界敏感度 ≥ 阈值的角色自动获得完整追踪
    for (const npcName of scene.npcs as string[]) {
      const desc = npcDescriptions[npcName];
      if (desc && !s.npcPersonalities[npcName]) {
        s.ensurePersonality(npcName, desc, false);
      }
    }
  },

  // ========== 场景细节级别 ==========
  sceneDetailLevels: {},
  increaseSceneDetail: (sceneId, amount) =>
    set((s) => ({
      sceneDetailLevels: {
        ...s.sceneDetailLevels,
        [sceneId]: Math.min(100, (s.sceneDetailLevels[sceneId] ?? 10) + amount),
      },
    })),

  // ========== 秘密 ==========
  discoveredSecrets: {},
  discoverSecret: (sceneId, secret) =>
    set((s) => ({
      discoveredSecrets: {
        ...s.discoveredSecrets,
        [sceneId]: [...(s.discoveredSecrets[sceneId] ?? []), secret],
      },
    })),

  // ========== 快照 ==========
  createSnapshot: () => {
    const npcSave = splitNpcKnowledgeFromEncyclopedia({
      encyclopedia: get().encyclopedia,
      npcStates: get().npcStates,
      relationships: get().relationships,
      npcBehaviors: get().npcBehaviors,
      npcPersonalities: get().npcPersonalities,
    });

    const state = get();
    const origin = state.directorAdviceOrigin;
    const originMatches = !origin || (origin.worldId === state.currentWorld?.id
      && origin.playthroughId === (state.currentPlaythroughId ?? null)
      && origin.archiveScope === archiveScopeSessionValue(state)
      && (origin.worldLineId === null || origin.worldLineId === (state.worldLine?.id ?? null)));
    const directorOrigin = originMatches ? origin : null;
    const directorFrame = originMatches ? state.currentDirectorFrame : null;
    return {
      ...(presentationContext(get().allNodes ?? {},get().currentNode?.id).length ? { presentationContext: presentationContext(get().allNodes ?? {},get().currentNode?.id) } : {}),
      worldId: get().currentWorld?.id ?? "",
      mapState: structuredClone(get().currentWorld?.mapState ?? emptyMapState()),
      currentSceneId: get().currentSceneId,
      currentGameTime: { ...get().gameTime },
      playerName: get().playerName,
      entryContext: parseEntryContext(get().entryContext, get().currentWorld?.id),
      sceneNarrative: get().sceneNarrative,
      historyLength: get().history.length,
      discoveredSecrets: JSON.parse(JSON.stringify(get().discoveredSecrets)),
      worldFlags: { ...get().worldFlags },
      gameplayResources: normalizeGameplayResources(get().currentWorld ?? {}, get().gameplayResources),
      gameplayModState: normalizeGameplayModState(get().currentWorld ?? {}, get().gameplayModState),
      documentHeads: structuredClone(get().documentHeads), workspaceState: structuredClone(get().workspaceState),
      midoriAssetRegistry: structuredClone(get().midoriAssetRegistry),
      narrativeProgress: structuredClone(get().narrativeProgress),
      chapterState: structuredClone(get().chapterState),
      rewindMemory: parseRewindMemory(get().rewindMemory),
      ...(get().currentWorld?.gameplayPluginHistory ? { gameplayPluginSet: get().currentWorld.gameplayPluginHistory.current } : {}),
      sceneDetailLevels: { ...get().sceneDetailLevels },
      visitedScenes: [...get().visitedScenes],
      resolvedTimelineEvents: [...get().resolvedTimelineEvents],
      deviatedEvents: { ...get().deviatedEvents },
      inventory: JSON.parse(JSON.stringify(get().inventory)),
      clues: JSON.parse(JSON.stringify(get().clues)),
      encyclopedia: JSON.parse(JSON.stringify(npcSave.encyclopedia)),
      availableActions: [...get().availableActions],
      questLog: JSON.parse(JSON.stringify(get().questLog)),
      criticalFacts: [...get().criticalFacts],
      npcMemory: npcSave.npcMemory,
      weather: get().weather,
      protagonistState: get().protagonistState
        ? { ...get().protagonistState }
        : null,
      notebookEvents: [...get().notebookEvents],
      causalProjections: get().causalProjections.map((cp: CausalProjection) => ({
        ...cp,
        rippleEffects: cp.rippleEffects.map((r: RippleEffect) => ({ ...r })),
      })),
      historyEpochPlan: get().historyEpochPlan ?? null,
      promptContextScope: { worldId: get().currentWorld?.id ?? '', playthroughId: get().currentPlaythroughId ?? '', archiveScope: archiveScopeSessionValue(get()) },
      directorAdviceOrigin: directorOrigin ?? null,
      directorCueCandidate: directorOrigin ? captureDirectorCue({
        origin: directorOrigin, afterNodeId: state.currentNode?.id ?? null, frame: directorFrame,
        previous: get().history.flatMap((h: import('@/lib/game/types').ActionRecord) => h.directorCues ?? []).at(-1),
      }) : null,
      lastDirectorFrame: directorFrame ? structuredClone(directorFrame) : null,
      diary: get().diary.map((d: any) => ({
        day: d.day,
        entries: [...d.entries],
        summary: d.summary,
        createdAt: d.createdAt
          ? { ...d.createdAt }
          : { day: 0, hour: 0, minute: 0 },
      })),
    };
  },

  prepareSnapshotRestore: (snapshot) => {
    const currentWorld = get().currentWorld;
    if (!currentWorld || currentWorld.id !== snapshot.worldId) return null;
    const world = { ...worldAtPluginSet(currentWorld, snapshot.gameplayPluginSet), mapState: structuredClone(snapshot.mapState ?? emptyMapState()) };
    const npcMemory = snapshot.npcMemory ?? buildNpcMemoryState({
      encyclopedia: snapshot.encyclopedia ?? [],
      npcStates: snapshot.npcStates,
      relationships: snapshot.relationships,
      npcBehaviors: snapshot.npcBehaviors,
      npcPersonalities: snapshot.npcPersonalities,
    });
    const npcProjection = projectNpcMemoryState(npcMemory, world);
    const snapshotEncyclopedia = mergeNpcMemoryIntoEncyclopedia(snapshot.encyclopedia ?? [], npcMemory);

    // 先查世界定义，再查百科（处理动态发现的地点）
    let scene = getSceneById(world, snapshot.currentSceneId);
    if (!scene) {
      const enc = snapshotEncyclopedia.find(
        (e: any) => e.id === snapshot.currentSceneId && e.type === "location"
      );
      if (enc) scene = {
        id: enc.id, name: enc.name, region: "探索发现",
        initialDescription: enc.description, detailLevel: 10,
        connections: [], npcs: [], secrets: [], discoveredSecrets: [],
      };
    }
    return {
      currentWorld: world,
      currentSceneId: snapshot.currentSceneId,
      currentScene: scene,
      gameTime: { ...snapshot.currentGameTime },
      playerName: snapshot.playerName || parseEntryContext(get().entryContext, world.id)?.playerName || '',
      // Identity is selected for the playthrough, outside time; a pre-selection root has no entry field yet.
      entryContext: parseEntryContext(snapshot.entryContext, world.id) ?? parseEntryContext(get().entryContext, world.id),
      sceneNarrative: snapshot.sceneNarrative ?? "",
      discoveredSecrets: snapshot.discoveredSecrets,
      worldFlags: { ...snapshot.worldFlags },
      gameplayResources: normalizeGameplayResources(world, snapshot.gameplayResources),
      gameplayModState: normalizeGameplayModState(world, snapshot.gameplayModState),
      documentHeads: structuredClone(snapshot.documentHeads ?? []), workspaceState: structuredClone(snapshot.workspaceState ?? {}),
      midoriAssetRegistry: loadWorldAssetRegistry(world, snapshot.midoriAssetRegistry ?? get().midoriAssetRegistry, get()),
      narrativeProgress: parseNarrativeBeat(snapshot.narrativeProgress) ?? null,
      chapterState: snapshot.chapterState?.worldId === world.id ? parseChapterState(snapshot.chapterState) : null,
      rewindMemory: parseRewindMemory(snapshot.rewindMemory),
      npcStates: npcProjection.npcStates,
      sceneDetailLevels: snapshot.sceneDetailLevels,
      visitedScenes: snapshot.visitedScenes ?? [],
      resolvedTimelineEvents: [...snapshot.resolvedTimelineEvents],
      deviatedEvents: { ...snapshot.deviatedEvents },
      history: get().history.slice(0, snapshot.historyLength),
      inventory: JSON.parse(JSON.stringify(snapshot.inventory ?? [])),
      clues: JSON.parse(JSON.stringify(snapshot.clues ?? [])),
      encyclopedia: JSON.parse(JSON.stringify(snapshotEncyclopedia)),
      availableActions: snapshot.availableActions ?? [],
      criticalFacts: snapshot.criticalFacts ?? [],
      questLog: snapshot.questLog ?? [],
      relationships: npcProjection.relationships,
      weather: (snapshot.weather ?? "晴") as Weather,
      protagonistState: snapshot.protagonistState ?? {
        health: "良好",
        mood: "平静",
        notes: "",
      },
      notebookEvents: snapshot.notebookEvents ?? [],
      causalProjections: (snapshot.causalProjections ?? []).map((cp: CausalProjection) => ({
        ...cp,
        rippleEffects: cp.rippleEffects.map((r: RippleEffect) => ({ ...r })),
      })),
      currentDirectorFrame: snapshot.lastDirectorFrame ?? null,
      directorAdviceOrigin: snapshot.directorAdviceOrigin ?? null,
      historyEpochPlan: snapshot.historyEpochPlan ?? null,
      npcBehaviors: npcProjection.npcBehaviors,
      diary: (snapshot.diary ?? []).map((d: any) => ({
        day: d.day,
        entries: [...d.entries],
        summary: d.summary,
        createdAt: d.createdAt
          ? { ...d.createdAt }
          : { day: 0, hour: 0, minute: 0 },
      })),
      npcPersonalities: npcProjection.npcPersonalities,
    };
  },

  restoreSnapshot: (snapshot) => {
    const restored = get().prepareSnapshotRestore(snapshot);
    if (restored) set(restored);
  },

  // ========== 已访问场景 ==========
  visitedScenes: [],

  // ========== 当前场景 ==========
  currentSceneId: "",
  currentScene: null,
  sceneNarrative: "",
  navigateToScene: (sceneId) => {
    const world = get().currentWorld;
    let targetSceneId = resolveSceneReference(world, sceneId);
    if (world && mapRoutes(world).some(route => route.from === get().currentSceneId && route.to === targetSceneId && route.status !== 'open')) return;
    let scene = targetSceneId ? getSceneById(world, targetSceneId) : null;

    if (!scene) {
      const fallbackSceneId = typeof sceneId === "string" ? sceneId.trim() : "";
      if (!fallbackSceneId) return;

      const enc = get().encyclopedia.find(
        (e: any) => e.id === fallbackSceneId && e.type === "location" && typeof e.name === "string"
      );
      if (!enc) return;

      targetSceneId = enc.id;
      if (enc)
        scene = {
          id: enc.id,
          name: enc.name,
          region: "探索发现",
          initialDescription: enc.description,
          detailLevel: 10,
          connections: [],
          npcs: [],
          secrets: [],
          discoveredSecrets: [],
        };
    }
    if (!targetSceneId) return;

    const visited = get().visitedScenes;
    if (!visited.includes(targetSceneId)) visited.push(targetSceneId);
    set({
      currentSceneId: targetSceneId,
      currentScene: scene,
      sceneNarrative: scene?.initialDescription ?? "",
      visitedScenes: [...visited],
    });
    get().ensureSceneBehaviors(targetSceneId);
  },
  setSceneNarrative: (narrative) => set({ sceneNarrative: narrative }),

  // ========== 玩家身份 ==========
  playerName: "",
  entryContext: null,
  setEntryContext: (context) => set({ entryContext: parseEntryContext(context, get().currentWorld?.id) }),
  identityOptions: [],
  setIdentityOptions: (options) => set({ identityOptions: options }),
  setPlayerName: (name) => set({ playerName: name }),

  // ========== AI 推荐行动 ==========
  availableActions: [],
  setAvailableActions: (actions) => set({ availableActions: actions }),

  // ========== 世界创建 ==========
  worldConcept: "",
  setWorldConcept: (concept) => set({ worldConcept: concept }),

  // ========== 笔记本事件 ==========
  notebookEvents: [],
  addNotebookEvent: (event) =>
    set((s) => ({ notebookEvents: [...s.notebookEvents, event] })),
  removeNotebookEvent: (index) =>
    set((s) => ({
      notebookEvents: s.notebookEvents.filter((_: string, i: number) => i !== index),
    })),

  // ========== 因果推演 ==========
  causalProjections: [] as CausalProjection[],

  setCausalProjections: (projections) =>
    set((s) => {
      // 去重：同 actionDescription 的旧预测替换为新预测
      const existing = s.causalProjections.filter(
        (cp: CausalProjection) =>
          !projections.some((p) => p.actionDescription === cp.actionDescription)
      );
      return { causalProjections: [...existing, ...projections] };
    }),

  resolveRippleEffect: (rippleId, status, note) => {
    // 终端通知：预测状态变更
    const projections = get().causalProjections as CausalProjection[];
    const allRipples = projections.flatMap((cp: CausalProjection) => cp.rippleEffects);
    const matched = allRipples.find((r: RippleEffect) => r.id === rippleId);
    if (matched) {
      const label = status === "fulfilled" ? "✅已实现" : status === "defied" ? "❌已打破" : "⏰已过期";
      console.log(
        `[因果预测] ${label}: "${matched.projectedOutcome}" → ${note || '无备注'}`
      );
    }

    set((s) => {
      const now = { ...get().gameTime };
      return {
        causalProjections: s.causalProjections.map((cp: CausalProjection) => ({
          ...cp,
          rippleEffects: cp.rippleEffects.map((r: RippleEffect) =>
            r.id === rippleId
              ? { ...r, status, resolvedAt: now, resolutionNote: note }
              : r
          ),
        })),
      };
    });
  },

  getCausalStats: () => {
    const projections = get().causalProjections as CausalProjection[];
    const allRipples = projections.flatMap((cp: CausalProjection) => cp.rippleEffects);
    const total = allRipples.length;
    const fulfilled = allRipples.filter((r: RippleEffect) => r.status === "fulfilled").length;
    const defied = allRipples.filter((r: RippleEffect) => r.status === "defied").length;
    const expired = allRipples.filter((r: RippleEffect) => r.status === "expired").length;
    const pending = allRipples.filter((r: RippleEffect) => r.status === "pending").length;
    const avgConfidence = total > 0
      ? Math.round((allRipples.reduce((sum: number, r: RippleEffect) => sum + r.confidence, 0) / total) * 100) / 100
      : 0;
    return { totalPredictions: total, fulfilled, defied, expired, pending, avgConfidence };
  },

  checkPendingProjections: (currentTime) => {
    const currentMins = timeToMinutes(currentTime);
    const s = get();
    const projections = s.causalProjections as CausalProjection[];
    let changed = false;
    const updated = projections.map((cp: CausalProjection) => ({
      ...cp,
      rippleEffects: cp.rippleEffects.map((r: RippleEffect) => {
        // 跳过已解决或已过期的
        if (r.status !== "pending") return r;
        const estMins = timeToMinutes(r.estimatedTime);
        // 预计时间已过 24 小时以上 → 标记过期
        if (currentMins - estMins > 24 * 60) {
          changed = true;
          console.log(
            `[因果预测] ⏰已过期: "${r.projectedOutcome}" → 预计第${r.estimatedTime.day}天${r.estimatedTime.hour}时，已过窗口期`
          );
          return { ...r, status: "expired" as const, resolvedAt: { ...currentTime }, resolutionNote: "预测时间窗口已过，未观察到预期事件" };
        }
        return r;
      }),
    }));
    if (changed) {
      set({ causalProjections: updated });
    }
  },

  // ========== 直接编辑 setter（创造模式） ==========
  setSceneDetailLevel: (sceneId, level) =>
    set((s) => ({
      sceneDetailLevels: {
        ...s.sceneDetailLevels,
        [sceneId]: Math.max(0, Math.min(100, level)),
      },
    })),
  deleteWorldFlag: (key) =>
    set((s) => {
      const { [key]: _, ...rest } = s.worldFlags;
      return { worldFlags: rest };
    }),
  setNpcBehaviorDirect: (name, behavior) =>
    set((s) => ({
      npcBehaviors: {
        ...s.npcBehaviors,
        [name]: { ...behavior },
      },
    })),
  setNpcStateDirect: (npcId, state) =>
    set((s) => ({
      npcStates: {
        ...s.npcStates,
        [npcId]: state,
      },
    })),
  setDirectorFrame: (frame, origin) =>
    set({ currentDirectorFrame: structuredClone(frame), directorAdviceOrigin: origin ? structuredClone(origin) : null }),

  removeDiscoveredSecret: (sceneId, index) =>
    set((s) => ({
      discoveredSecrets: {
        ...s.discoveredSecrets,
        [sceneId]:
          s.discoveredSecrets[sceneId]?.filter(
            (_: string, i: number) => i !== index
          ) ?? [],
      },
    })),
});
