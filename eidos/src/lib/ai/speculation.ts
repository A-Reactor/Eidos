import { workspaceImageInputs } from '@/lib/game/workspace/image-inputs';
import { hasActionTool } from './workspace-tools';
import { continueActionTools } from '@/lib/game/action-tool-continuation';
import { registerWorkspaceSession, getWorkspaceSession, type WorkspaceSession } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { matchesActionInput } from '@/lib/game/documents/action-draft';
import { aliceUserInstructions } from './user-instructions';
import { loadSettings } from '@/lib/game/settings';
import { archiveScopeSessionValue, type ArchiveScopeSource } from '@/lib/game/archive-scope';
import { buildWorldContextSections } from './context-builder';
import { buildGameplayStaticPrompt, buildGameplayRuntimePrompt } from '@/lib/game/plugins/runtime';
import { getBuiltInWorld } from './builtin-worlds';
import { projectNpcMemoryState } from '@/lib/game/npc-memory-save';
// ============================================================
// Eidos · 推测性预计算引擎
// ============================================================
//
// 核心思路：利用玩家阅读叙事的时间窗口（~8s），提前为
// AI 推荐的可能行动并发请求 DeepSeek API，将结果缓存。
// 当玩家选择推荐行动时，响应即时返回（0s TTFW）。
//
// 工作流程：
//   1. 叙事显示完毕 → triggerSpeculation(availableActions, state)
//   2. 并发调用 processPlayerAction 请求（最多 3 个）
//   3. 结果缓存在 Map<action, AIGameResponse> 中
//   4. 玩家提交行动 → checkCache(action) → HIT/MISS
//   5. 已选择行动仍在生成 → 沿用原请求及其超时；真正 MISS 才正常请求
//
// 并发安全：
//   - 每个推测请求携带完整 game state snapshot（不可变）
//   - 调用链使用显式 settingsOverride 参数（非模块级状态）
//   - 推测响应仅数据，状态变更在 checkCache HIT 时由调用方应用

import type { AIGameResponse } from "./types";
import type { WorldSnapshot, InventoryItem, Clue, CriticalFactEntry, EncyclopediaEntry, QuestEntry, ProtagonistState, WorldDefinition, CreativeModeConfig } from "@/lib/game/types";
import { processPlayerAction } from "./action-handler";
import type { SandboxToolAuditPromptEntry } from "./sandbox-tool-pipeline";
import { stableRecordJSON } from './prompt-layout';
import { worldForModel } from '@/lib/game/plugins/model-manifest';
import { resolveAiRoleConfig } from './providers/config';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { startGameRuntimeSpan } from '@/lib/game/runtime-log';

// ============================================================
// 类型
// ============================================================

/** 推测请求的输入参数（所有推测请求共享同一快照） */
export interface SpeculationInput {
  imageCatalog?: import('@/lib/game/midori/image-context').ImageCatalogEntry[];
  /** World/playthrough/node identity: speculative results never cross this boundary. */
  scope: string;
  workspaceRevision?: string;
  createWorkspace?(actionId: string, isCurrent: () => boolean): Promise<WorkspaceSession | null>;
  historySource?: import('@/lib/game/history-reader').HistoryReadSource;
  /** 当前游戏状态快照（不可变——所有推测请求共享同一快照） */
  snapshot: WorldSnapshot;
  /** 世界定义 */
  world: WorldDefinition | null;
  /** 最近行动历史（用于 AI 上下文连续性） */
  recentHistory: Array<{ playerInput: string; summary: string; aiResponse?: string }>;
  inventory: InventoryItem[];
  clues: Clue[];
  encyclopedia: EncyclopediaEntry[];
  criticalFacts: CriticalFactEntry[];
  questLog: QuestEntry[];
  weather: string;
  protagonistState: ProtagonistState | null;
  /** 客户端设置（API key 等） */
  clientSettings: Record<string, string> | null;
  /** 创造模式配置 */
  creativeConfig?: CreativeModeConfig | null;
  /** 普通游玩运行时可见的现实边界材料摘要 */
  metaRealityContext?: string;
  sandboxMode?: boolean;
  sandboxToolAudit?: SandboxToolAuditPromptEntry[];
}

/** 缓存的推测结果 */
export interface SpeculationEntry {
  response: AIGameResponse;
  action: string;
  createdAt: number;
}

/** 推测引擎状态 */
export type SpeculationStatus = "idle" | "speculating" | "cancelled";

// ============================================================
// 推测引擎
// ============================================================

export type SpeculationRunner = (action: string, input: SpeculationInput, signal: AbortSignal) => Promise<AIGameResponse | null>;

