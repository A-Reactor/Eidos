// ============================================================
// Eidos · AI 管线生命周期管理
// ============================================================
// 跨模块共享的状态管理，确保：
//   1. 切换子面板（背包/线索/设置等）→ 流继续运行
//   2. 退出游戏（标题/世界选择）→ 流被终止，防止污染新游戏
//   3. ALICE 与关键 KEI 审核占用行动门控，普通后台意见不占用
// ============================================================

import { hasBlockingKeiReviews, cancelKeiQueue } from "@/lib/ai/kei-review";
import { appendKeiReviewAudit } from "@/lib/ai/kei-review-audit";
import type { AIGameResponse, KeiReviewOrigin, KeiNarrativeReviewContext } from "@/lib/ai/types";
import type { WorldDefinition, WorldSnapshot } from "@/lib/game/types";
import type { CreativeModeConfig } from "@/lib/game/types";
import {
  archiveScopeSessionValue,
  type ArchiveScopeSource,
} from "@/lib/game/archive-scope";

export interface StreamRequestScope {
  requestId: string;
  worldId: string | null;
  playthroughId: string | null;
  worldLineId: string | null;
  nodeId: string | null;
  sceneId: string | null;
  archiveScope: string;
}

export interface StreamScopeSource extends ArchiveScopeSource {
  currentWorld?: { id?: string | null } | null;
  currentPlaythroughId?: string | null;
  worldLine?: { id?: string | null } | null;
  currentNode?: { id?: string | null } | null;
  currentSceneId?: string | null;
}

export interface PendingStreamResult {
  introspection?: boolean;
  event: unknown;
  input: string;
  scope?: StreamRequestScope;
  /** Client-side predictions are charged on completion, before their result is adopted. */
  usageAlreadyRecorded?: boolean;
}

export type StreamContinuationScope = Omit<StreamRequestScope, "requestId"> | StreamRequestScope;

let _activeStream: { controller: AbortController; scope: StreamRequestScope | null } | null = null;
let _pendingResult: PendingStreamResult | null = null;
let _busy = false;
let _nextRequestSeq = 0;
const pendingResultSubscribers = new Set<() => void>();
const initialActionAttempts = new Set<string>();

/** Switching panels must not turn an intentionally stopped first action into another paid request. */
export function claimInitialActionAttempt(source: StreamScopeSource): boolean {
  const key = JSON.stringify([source.currentWorld?.id ?? null, source.currentPlaythroughId ?? null, archiveScopeSessionValue(source)]);
  if (initialActionAttempts.has(key)) return false;
  initialActionAttempts.add(key);
  return true;
}

export function subscribePendingResult(callback: () => void): () => void {
  pendingResultSubscribers.add(callback);
  return () => { pendingResultSubscribers.delete(callback); };
}

export function createStreamRequestScope(source: StreamScopeSource): StreamRequestScope {
  _nextRequestSeq += 1;
  return {
    requestId: `stream_${Date.now()}_${_nextRequestSeq}`,
    ...createStreamContinuationScope(source),
  };
}

export function createStreamContinuationScope(source: StreamScopeSource): StreamContinuationScope {
  return {
    worldId: source.currentWorld?.id?.trim() || null,
    playthroughId: source.currentPlaythroughId?.trim() || null,
    worldLineId: source.worldLine?.id?.trim() || null,
    nodeId: source.currentNode?.id?.trim() || null,
    sceneId: source.currentSceneId?.trim() || null,
    archiveScope: archiveScopeSessionValue(source),
  };
}

function isSameContinuationScope(
  a: StreamRequestScope,
  b: StreamContinuationScope,
): boolean {
  return (
    a.worldId === b.worldId &&
    a.playthroughId === b.playthroughId &&
    a.worldLineId === b.worldLineId &&
    a.nodeId === b.nodeId &&
    a.sceneId === b.sceneId &&
    a.archiveScope === b.archiveScope
  );
}

export function isActiveStreamScope(scope: StreamRequestScope): boolean {
  return _activeStream?.scope?.requestId === scope.requestId;
}

export function isCurrentStreamContinuation(
  scope: StreamRequestScope,
  source: StreamScopeSource,
): boolean {
  return isSameContinuationScope(scope, createStreamContinuationScope(source));
}

