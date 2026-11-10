import { writeActionNode } from '@/lib/game/worldline-action';
import { withWorldLineWrite } from '@/lib/game/worldline-persistence';
import type { ActionNodeOptions } from '@/lib/game/action-entry';
import { recordPresentationText } from '@/lib/game/presentation';
import { waitForWorkspaceBranchMerge } from '@/lib/game/workspace/branch';
import { reconcileAcceptedDocuments } from '@/lib/game/documents/repository';
import { currentDocumentScope } from '@/lib/game/model-documents';
import { matchesActionInput } from '@/lib/game/documents/action-draft';
import { mergePluginArchives } from '@/lib/game/plugins/package-history';
import { rewindPolicy, rewindTargets, rewindAnchors, rewindNodeLabel, assertGameRewind, resolveGameRewindTarget } from '@/lib/game/rewind';
import { prepareRewindArrival } from '@/lib/game/rewind-arrival';
import { waitForAcceptedActionNodeSave } from '@/lib/game/action-node-commit';
import { getReadingPath } from "@/lib/game/player-reading";
import { normalizeVoiceAssets, normalizeVoiceConfig } from "@/lib/game/momoi/model";
import { writeVoiceResources } from "@/lib/game/momoi/resource-storage";
import { normalizeGameplayResources } from "@/lib/game/plugins/resources";
// ============================================================
// Eidos · 世界线 Slice
// ============================================================
// 管理世界线树 (World → Playthrough → WorldLine Tree → Node)
// 每次玩家行动后创建一个新节点。
// 快照和分段通过 CAS (content-addressed storage) 去重存储。
// 元数据和节点结构通过 IndexedDB meta_data 持久化。
// ============================================================

import type {
  WorldLineNode,
  WorldLineMeta,
  WorldLineGroup,
  WorldLineExport,
  ReplayState,
  ReplayMode,
  WorldSnapshot,
  WorldDefinition,
  ActionRecord,
  GameTime,
  PlaythroughMeta,
} from "@/lib/game/types";
import type { StorySegment } from "@/lib/ai/types";
import type { WorldLineSummary } from "@/lib/ai/context-builder";
import {
  archiveScopeSessionValue,
  scopeStorageKey,
  type ArchiveScopeSource,
} from "@/lib/game/archive-scope";
import {
  computeContentHash,
  storeBlob,
  loadBlob,
  loadBlobs,
  batchDecrementRef,
} from "@/lib/game/cas-storage";
import { saveMeta, loadMeta } from "@/lib/game/storage";
import {
  buildWorldLineExport,
  importWorldLineExport,
  collectSubtreeNodeIds,
  type ImportWorldLineResult,
} from "@/lib/game/worldline-export";
import {
  computeWorldLineLayout,
  type WorldLineLayout,
} from "@/lib/game/worldline-layout";
import {
  createReplayState,
  startReplay,
  replayAdvance,
  getReplayCurrentNode,
  getReplaySnapshot,
  getReplaySegments,
  exitReplay,
} from "@/lib/game/worldline-replay";

// ============================================================
// 常量
// ============================================================

/** meta_data 中的世界线数据 key 前缀 */
const WL_META_PREFIX = "worldline_data_";
/** meta_data 中的世界线列表 key（按世界分） */
const WL_INDEX_PREFIX = "worldline_index_";

// ============================================================
// 接口
// ============================================================

export interface WorldLineSlice {
  // ===== 世界线树状态 =====
  worldLine: WorldLineMeta | null;
  allNodes: Record<string, WorldLineNode>;
  currentNode: WorldLineNode | null;

  setNodeReadText: (nodeId: string, text: string) => void;
  recordRewindFailure: (nodeId: string, target: string, reason: string) => void;
  setPlayerNpcNote: (nodeId: string, npcName: string, note: string) => void;
  addPlayerExcerpt: (nodeId: string, text: string, note: string, originId?: string) => void;
  updatePlayerExcerpt: (nodeId: string, excerptId: string, note: string) => void;
  removePlayerExcerpt: (nodeId: string, excerptId: string) => void;

  // ===== 重放状态 =====
  replayState: ReplayState;

  // ===== 树操作 =====
  /** 为新周目初始化一棵世界线树（创建根节点） */
  initWorldLine: (
    playthroughId: string,
    worldId: string
  ) => Promise<string>;
  /** 在当前分支末端添加一个动作节点 */
  addActionNode: (
    action: ActionRecord,
    snapshot: WorldSnapshot,
    segments: StorySegment[],
    options?: ActionNodeOptions,
  ) => Promise<WorldLineNode>;
  /** 删除节点及其所有子孙节点 */
  deleteSubtree: (nodeId: string) => Promise<number>;
  /** 回溯到指定节点（恢复游戏状态） */
  backtrackToNode: (nodeId: string, gameRequest?: { sourceNodeId: string; reason: string }) => Promise<void>;