export function speculationScope(worldId: string | undefined, playthroughId: string | null | undefined, nodeId: string | undefined, archive?: ArchiveScopeSource): string {
  const base = `${worldId ?? ''}:${playthroughId ?? ''}:${nodeId ?? 'start'}`;
  return archive?.sandboxMode ? `${base}:${archiveScopeSessionValue(archive)}` : base;
}

/** Compare facts exactly; local layout/file edits do not change the model's starting state. */
export function speculationStateKey(world: WorldDefinition | null, snapshot: WorldSnapshot, settings: Record<string, string> | null, recentHistory: SpeculationInput['recentHistory'] = [], workspaceRevision = '', imageCatalog: import('@/lib/game/midori/image-context').ImageCatalogEntry[] = []): string {
  const gameplayModState = snapshot.gameplayModState;
  const ledgers = Object.fromEntries(Object.entries(gameplayModState ?? {}).filter(([, state]) => state._eidosCard).map(([id, state]) => [id, state._eidosCard]));
  const { apiKey: _secret, ...config } = resolveAiRoleConfig('alice', { ...DEFAULT_SETTINGS, ...settings } as typeof DEFAULT_SETTINGS);
  const projected = projectNpcMemoryState(snapshot.npcMemory), definition = world ?? getBuiltInWorld();
  // Compare the actual rendered facts, not unused save-envelope timestamps or duplicate projections.
  const sections = buildWorldContextSections({ imageCatalog, world: definition, snapshot, inventory: snapshot.inventory, clues: snapshot.clues,
    encyclopedia: snapshot.encyclopedia, criticalFacts: snapshot.criticalFacts, questLog: snapshot.questLog, weather: snapshot.weather, protagonistState: snapshot.protagonistState,
    diary: snapshot.diary, causalProjections: snapshot.causalProjections,
    npcStates: snapshot.npcStates ?? projected.npcStates, relationships: snapshot.relationships ?? projected.relationships,
    npcBehaviors: snapshot.npcBehaviors ?? projected.npcBehaviors, npcPersonalities: snapshot.npcPersonalities ?? projected.npcPersonalities });
  return stableRecordJSON({ world: worldForModel(definition), context: sections.stablePrefix + sections.dynamicSuffix,
    pluginState: buildGameplayStaticPrompt(definition, 'action', { flags: snapshot.worldFlags, sceneId: snapshot.currentSceneId }) + buildGameplayRuntimePrompt(definition, snapshot.worldFlags, snapshot.gameplayResources, snapshot.currentSceneId),
    // Staged director advice guides the next generation; it does not discard already paid candidates.
    historyLength: snapshot.historyLength, history: recentHistory, playerName: snapshot.playerName,
    userInstructions: aliceUserInstructions(settings), compression: [settings?.contextCompressionLowerPercent ?? loadSettings().contextCompressionLowerPercent, settings?.contextCompressionUpperPercent ?? loadSettings().contextCompressionUpperPercent],
    documentHeads: snapshot.documentHeads, workspaceRevision, imageCatalog: imageCatalog.filter(image => image.worldId === definition.id), realityArtifacts: snapshot.realityArtifacts, boundaryEvents: snapshot.boundaryEvents, ledgers, config });
}