export function canApplyStreamResult(
  scope: StreamRequestScope,
  source: StreamScopeSource,
): boolean {
  return isActiveStreamScope(scope) && isCurrentStreamContinuation(scope, source);
}

/** 设置活跃的流控制器（新请求开始时调用） */
export function setActiveStream(ctrl: AbortController, scope?: StreamRequestScope): void {
  _activeStream?.controller.abort(); // 取消旧流
  _activeStream = { controller: ctrl, scope: scope ?? null };
  _pendingResult = null;
  _busy = true;
}

/** 清除活跃的流控制器（流正常结束时调用） */
export function clearActiveStream(ctrl?: AbortController): void {
  if (ctrl && _activeStream && _activeStream.controller !== ctrl) return;
  _activeStream = null;
  _busy = false;
}

/** 终止活跃的流，默认同时清空 KEI 队列（退出游戏/切换世界时调用） */
export function abortActiveStream(options: { cancelKeiQueue?: boolean } = {}): void {
  _activeStream?.controller.abort();
  _activeStream = null;
  _busy = false;
  _pendingResult = null;
  if (_pendingKeiApp) appendKeiReviewAudit({ timestamp: Date.now(), origin: _pendingKeiApp.origin, phase: "discarded", reason: "cancelled" });
  _pendingKeiApp = null;
  if (options.cancelKeiQueue ?? true) {
    cancelKeiQueue(); // 清空所有待处理的 KEI 审核，防止积压阻塞新游戏
  }
}

/** 是否有活跃的流 */
export function hasActiveStream(scope?: StreamContinuationScope): boolean {
  if (!_activeStream) return false;
  if (!scope) return true;
  return Boolean(_activeStream.scope && isSameContinuationScope(_activeStream.scope, scope));
}

/** 缓冲流结果（组件卸载期间流完成时调用） */
export function setPendingResult(result: PendingStreamResult | null): void {
  if (result?.scope) {
    // 旧请求被新请求或退出动作覆盖后，即使网络晚到，也不能再污染当前游戏。
    if (!_activeStream?.scope || _activeStream.scope.requestId !== result.scope.requestId) {
      return;
    }
  }
  _pendingResult = result;
  if (result) for (const callback of pendingResultSubscribers) callback();
}

/** 取走缓冲的流结果 */
export function takePendingResult(scope?: StreamContinuationScope): PendingStreamResult | null {
  const r = _pendingResult;
  if (r?.scope) {
    if (!scope || !isSameContinuationScope(r.scope, scope)) {
      _pendingResult = null;
      return null;
    }
  }
  _pendingResult = null;
  return r;
}

/** 获取/设置 ALICE 流忙碌状态 */
export function isStreamBusy(): boolean { return _busy; }
export function setStreamBusy(v: boolean): void { _busy = v; }

/**
 * 行动管线忙碌状态：ALICE 流和会提交状态修正的关键 KEI 审核。
 */
export function isPipelineBusy(): boolean {
  return _busy || hasBlockingKeiReviews();
}

// ============================================================
// KEI 审核申请交接
// ============================================================
// 候选生成器不申请审核。浏览器实际接受完整响应后立即取走并提交一次。
// ============================================================

/** 暂存的 KEI 审核申请 */
export interface PendingKeiApplication {
  origin: KeiReviewOrigin;
  aliceResponse: AIGameResponse;
  world: WorldDefinition;
  snapshot: WorldSnapshot;
  validationContext: string;
  creativeConfig?: CreativeModeConfig | null;
  metaRealityContext?: string;
  narrativeContext?: KeiNarrativeReviewContext;
  continuationSceneId?: string;
}

export interface KeiReviewScopeSource extends StreamScopeSource {
  worldLine?: { id?: string | null; rootNodeId?: string | null; worldId?: string; playthroughId?: string } | null;
  currentNode?: { id?: string | null; actionId?: string } | null;
  history?: ReadonlyArray<{ id: string }>;
  allNodes?: Record<string, { id: string; parentId: string | null; actionId?: string }>;
}