  // ===== 查询 =====
  /** 获取按天分组的节点列表 */
  getNodeGroups: () => WorldLineGroup[];
  /** 计算 2D 世界线布局（UI 渲染用） */
  getWorldLineLayout: (expandedDayKey?: number | null) => WorldLineLayout;
  /** 获取某节点的所有直接子分支 */
  getBranchNodes: (parentNodeId: string) => WorldLineNode[];
  /** 检查当前节点是否有子节点匹配输入。有则直接导航（恢复快照+加载分段），返回匹配节点；无则返回 null */
  tryMatchChildNode: (playerInput: string, identity?: string, options?: { isCurrent(): boolean }) => Promise<WorldLineNode | null>;
  /** 预览节点内容（不恢复状态） */
  previewNode: (nodeId: string) => WorldLineNode | null;
  /** 获取当前世界线的 AI 上下文摘要 */
  getWorldLineSummary: () => WorldLineSummary | undefined;

  // ===== 持久化 =====
  persistWorldLineData: () => Promise<void>;
  loadWorldLine: (worldLineId: string) => Promise<boolean>;
  listWorldLines: (worldId: string) => Promise<WorldLineMeta[]>;

  // ===== 导出/导入 =====
  exportWorldLine: (rootNodeId: string) => Promise<WorldLineExport>;
  importWorldLine: (
    data: WorldLineExport,
    playthroughId: string,
    worldId: string
  ) => Promise<string>;

  // ===== 重放 =====
  startReplayMode: (importData: WorldLineExport, mode: ReplayMode) => void;
  replayStep: (
    playerInput: string
  ) => {
    nextNode: WorldLineNode | null;
    isDiverged: boolean;
    isEndReached: boolean;
  };
  exitReplayMode: () => void;
}

// ============================================================
// 辅助函数
// ============================================================