/** Fill missing actions individually; an existing first branch must not suppress every other branch. */
export function missingSpeculationActions(actions: string[], children: { playerInput: string; generationComplete?: boolean; inputDocuments?: import('@/lib/game/documents/types').DocumentRef[]; inputIdentity?: string; entry?: {id:string} }[], limit: number): string[] {
  const seen = new Set(children.filter(child => !child.entry && child.generationComplete !== false && matchesActionInput(child, child.playerInput)).map(child => normalizeAction(child.playerInput)));
  return actions.filter(action => {
    const key = normalizeAction(action);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

export class SpeculativeEngine {
  private cache = new Map<string, SpeculationEntry>();
  private pending = new Map<string, Promise<void>>();
  private abort = new AbortController();
  private scope: string | null = null;
  private stateKey: string | null = null;
  private generation = 0;
  private cancelled = false;
  private selectedWaits = 0;
  private primary: string | null = null;
  private listeners = new Set<() => void>();

  // The cache holds only this node’s candidates; scope/state changes invalidate it.
  // Slow reading must not expire already paid results while the facts stay unchanged.
  constructor(private readonly maxSpeculations = 1, private readonly cacheTtlMs = Number.POSITIVE_INFINITY,
    private readonly run: SpeculationRunner = fetchSpeculative) {}

  get status(): SpeculationStatus { return this.pending.size ? 'speculating' : this.cancelled ? 'cancelled' : 'idle'; }
  get size(): number { this.evictExpired(); return this.cache.size; }
  get hasSelectedWait(): boolean { return this.selectedWaits > 0; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  /** Inspect the recommended branch without consuming the gameplay response. */
  peekPrimary(scope: string): SpeculationEntry | null {
    if (scope !== this.scope || !this.primary) return null;
    this.evictExpired();
    return this.cache.get(this.primary) ?? null;
  }
  private publish() {
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.warn('[Speculation] 候选变更订阅失败', error); }
    }
  }

  async triggerSpeculation(actions: string[], input: SpeculationInput, maxCount = this.maxSpeculations): Promise<void> {
    const stateKey = speculationStateKey(input.world, input.snapshot, input.clientSettings, input.recentHistory, input.workspaceRevision, input.imageCatalog);
    if (input.scope !== this.scope || stateKey !== this.stateKey) { this.cancel(); this.scope = input.scope; this.stateKey = stateKey; }
    this.cancelled = false;
    this.evictExpired();
    const generation = this.generation;
    const signal = this.abort.signal;
    const targets = [...new Set(actions.map(normalizeAction))].slice(0, maxCount);
    if (this.primary !== (targets[0] ?? null)) { this.primary = targets[0] ?? null; this.publish(); }
    await Promise.allSettled(targets.map(key => {
      if (this.cache.has(key)) return Promise.resolve();
      const existing = this.pending.get(key);
      if (existing) return existing;
      const action = actions.find(action => normalizeAction(action) === key)!;
      const log = startGameRuntimeSpan({ engine: 'ALICE', mode: 'speculation', scope: input.scope, worldId: input.world?.id });
      let ended = false;
      const end = (phase: 'succeeded' | 'failed' | 'discarded', reason?: string) => {
        if (!ended) { ended = true; log(phase, reason); }
      };
      const onAbort = () => end('discarded', 'cancelled');
      signal.addEventListener('abort', onAbort, { once: true });
      const job = this.run(action, input, signal).then(response => {
        // Aborting is advisory: providers may finish late, so verify the generation as well.
        if (generation === this.generation && !signal.aborted && response && response.validity?.isPossible !== false) {
          this.cache.set(key, { action, response, createdAt: Date.now() });
          this.publish();
          end('succeeded');
        } else {
          end('discarded', signal.aborted || generation !== this.generation ? 'cancelled' : 'invalid_response');
        }
      }).catch(error => {
        end(signal.aborted ? 'discarded' : 'failed', signal.aborted ? 'cancelled' : 'provider_error');
        if (!signal.aborted) console.warn('[Speculation] 预生成失败', error);
      }).finally(() => {
        signal.removeEventListener('abort', onAbort);
        if (generation === this.generation) this.pending.delete(key);
      });
      this.pending.set(key, job);
      return job;
    }));
  }

  checkCache(action: string, scope?: string, stateKey?: string): AIGameResponse | null {
    if (scope !== undefined && scope !== this.scope) return null;
    if (stateKey !== undefined && stateKey !== this.stateKey) {
      this.cancel(); return null;
    }
    this.evictExpired();
    const key = normalizeAction(action);
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    if (entry.response._workspaceSessionId) { const session = getWorkspaceSession(entry.response._workspaceSessionId); if (session) session.adopted = true; }
    this.publish();
    return entry.response;
  }

  hasPendingAction(action: string, scope: string): boolean {
    return scope === this.scope && this.pending.has(normalizeAction(action));
  }

  /** Adopt the original request: its provider timeout still bounds generation.
   * A second short timer used to cancel healthy requests and pay for a duplicate.
   */
  async waitForPending(action: string, scope: string, options: { signal?: AbortSignal; timeoutMs?: number; stateKey?: string } = {}): Promise<AIGameResponse | null> {
    if (scope !== this.scope || options.signal?.aborted) return null;
    if (options.stateKey !== undefined && options.stateKey !== this.stateKey) { this.cancel(); return null; }
    const job = this.pending.get(normalizeAction(action));
    if (!job) return this.checkCache(action, scope);
    const generation = this.generation; const signal = this.abort.signal;
    const log = startGameRuntimeSpan({ engine: 'ALICE', mode: 'prediction_wait', scope });
    this.selectedWaits++;
    let stop = () => {};
    const stopped = new Promise<false>(resolve => { stop = () => resolve(false); });
    signal.addEventListener('abort', stop, { once: true });
    options.signal?.addEventListener('abort', stop, { once: true });
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(stop, options.timeoutMs);
    try {
      const complete = await Promise.race([job.then(() => true), stopped]);
      const cancelled = generation !== this.generation || signal.aborted || options.signal?.aborted;
      const response = complete && !cancelled ? this.checkCache(action, scope) : null;
      log(response ? 'succeeded' : cancelled ? 'discarded' : 'fallback',
        response ? undefined : cancelled ? 'cancelled' : complete ? 'no_result' : 'timeout');
      return response;
    } finally {
      this.selectedWaits--;
      clearTimeout(timer); signal.removeEventListener('abort', stop); options.signal?.removeEventListener('abort', stop);
    }
  }

  cancel(): void {
    this.abort.abort(); this.abort = new AbortController();
    this.generation++; this.scope = null; this.stateKey = null; this.pending.clear(); this.cache.clear(); this.cancelled = true;
    this.primary = null; this.publish();
  }
  clearCache(): void { this.cache.clear(); this.publish(); }
  private evictExpired(): void {
    for (const [key, entry] of this.cache) if (Date.now() - entry.createdAt > this.cacheTtlMs) this.cache.delete(key);
  }
}

async function fetchSpeculative(action: string, input: SpeculationInput, signal: AbortSignal): Promise<AIGameResponse | null> {
  signal.throwIfAborted();
  const actionId = crypto.randomUUID(), sessionId = `prediction:${actionId}`;
  const session = await input.createWorkspace?.(actionId, () => !signal.aborted) ?? null;
  if (session) {
    registerWorkspaceSession(sessionId, session);
    signal.addEventListener('abort', () => { if (!session.adopted) session.closed = true; }, { once: true });
  }
  const invoke = async (workspaceContext = session ? workspacePromptContext(session) : undefined, longMemoryContext?: string, chapterPreparation?: import('@/lib/game/chapters/types').ChapterPreparation | null, historyEpochPlan?: import('./history-epoch').HistoryEpochPlan) => processPlayerAction({
    chapterPreparation, imageInputs: await workspaceImageInputs(session, signal),
    playerInput: action, snapshot: { ...input.snapshot, historyEpochPlan: historyEpochPlan ?? input.snapshot.historyEpochPlan }, imageCatalog: input.imageCatalog,
    recentHistory: input.recentHistory, world: input.world ?? null,
    inventory: input.inventory, clues: input.clues.filter(c => c.sceneId === input.snapshot.currentSceneId),
    encyclopedia: input.encyclopedia, criticalFacts: input.criticalFacts, questLog: input.questLog,
    weather: input.weather, protagonistState: input.protagonistState, clientSettings: input.clientSettings,
    creativeConfig: input.creativeConfig ?? null, metaRealityContext: input.metaRealityContext ?? '',
    sandboxMode: input.sandboxMode ?? false, sandboxToolAudit: input.sandboxToolAudit ?? [],
    workspaceContext, longMemoryContext, forceFull: false, skipKeiStorage: true, signal,
  });
  let response = await invoke();
  if (response && hasActionTool(response)) {
    const continued = await continueActionTools({ response, session, signal, settings: input.clientSettings, deferProfileChanges: true,
    engine: input.historySource ? { currentWorld: input.world, worldFlags: input.snapshot.worldFlags, gameplayResources: input.snapshot.gameplayResources ?? {}, allNodes: input.historySource.allNodes, currentNode: input.historySource.currentNode } : undefined,
    historySource: input.historySource ?? { allNodes: {}, currentNode: null }, context: { longMemoryContext: '', workspaceContext: session ? workspacePromptContext(session) : { draftRoot: `drafts/${actionId}`, mounts: [], results: [], nextOffset: null } },
    isCurrent: () => !signal.aborted, onResponse() {}, invoke: context => invoke(context.workspaceContext, context.longMemoryContext, context.chapterPreparation, context.historyEpochPlan) });
    if (continued.error) return null;
    response = continued as AIGameResponse;
  }
  signal.throwIfAborted();
  return response ? { ...response, ...(session ? { _workspaceSessionId: sessionId } : {}) } : null;
}

// ============================================================
// 全局单例（每个游戏会话一个引擎）
// ============================================================

export const speculativeEngine = new SpeculativeEngine();

// ============================================================
// 工具
// ============================================================

/** 标准化行动文本（用于模糊匹配）——去除标点和多余空格 */
function normalizeAction(text: string): string {
  return text
    .replace(/[，。！？、；：""''（）【】《》\s]/g, "")
    .toLowerCase()
    .trim();
}