export function isCurrentKeiReview(origin: KeiReviewOrigin, source: KeiReviewScopeSource): boolean {
  const scope = createStreamContinuationScope(source);
  if (origin.worldId !== scope.worldId || origin.playthroughId !== scope.playthroughId ||
      origin.archiveScope !== scope.archiveScope ||
      (origin.worldLineId !== null && origin.worldLineId !== scope.worldLineId)) return false;
  if (source.history?.at(-1)?.id !== origin.actionId) return false;
  // A viewed side branch need not be an ancestor of the live head. Both IDs are
  // runtime provenance captured at acceptance, and the accepted history must match.
  const pendingFork=Boolean(origin.expectedHeadId && source.currentNode?.id===origin.expectedHeadId &&
    origin.parentNodeId && source.allNodes?.[origin.parentNodeId] && !Object.values(source.allNodes ?? {}).some(n=>n.actionId===origin.actionId));
  // CAS persistence is asynchronous: the accepted history entry can precede its child node.
  return pendingFork || source.currentNode?.actionId === origin.actionId || (source.currentNode?.id ?? null) === origin.parentNodeId ||
    // Auto-init may publish its root before the accepted first action finishes saving.
    (origin.worldLineId === null && origin.parentNodeId === null && Boolean(source.worldLine?.rootNodeId) &&
      source.worldLine?.worldId === origin.worldId && source.worldLine?.playthroughId === origin.playthroughId &&
      source.currentNode?.id === source.worldLine?.rootNodeId);
}

/** Soft advice may arrive after its action; prove ancestry rather than just matching a scene. */
export function isKeiReviewOnCurrentBranch(origin: KeiReviewOrigin, source: KeiReviewScopeSource): boolean {
  const scope = createStreamContinuationScope(source);
  if (origin.worldId !== scope.worldId || origin.playthroughId !== scope.playthroughId ||
      origin.archiveScope !== scope.archiveScope ||
      (origin.worldLineId !== null && origin.worldLineId !== scope.worldLineId) ||
      !source.history?.some(h => h.id === origin.actionId)) return false;
  const seen = new Set<string>();
  let id = source.currentNode?.id;
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = source.allNodes?.[id];
    if (!node) break;
    if (node.actionId === origin.actionId) return node.parentId === origin.parentNodeId ||
      (origin.worldLineId === null && origin.parentNodeId === null && node.parentId === source.worldLine?.rootNodeId &&
       source.worldLine?.worldId === origin.worldId && source.worldLine?.playthroughId === origin.playthroughId);
    id = node.parentId;
  }
  // The accepted action may still be writing its CAS child; only the latest action gets this grace.
  return !Object.values(source.allNodes ?? {}).some(n => n.actionId === origin.actionId) && isCurrentKeiReview(origin, source);
}

let _pendingKeiApp: PendingKeiApplication | null = null;

/**
 * 暂存 ALICE 完成后待提交的 KEI 审核申请。
 * 只由浏览器在接受新行动后调用；生成器和预生成候选不写申请。
 */
export function storePendingKeiApplication(app: PendingKeiApplication): void {
  if (_pendingKeiApp) appendKeiReviewAudit({ timestamp: Date.now(), origin: _pendingKeiApp.origin, phase: "discarded", reason: "replaced" });
  _pendingKeiApp = app;
  appendKeiReviewAudit({ timestamp: Date.now(), origin: app.origin, phase: "pending" });
}

/**
 * 取走暂存的 KEI 审核申请（消费后清空）。
 * 供 GameScreen 在玩家交互点调用（阅读完毕或中断时）。
 */
export function takePendingKeiApplication(source?: KeiReviewScopeSource): PendingKeiApplication | null {
  const app = _pendingKeiApp;
  _pendingKeiApp = null;
  if (app && (!source || !isCurrentKeiReview(app.origin, source))) {
    appendKeiReviewAudit({ timestamp: Date.now(), origin: app.origin, phase: "discarded", reason: source ? "stale_action" : "cancelled" });
    if (source) return null;
  }
  return app;
}

/** 是否有暂存的 KEI 审核申请 */
export function hasPendingKeiApplication(): boolean {
  return _pendingKeiApp !== null;
}