/** 生成节点 ID */
function genNodeId(): string {
  return `wl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 生成世界线 ID */
function genWorldLineId(): string {
  return `worldline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 获取世界线数据的 meta key */
function wlMetaKey(worldLineId: string): string {
  return `${WL_META_PREFIX}${worldLineId}`;
}

/** 获取世界的世界线索引 key */
function wlIndexKey(worldId: string): string {
  return `${WL_INDEX_PREFIX}${worldId}`;
}

function scopedWlMetaKey(state: ArchiveScopeSource, worldLineId: string): string {
  return scopeStorageKey(state, wlMetaKey(worldLineId));
}

function scopedWlIndexKey(state: ArchiveScopeSource, worldId: string): string {
  return scopeStorageKey(state, wlIndexKey(worldId));
}

interface LiveWorldLineScope {
  archiveScope: string;
  worldId: string | null;
  playthroughId: string | null;
  worldLineId: string | null;
  parentNodeId: string | null;
}

function captureLiveWorldLineScope(
  state: ArchiveScopeSource & Record<string, any>,
  worldLineId: string | null,
  parentNodeId: string | null,
): LiveWorldLineScope {
  return {
    archiveScope: archiveScopeSessionValue(state),
    worldId: state.currentWorld?.id ?? null,
    playthroughId: state.currentPlaythroughId ?? null,
    worldLineId,
    parentNodeId,
  };
}

function isStillLiveWorldLineScope(
  state: ArchiveScopeSource & Record<string, any>,
  scope: LiveWorldLineScope,
): boolean {
  return (
    archiveScopeSessionValue(state) === scope.archiveScope &&
    (state.currentWorld?.id ?? null) === scope.worldId &&
    (state.currentPlaythroughId ?? null) === scope.playthroughId &&
    (state.worldLine?.id ?? null) === scope.worldLineId &&
    (state.currentNode?.id ?? null) === scope.parentNodeId
  );
}

function prepareNodeSnapshotRestore(
  state: { currentWorld?: WorldDefinition | null; prepareSnapshotRestore?: (snapshot: WorldSnapshot) => Record<string, unknown> | null },
  snapshot: WorldSnapshot | null,
): Record<string, unknown> | null {
  if (!snapshot) throw new Error("快照加载失败");
  if (snapshot.worldId !== state.currentWorld?.id) throw new Error("记录不属于当前世界");
  // A rejected restore must not leave a persisted target paired with the old live state.
  if (state.prepareSnapshotRestore) {
    const prepared = state.prepareSnapshotRestore(snapshot);
    if (!prepared) throw new Error("快照恢复失败");
    return prepared;
  }
  // The slice can also be embedded with a legacy restore callback.
  normalizeGameplayResources(state.currentWorld ?? {}, snapshot.gameplayResources);
  return null;
}

// ============================================================
// Slice 实现
// ============================================================


function historyAtNode(nodes: Record<string, WorldLineNode>, nodeId: string): ActionRecord[] {
  return getReadingPath(nodes, nodeId).filter(item => item.parentId !== null || item.aiResponse.trim()).map(item => ({
      id: item.actionId ?? item.id, timestamp: item.createdAt, directorCues: item.directorCues,
      sourceResponse: item.aiResponse,
      playerInput: item.playerInput, aiResponse: recordPresentationText({...item,playerVisibleText:item.aiResponse},nodes,nodeId), summary: item.summary,
      gameTime: { ...item.gameTime }, sceneId: item.sceneId, sceneName: item.sceneName,
      timeSpent: { ...item.timeSpent }, worldImpacts: [...item.worldImpacts],
      availableActions: item.availableActions, snapshot: null,
      inputDocuments: item.inputDocuments, outputDocuments: item.outputDocuments, inputIdentity: item.inputIdentity, workspaceEffects: item.workspaceEffects, workspaceBranch: item.workspaceBranch,
    }));
}

export const createWorldLineSlice = (
  set: (
    partial:
      | Record<string, any>
      | ((state: Record<string, any>) => Record<string, any>)
  ) => void,
  get: () => any
): WorldLineSlice => ({
  worldLine: null,
  recordRewindFailure: (nodeId, target, reason) => {
    const state = get(), node = state.allNodes[nodeId] as WorldLineNode | undefined;
    if (!node || state.currentNode?.id !== nodeId) return;
    const updated = { ...node, rewindFailure: { target: target.slice(0, 160), reason: reason.slice(0, 1600) } };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, currentNode: updated });
  },
  setPlayerNpcNote: (nodeId, npcName, note) => {
    const state = get();
    const node = state.allNodes[nodeId] as WorldLineNode | undefined;
    if (!node || state.currentNode?.id !== nodeId || !npcName.trim()) return;
    // Notes belong to the player's current branch, never to the simulated character.
    const updated = { ...node, playerNpcNotes: { ...node.playerNpcNotes, [npcName]: note.trim() } };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, currentNode: updated });
  },
  setNodeReadText: (nodeId, text) => {
    const state = get();
    const node = state.allNodes[nodeId] as WorldLineNode | undefined;
    if (!node || !node.aiResponse.startsWith(text) || text.length <= (node.playerVisibleText?.length ?? 0)) return;
    const updated = { ...node, playerVisibleText: text };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, ...(state.currentNode?.id === nodeId ? { currentNode: updated } : {}) });
  },
  addPlayerExcerpt: (nodeId, text, note, originId) => {
    const state = get();
    const node = state.allNodes[nodeId] as WorldLineNode | undefined;
    const quote = text.trim();
    if (originId && !getReadingPath(state.allNodes,originId).some(n=>n.id===nodeId)) return;
    if (!node || !quote || !recordPresentationText(node,state.allNodes,originId ?? state.currentNode?.id).includes(quote)) return;
    const excerpts = node.playerExcerpts ?? [];
    if (excerpts.some(entry => entry.text === quote && entry.note === note.trim())) return;
    const updated = { ...node, playerExcerpts: [...excerpts, { id: crypto.randomUUID(), text: quote, note: note.trim() }] };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, ...(state.currentNode?.id === nodeId ? { currentNode: updated } : {}) });
  },
  updatePlayerExcerpt: (nodeId, excerptId, note) => {
    const state = get();
    const node = state.allNodes[nodeId] as WorldLineNode | undefined;
    if (!node?.playerExcerpts?.some(entry => entry.id === excerptId)) return;
    const updated = { ...node, playerExcerpts: node.playerExcerpts.map(entry => entry.id === excerptId ? { ...entry, note: note.trim() } : entry) };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, ...(state.currentNode?.id === nodeId ? { currentNode: updated } : {}) });
  },
  removePlayerExcerpt: (nodeId, excerptId) => {
    const state = get();
    const node = state.allNodes[nodeId] as WorldLineNode | undefined;
    if (!node) return;
    const updated = { ...node, playerExcerpts: (node.playerExcerpts ?? []).filter(entry => entry.id !== excerptId) };
    set({ allNodes: { ...state.allNodes, [nodeId]: updated }, ...(state.currentNode?.id === nodeId ? { currentNode: updated } : {}) });
  },
  allNodes: {},
  currentNode: null,
  replayState: createReplayState(),

  // ============================================================
  // 树操作
  // ============================================================

  initWorldLine: async (playthroughId, worldId) => {
    const state = get();
    // 1. 先检查此周目是否已有世界线（从索引中查找）
    const existingLines = (await loadMeta<WorldLineMeta[]>(scopedWlIndexKey(state, worldId))) ?? [];
    const existing = existingLines.find((wl) => wl.playthroughId === playthroughId);

    if (existing) {
      // 已有世界线 → 直接加载，不重建（防止退出标题后数据丢失）
      const data = await loadMeta<{
        meta: WorldLineMeta;
        nodes: Record<string, WorldLineNode>;
      }>(scopedWlMetaKey(state, existing.id));

      if (data) {
        set({
          ...(state.currentWorld ? { currentWorld: mergePluginArchives(state.currentWorld, data.meta.gameplayPluginHistory) } : {}),
          worldLine: data.meta,
          allNodes: data.nodes,
          currentNode: data.nodes[data.meta.currentNodeId] ?? null,
        });
        return existing.id;
      }
    }

    // 2. 没有已有数据 → 创建新的世界线树
    const now = Date.now();
    const worldLineId = genWorldLineId();

    // 创建根节点（游戏开始点，还没有行动）
    const rootNode: WorldLineNode = {
      id: genNodeId(),
      parentId: null,
      stepNumber: 0,

      playerInput: "",
      aiResponse: "",
      summary: "游戏开始",

      snapshotHash: "",
      segmentHash: "",

      childIds: [],

      createdAt: now,
      gameTime: { day: 0, hour: 8, minute: 0 },
      sceneId: "",
      sceneName: "",
      dayNumber: 0,

      timeSpent: { day: 0, hour: 0, minute: 0 },
      worldImpacts: [],
      generationComplete: true, // 根节点无中断场景
    };

    const meta: WorldLineMeta = {
      id: worldLineId,
      playthroughId,
      worldId,
      rootNodeId: rootNode.id,
      allNodeIds: [rootNode.id],
      currentNodeId: rootNode.id,
      branchCount: 0,
      totalSteps: 0,
      createdAt: now,
      updatedAt: now,
    };

    // 持久化
    const nodes: Record<string, WorldLineNode> = {};
    nodes[rootNode.id] = rootNode;
    await saveMeta(scopedWlMetaKey(state, worldLineId), { meta, nodes });

    // 更新世界线索引
    const index = (await loadMeta<WorldLineMeta[]>(scopedWlIndexKey(state, worldId))) ?? [];
    index.push(meta);
    await saveMeta(scopedWlIndexKey(state, worldId), index);

    set({
      worldLine: meta,
      allNodes: nodes,
      currentNode: rootNode,
    });

    return worldLineId;
  },

  addActionNode: async (action, snapshot, segments, options) => {
    const state = get();
    let wl = state.worldLine as WorldLineMeta | null;

    // 自动修复：世界线未初始化时尝试加载或创建
    if (!wl) {
      const ptId = state.currentPlaythroughId as string | null;
      const worldId = state.currentWorld?.id as string | null;
      if (ptId && worldId) {
        console.warn("[WorldLine] 世界线未初始化，尝试自动修复...");
        // 尝试加载已有世界线
        const existingLines = (await loadMeta<WorldLineMeta[]>(scopedWlIndexKey(state, worldId))) ?? [];
        const existing = existingLines.find((wl2) => wl2.playthroughId === ptId);
        if (existing) {
          const data = await loadMeta<{ meta: WorldLineMeta; nodes: Record<string, WorldLineNode> }>(scopedWlMetaKey(state, existing.id));
          if (data) {
            set({ ...(state.currentWorld ? { currentWorld: mergePluginArchives(state.currentWorld, data.meta.gameplayPluginHistory) } : {}), worldLine: data.meta, allNodes: data.nodes, currentNode: data.nodes[data.meta.currentNodeId] ?? null });
            wl = data.meta;
          }
        }
        // 如果还是没有，创建一个新的
        if (!wl) {
          const newId = await (get() as any).initWorldLine?.(ptId, worldId);
          if (newId) {
            const freshState = get();
            wl = freshState.worldLine as WorldLineMeta | null;
          }
        }
      }
      if (!wl) throw new Error("世界线未初始化，自动修复失败");
    }

    const currentNodes = { ...(get().allNodes as Record<string, WorldLineNode>) };
    const parentNode = currentNodes[options?.parentNodeId ?? wl.currentNodeId] ?? null;
    if (!parentNode) throw new Error("当前节点不存在");
    const liveScope = captureLiveWorldLineScope(get(), wl.id, options?.expectedHeadId ?? get().currentNode?.id ?? parentNode.id);

    // ============================================================
    // 关键修复：检查是否已有子节点匹配当前输入
    // 如果父节点已有 childIds，遍历它们，找出 playerInput 完全匹配的节点
    // ============================================================
    const existingChild = options?.reuseExisting === false || rewindPolicy(state.currentWorld) ? undefined : parentNode.childIds
      .map((cid) => currentNodes[cid])
      .find((child) => child && (child.actionId === action.id || !child.entry && !options?.entry && matchesActionInput(child, action.playerInput, action.inputIdentity)));

    if (existingChild) {
      // 已有匹配的子节点 → 直接导航到该节点，不创建新节点
      console.log(
        `[WorldLine] 复用已有子节点: "${existingChild.playerInput}" → ${existingChild.id}`
      );

      if (!isStillLiveWorldLineScope(get(), liveScope)) {
        return existingChild;
      }

      if (!existingChild.snapshotHash) throw new Error("节点没有快照数据");
      const snap = (await loadBlob(existingChild.snapshotHash)) as WorldSnapshot | null;
      if (!isStillLiveWorldLineScope(get(), liveScope)) return existingChild;
      const restored = prepareNodeSnapshotRestore(state, snap);

      // 加载该节点的 segments（用于 UI 显示）
      let loadedSegments: StorySegment[] = [];
      if (existingChild.segmentHash) {
        loadedSegments =
          ((await loadBlob(existingChild.segmentHash)) as StorySegment[]) ?? [];
      }
      if (!isStillLiveWorldLineScope(get(), liveScope)) {
        return existingChild;
      }

      // 更新 currentNodeId（不改变树结构）
      const updatedMeta: WorldLineMeta = {
        ...wl,
        currentNodeId: existingChild.id,
        updatedAt: Date.now(),
      };
      await saveMeta(scopedWlMetaKey(state, wl.id), { meta: updatedMeta, nodes: currentNodes });
      if (!isStillLiveWorldLineScope(get(), liveScope)) return existingChild;
      if (!restored) state.restoreSnapshot?.(snap);

      set({
        ...restored,
        worldLine: updatedMeta,
        currentNode: existingChild,
        history: historyAtNode(currentNodes, existingChild.id),
        // 加载 segments 到 GameScreen 用于显示
        savedSegments: loadedSegments,
        savedSegmentIndex: 0,
        savedIsShowingSegments: loadedSegments.length > 0,
      });

      return existingChild;
    }

    return writeActionNode({get,set,action,snapshot,segments,options});
  },

  deleteSubtree: async (nodeId) => {
    const state = get();
    if (rewindPolicy(state.currentWorld)) throw new Error('回溯能力模式保留完整经历，不能在游玩中删除历史分支');
    const wl = state.worldLine as WorldLineMeta | null;
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    if (!wl || !nodes[nodeId]) return 0;

    // 1. 收集子树中所有节点
    const subtreeIds = collectSubtreeNodeIds(nodes, nodeId);
    const subtreeSet = new Set(subtreeIds);

    // 2. 收集要 decrement 的 CAS hash
    const snapshotHashes = new Set<string>();
    const segmentHashes = new Set<string>();
    for (const nid of subtreeIds) {
      const node = nodes[nid];
      if (node?.snapshotHash) snapshotHashes.add(node.snapshotHash);
      if (node?.entry?.snapshotHash) snapshotHashes.add(node.entry.snapshotHash);
      if (node?.segmentHash) segmentHashes.add(node.segmentHash);
    }

    // 3. 从父节点移除引用
    const targetNode = nodes[nodeId];
    const updatedNodes = { ...nodes };
    if (targetNode.parentId && updatedNodes[targetNode.parentId]) {
      updatedNodes[targetNode.parentId] = {
        ...updatedNodes[targetNode.parentId],
        childIds: updatedNodes[targetNode.parentId].childIds.filter(
          (cid) => cid !== nodeId
        ),
      };
    }

    // 4. 删除子树中所有节点
    for (const nid of subtreeIds) {
      delete updatedNodes[nid];
    }

    // 5. 更新 meta
    const updatedMeta: WorldLineMeta = {
      ...wl,
      allNodeIds: wl.allNodeIds.filter((nid) => !subtreeSet.has(nid)),
      totalSteps: wl.totalSteps - subtreeIds.length + 1, // +1 for root node
      branchCount: Math.max(
        0,
        wl.branchCount -
          subtreeIds.filter((nid) => {
            const n = nodes[nid];
            return n && n.parentId && nodes[n.parentId]?.childIds.length > 1;
          }).length
      ),
      updatedAt: Date.now(),
    };

    // 6. 如果删除的子树包含当前节点，回溯到父节点
    if (subtreeSet.has(wl.currentNodeId) && targetNode.parentId) {
      updatedMeta.currentNodeId = targetNode.parentId;
    }

    // 7. 持久化
    await saveMeta(scopedWlMetaKey(state, wl.id), {
      meta: updatedMeta,
      nodes: updatedNodes,
    });

    // 8. GC：递减 CAS 引用
    await batchDecrementRef([...snapshotHashes]);
    await batchDecrementRef([...segmentHashes]);

    set({
      worldLine: updatedMeta,
      allNodes: updatedNodes,
      currentNode:
        subtreeSet.has(wl.currentNodeId)
          ? targetNode.parentId
            ? updatedNodes[targetNode.parentId] ?? null
            : null
          : state.currentNode,
    });

    return subtreeIds.length;
  },

  backtrackToNode: async (nodeId, gameRequest) => {
    const before = get();
    const barrier = captureLiveWorldLineScope(before, before.worldLine?.id ?? null, before.currentNode?.id ?? null);
    const write = waitForAcceptedActionNodeSave(get);
    if (write) {
      const committed = await write;
      if (committed) barrier.parentNodeId = committed.id;
      if (!isStillLiveWorldLineScope(get(), barrier)) return;
    }
    const branchWrite = waitForWorkspaceBranchMerge(get);
    if (branchWrite) await branchWrite;
    const state = get();
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const policy = rewindPolicy(state.currentWorld);
    if (gameRequest && policy) nodeId = resolveGameRewindTarget({ world: state.currentWorld, nodes,
      currentId: state.currentNode?.id ?? null, reference: nodeId,
      // The request action is already persisted; relative words still refer to the player's input origin.
      relativeToNodeId: nodes[gameRequest.sourceNodeId]?.parentId ?? null });
    const node = nodes[nodeId];
    if (!node) throw new Error("节点不存在");
    const checkAbility = () => {
      if (gameRequest?.sourceNodeId !== get().currentNode?.id) throw new Error('回溯请求已过期，当前经历已变化');
      return assertGameRewind({ world: get().currentWorld, nodes: get().allNodes, currentId: get().currentNode?.id ?? null,
        flags: get().worldFlags, targetId: nodeId, gameRequest: !!gameRequest });
    };
    if (policy) { if (!gameRequest) throw new Error('回溯能力由游戏判断发动；回看不会改变当前进度。'); checkAbility(); }
    else if (gameRequest) throw new Error('当前世界没有声明回溯能力');

    const scope = captureLiveWorldLineScope(state, state.worldLine?.id ?? null, state.currentNode?.id ?? null);
    // 1. 从 CAS 加载快照
    if (!node.snapshotHash) throw new Error("节点没有快照数据");

    let snapshot = (await loadBlob(node.snapshotHash)) as WorldSnapshot | null;
    if (!isStillLiveWorldLineScope(get(), scope)) return;
    let restored = prepareNodeSnapshotRestore(state, snapshot);

    // 先读齐快照与文本，避免文本读取失败时只恢复了一半状态。
    const loaded = node.segmentHash ? (await loadBlob(node.segmentHash)) as StorySegment[] | null : null;
    if (!isStillLiveWorldLineScope(get(), scope)) return;
    if (policy && node.segmentHash && !loaded) throw new Error('目标正文缺失，尚未执行回溯');
    const segments: StorySegment[] = loaded?.length ? loaded : node.aiResponse ? [{ type: "narration", text: node.aiResponse }] : [];
    let destination = node, restoredNodes = nodes;
    if (policy && gameRequest) {
      checkAbility();
      const arrival = await prepareRewindArrival({ world: state.currentWorld, nodes, source: state.currentNode, target: node,
        current: state.createSnapshot(), snapshot: snapshot!, segments, policy, reason: gameRequest.reason });
      if (!isStillLiveWorldLineScope(get(), scope)) return;
      checkAbility();
      destination = arrival.node; snapshot = arrival.snapshot;
      restored = prepareNodeSnapshotRestore(state, snapshot);
      restoredNodes = { ...get().allNodes, [node.id]: { ...node, childIds: [...node.childIds, destination.id] }, [destination.id]: destination };
    }
    // 向前或跨分支切换时，当前 history 可能已经被回溯裁短，不能再只按长度截取。
    const history = historyAtNode(restoredNodes, destination.id);
    const wl = state.worldLine as WorldLineMeta | null;
    const updatedMeta = wl ? { ...wl, currentNodeId: destination.id, updatedAt: Date.now(),
      ...(policy ? { allNodeIds: [...wl.allNodeIds, destination.id], totalSteps: wl.totalSteps + 1, branchCount: wl.branchCount + 1 } : {}) } : null;
    if (!isStillLiveWorldLineScope(get(), scope)) return;
    if (updatedMeta) await saveMeta(scopedWlMetaKey(state, updatedMeta.id), { meta: updatedMeta, nodes: restoredNodes });
    if (!isStillLiveWorldLineScope(get(), scope)) return;
    if (!restored) state.restoreSnapshot?.(snapshot);
    set({
      ...restored,
      ...(updatedMeta ? { worldLine: updatedMeta } : {}),
      ...(policy ? { allNodes: restoredNodes } : {}),
      currentNode: destination, phase: "playing",
      readingView:null,readingSegments:null,
      history,
      availableActions: [...(node.availableActions ?? [])],
      savedSegments: segments, savedSegmentIndex: 0, savedIsShowingSegments: false,
    });
  },

  // ============================================================
  // 查询
  // ============================================================

  getNodeGroups: () => {
    const state = get();
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const wl = state.worldLine as WorldLineMeta | null;
    if (!wl) return [];

    // 从根节点 BFS 遍历主路径（第一个子节点），收集主线和分支根
    const groups = new Map<number, WorldLineGroup>();
    const visited = new Set<string>();
    const queue = [wl.rootNodeId];

    while (queue.length > 0) {
      const nid = queue.shift()!;
      if (visited.has(nid)) continue;
      visited.add(nid);

      const node = nodes[nid];
      if (!node) continue;

      const day = node.dayNumber;
      if (!groups.has(day)) {
        groups.set(day, { day, nodeIds: [], branchRootIds: [] });
      }
      const group = groups.get(day)!;

      // 判断是否为主路径节点（父节点的第一个子节点，或根节点）
      const isMainPath =
        !node.parentId ||
        (nodes[node.parentId]?.childIds[0] === nid);

      if (isMainPath) {
        group.nodeIds.push(nid);
      } else {
        // 分支根节点
        group.branchRootIds.push(nid);
      }

      // 继续遍历所有子节点
      for (const cid of node.childIds) {
        if (!visited.has(cid)) queue.push(cid);
      }
    }

    // 按天排序
    return [...groups.values()].sort((a, b) => a.day - b.day);
  },

  getBranchNodes: (parentNodeId) => {
    const state = get();
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const parent = nodes[parentNodeId];
    if (!parent) return [];
    return parent.childIds
      .slice(1) // 第一个子节点是主路径
      .map((cid) => nodes[cid])
      .filter(Boolean);
  },

  /**
   * 检查当前节点的所有子节点中是否有与输入匹配的。
   * 如果有：恢复该子节点的快照、加载分段、更新 currentNodeId，并返回该节点。
   * 如果没有：返回 null。
   *
   * 调用时机：handleSubmit 中，在发送 AI 请求之前。
   */
  tryMatchChildNode: async (playerInput, identity, options) => {
    const state = get();
    if (options && !options.isCurrent()) return null;
    if (rewindPolicy(state.currentWorld)) return null;
    const wl = state.worldLine as WorldLineMeta | null;
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const current = state.currentNode as WorldLineNode | null;

    if (!wl || !current || current.childIds.length === 0) return null;

    // 遍历当前节点的所有子节点，找 playerInput 完全匹配的
    const matchedChild = current.childIds
      .map((cid) => nodes[cid])
      .find((child) => child && !child.entry && matchesActionInput(child, playerInput, identity));

    if (!matchedChild) return null;
    const scope = captureLiveWorldLineScope(state, wl.id, current.id);
    // The waiting page can be cancelled while CAS reads are still in progress.
    const isCurrent = () => isStillLiveWorldLineScope(get(), scope) && (!options || options.isCurrent());

    console.log(
      `[WorldLine] 🎯 匹配已有节点: "${playerInput}" → ${matchedChild.id} ` +
      `(第${matchedChild.dayNumber}天 步${matchedChild.stepNumber})`
    );

    if (!matchedChild.snapshotHash) throw new Error("节点没有快照数据");
    const snap = (await loadBlob(matchedChild.snapshotHash)) as WorldSnapshot | null;
    if (!isCurrent()) return null;
    const restored = prepareNodeSnapshotRestore(state, snap);

    // 加载分段（UI 显示）
    let loadedSegments: StorySegment[] = [];
    if (matchedChild.segmentHash) {
      loadedSegments =
        ((await loadBlob(matchedChild.segmentHash)) as StorySegment[]) ?? [];
    }
    if (!isCurrent()) return null;

    // 更新 currentNodeId
    const updatedMeta: WorldLineMeta = {
      ...wl,
      currentNodeId: matchedChild.id,
      updatedAt: Date.now(),
    };
    await saveMeta(scopedWlMetaKey(state, wl.id), { meta: updatedMeta, nodes });
    if (!isCurrent()) return null;
    if (!restored) state.restoreSnapshot?.(snap);

    set({
      ...restored,
      worldLine: updatedMeta,
      currentNode: matchedChild,
      history: historyAtNode(nodes, matchedChild.id),
      ...(matchedChild.availableActions?.length
        ? { availableActions: [...matchedChild.availableActions] }
        : matchedChild.playerInput ? { availableActions: [matchedChild.playerInput] } : {}),
      savedSegments: loadedSegments,
      savedSegmentIndex: 0,
      savedIsShowingSegments: loadedSegments.length > 0,
    });

    return matchedChild;
  },

  getWorldLineLayout: (expandedDayKey) => {
    const state = get();
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const wl = state.worldLine as WorldLineMeta | null;
    if (!wl || !wl.rootNodeId) {
      return { nodes: [], edges: [], dayColumns: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 } };
    }
    return computeWorldLineLayout(nodes, wl.rootNodeId, expandedDayKey ?? null);
  },

  previewNode: (nodeId) => {
    const state = get();
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    return nodes[nodeId] ?? null;
  },

  getWorldLineSummary: () => {
    const state = get();
    const wl = state.worldLine as WorldLineMeta | null;
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    const current = state.currentNode as WorldLineNode | null;

    if (!wl || !current) return undefined;

    let depth = 0;
    let cursor: WorldLineNode | undefined = nodes[current.id];
    while (cursor?.parentId) {
      depth += 1;
      cursor = nodes[cursor.parentId];
    }

    const policy = rewindPolicy(state.currentWorld);
    const targets = policy ? rewindTargets(state.currentWorld, nodes, current.id) : [];
    const hints = policy ? [...new Map([...rewindAnchors(state.currentWorld, nodes, current.id), ...targets.slice(-5)].map(node => [node.id, node])).values()] : Object.values(nodes);
    const backtrackableNodes = hints
      .filter((node) => (rewindPolicy(state.currentWorld) || Boolean(node.label)) && node.id !== current.id)
      .slice(0, 8)
      .map((node) => ({
        id: node.id,
        label: rewindNodeLabel(node) ?? node.sceneName ?? "循环起点",
        stepNumber: node.stepNumber,
        summary: node.summary,
      }));

    const siblingBranches = current.parentId && !rewindPolicy(state.currentWorld)
      ? Object.values(nodes)
          .filter(
            (node) => node.parentId === current.parentId && node.id !== current.id,
          )
          .slice(0, 3)
          .map((node) => ({
            id: node.id,
            label: node.label,
            summary: node.summary,
          }))
      : [];

    return {
      currentNodeId: current.id,
      stepNumber: current.stepNumber,
      depth,
      branchCount: wl.branchCount,
      backtrackableNodes,
      siblingBranches,
      rewindFailure: getReadingPath(nodes, current.id).reverse().find(node => node.rewindFailure)?.rewindFailure,
    };
  },

  // ============================================================
  // 持久化
  // ============================================================

  persistWorldLineData: async () => {
    const state = get();
    const wl = state.worldLine as WorldLineMeta | null;
    if (!wl) return;

    const key=scopedWlMetaKey(state,wl.id);
    await withWorldLineWrite(key,async()=>{
      // Capture inside the queue: a pending action may publish its node before
      // this page/read save runs. A captured old head would erase that action.
      const live=get();
      if(live.worldLine?.id!==wl.id || scopedWlMetaKey(live,wl.id)!==key) return;
      await saveMeta(key,{meta:live.worldLine,nodes:live.allNodes});
    });
  },

  loadWorldLine: async (worldLineId) => {
    const state = get();
    const data = await loadMeta<{
      meta: WorldLineMeta;
      nodes: Record<string, WorldLineNode>;
    }>(scopedWlMetaKey(state, worldLineId));

    if (!data) return false;
    const documentScope = currentDocumentScope(state);
    if (documentScope) await reconcileAcceptedDocuments(documentScope, data.nodes);

    set({
      ...(state.currentWorld ? { currentWorld: mergePluginArchives(state.currentWorld, data.meta.gameplayPluginHistory) } : {}),
      worldLine: data.meta,
      allNodes: data.nodes,
      currentNode: data.nodes[data.meta.currentNodeId] ?? null,
    });

    return true;
  },

  listWorldLines: async (worldId) => {
    const state = get();
    const index =
      (await loadMeta<WorldLineMeta[]>(scopedWlIndexKey(state, worldId))) ?? [];
    return index.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  // ============================================================
  // 导出/导入
  // ============================================================

  exportWorldLine: async (rootNodeId) => {
    const state = get();
    const wl = state.worldLine as WorldLineMeta | null;
    const nodes = state.allNodes as Record<string, WorldLineNode>;
    if (!wl) throw new Error("世界线未初始化");

    return buildWorldLineExport({
      documentScope: currentDocumentScope({ currentWorld: state.currentWorld, currentPlaythroughId: state.currentPlaythroughId, sandboxMode: state.sandboxMode, sandboxDossierId: state.sandboxDossierId }) ?? undefined,
      archiveScope: state,
      voiceAssets: state.voiceAssets,
      voiceConfig: state.voiceConfig,
      meta: wl,
      allNodes: nodes,
      world: state.currentWorld as WorldDefinition,
      playerName: state.playerName ?? "",
      rootNodeId,
      loadSnapshot: (hash) => loadBlob(hash) as Promise<any>,
      loadSegments: (hash) => loadBlob(hash) as Promise<any[]>,
      loadBlobs,
    });
  },

  importWorldLine: async (data, playthroughId, worldId) => {
    const state = get();
    const result: ImportWorldLineResult = await importWorldLineExport(
      data,
      worldId,
      playthroughId,
      state
    );

    if (data.voiceAssets && Object.keys(data.voiceAssets).length) {
      await writeVoiceResources(scopeStorageKey(state, JSON.stringify([worldId, playthroughId])), normalizeVoiceAssets(data.voiceAssets));
    }
    // 持久化
    await saveMeta(scopedWlMetaKey(state, result.worldLineId), {
      meta: result.meta,
      nodes: result.allNodes,
    });

    // 更新索引
    const index =
      (await loadMeta<WorldLineMeta[]>(scopedWlIndexKey(state, worldId))) ?? [];
    index.push(result.meta);
    await saveMeta(scopedWlIndexKey(state, worldId), index);

    return result.worldLineId;
  },

  // ============================================================
  // 重放
  // ============================================================

  startReplayMode: (importData, mode) => {
    const newState = startReplay(createReplayState(), importData, mode);
    set({ replayState: newState, voiceAssets: normalizeVoiceAssets(importData.voiceAssets), voiceAssetScope: null, voiceConfig: normalizeVoiceConfig(importData.voiceConfig), voiceSession: (get().voiceSession ?? 0) + 1, momoiStatus: "unverified", voiceServiceMessage: "", voiceServiceCheckedAt: null, voiceServiceGenerating: 0 });
  },

  replayStep: (playerInput) => {
    const state = get();
    const rs = state.replayState as ReplayState;

    const { nextState, nextNode, isDiverged, isEndReached } = replayAdvance(
      rs,
      playerInput
    );

    set({ replayState: nextState });
    return { nextNode, isDiverged, isEndReached };
  },

  exitReplayMode: () => {
    set({ replayState: createReplayState() });
  },
});
