// ============================================================
// Eidos · 人格推演 Slice
// ============================================================
// Phase 1: 人格档案与记忆底座
// 管理 NPC 人格状态的初始化、记忆更新、压力和觉察阶段

import type {
  CognitiveStyle,
  EmotionalRegulation,
  PersonalityState,
  MinimalPersonalityState,
  AnyPersonalityState,
  EpisodicMemory,
  SemanticMemory,
  AnomalousMemory,
  PersonalityArchive,
  PersonalityPressure,
  BeliefModel,
  SocialStrategy,
} from "@/lib/personality/types";
import type { WorldDefinition } from "@/lib/game/types";
import type { EvidenceAtom, UzqCreationSeed } from "@/lib/ai/source-archive";
import { AwarenessStage, isFullPersonalityState } from "@/lib/personality/types";
import { repairLegacyAcademicArchive } from '@/lib/personality/legacy-defaults';
import { newNpcSpeechProfiles, parseNpcSpeechProfile } from '@/lib/game/npc-speech';
import type { AIGameResponse } from '@/lib/ai/types';
import {
  extractPersonalityFromDescription,
  formatPersonalityContext,
  guessInitialAwareness,
} from "@/lib/personality/context";
import { mergeMemory } from "@/lib/personality/memory";
import { batchInfer } from "@/lib/personality/inference";
import { detectAnomalies } from "@/lib/personality/anomaly";
import {
  calculateAwarenessStage,
} from "@/lib/personality/awareness";
import {
  evaluatePermission,
  canSubmitRequest,
  setCooldown,
  PermissionLevel,
  type PermissionRequest,
  type PermissionDecision,
} from "@/lib/personality/permissions";
import { executeTool, getTool, rollbackTool, type ToolExecutionResult } from "@/lib/personality/tools";
import {
  clearAuditLog,
  completeAuditEntry,
  denyAuditConfirmation,
  exportAuditLog,
  getAuditLog,
  markRolledBack,
  recordAudit,
  summarizeAuditLog,
} from "@/lib/personality/audit";
import type { PermissionUiEffect } from "@/lib/personality/ui-effects";
import {
  buildSocialNetwork,
  propagateAnomaly,
  formGroupHypothesis,
  crossVerifyMemories,
} from "@/lib/personality/social";
import type { GroupHypothesis, PropagationEvent } from "@/lib/personality/types";

// ============================================================
// 人格追踪阈值
// ============================================================

/**
 * 边界敏感度阈值：≥ 此值的 NPC 自动获得完整人格追踪。
 *
 * 原理：边界敏感度来自 `extractPersonalityFromDescription`——
 * 描述中包含观测/分析/怀疑/信仰/艺术等关键词的角色天然敏感度更高，
 * 普通市民/商人/守卫等则会较低。低敏感度 NPC 只获得 MinimalState，
 * 不产生记忆数组，避免上下文膨胀。
 *
 * 这个阈值不是对某个角色的「特权授权」——任何角色只要世界描述
 * 赋予了他足够的边界敏感度，系统就自动为他开启完整追踪。
 */
const FULL_TRACKING_BOUNDARY_SENSITIVITY_THRESHOLD = 30;

// ============================================================
// Slice 类型
// ============================================================

export interface PersonalitySlice {
  /** 所有 NPC 的人格状态（key = NPC 名称） */
  npcPersonalities: Record<string, AnyPersonalityState>;
  /** 仅在真实行动被接受后保存首次说话人物的表达档案。 */
  acceptNpcSpeechProfiles: (response: AIGameResponse, introspection?: boolean) => void;

  /** 初始化一个 NPC 的人格档案 */
  initPersonality: (
    npcId: string,
    description: unknown,
    isImportant: boolean,
  ) => void;

  /** 确保 NPC 已初始化人格（幂等——已有则不重复创建） */
  ensurePersonality: (
    npcId: string,
    description: unknown,
    isImportant: boolean,
  ) => void;

  /** 添加一条情节记忆 */
  addEpisodicMemory: (
    npcId: string,
    memory: Omit<EpisodicMemory, "id" | "timestamp">,
  ) => void;

  /** 添加一条异常记忆 */
  addAnomalousMemory: (
    npcId: string,
    anomaly: Omit<AnomalousMemory, "id" | "detectedAt">,
  ) => void;

  /** 更新一条语义记忆（置信度变更、来源更新等） */
  updateBelief: (npcId: string, belief: SemanticMemory) => void;

  /** 计算 NPC 当前压力（纯状态推导，无 AI 调用） */
  computePressure: (npcId: string) => PersonalityPressure;

  /** 推进觉察阶段（Phase 3：委托给觉察计算器） */
  advanceAwareness: (npcId: string, targetStage: AwarenessStage) => void;

  /** 评估觉察阶段并返回详细结果（供面板使用） */
  evaluateAwareness: (npcId: string) => ReturnType<typeof calculateAwarenessStage> | null;

  /** 获取 NPC 人格上下文的格式化文本（供 AI prompt 注入） */
  getPersonalityContext: (npcId: string, maxMemories?: number) => string;

  /** 获取当前场景中重要 NPC 的人格上下文集合 */
  getScenePersonalityContext: (sceneNpcNames: string[]) => string;

  /** 运行人格推演循环——结合异常检测 + ALICE 观察信号，更新所有相关 NPC */
  runInference: (input: {
    playerInput: string;
    observations?: import("@/lib/ai/types").PersonalityObservations;
    worldLineSummary?: import("@/lib/ai/context-builder").WorldLineSummary;
    isWorldLineBacktrack?: boolean;
    playerInputIsMetagaming?: boolean;
  }) => Array<{ npcId: string; memoriesAdded: number; pressureChanged: boolean; anomaliesDetected: number }>;

  /** 群体假说（Phase 5） */
  groupHypotheses: GroupHypothesis[];
  /** 最近的传播事件（Phase 5） */
  recentPropagations: PropagationEvent[];

  /** 开发面板显示状态 */
  showTracePanel: boolean;
  toggleTracePanel: () => void;

  // ========== 权限系统（Phase 4）==========

  /** NPC 提交权限申请 */
  requestPermission: (npcId: string, toolId: string, motivation: string, evidence: string[]) => PermissionDecision;

  /** 执行 NPC 工具调用（需权限审批通过） */
  executeNpcTool: (npcId: string, toolId: string, params: Record<string, any>) => ToolExecutionResult | null;

  /** 从 UZQ/调试面板递交一条完整权限意图 */
  submitPermissionIntent: (input: PermissionIntentInput) => PermissionIntentSubmission;

  /** 待玩家确认的权限申请 */
  pendingPermissionRequests: PendingPermissionRequest[];

  /** 确认执行一条待处理权限申请 */
  confirmPermissionRequest: (requestId: string) => ToolExecutionResult | null;

  /** 拒绝一条待处理权限申请 */
  denyPermissionRequest: (requestId: string) => boolean;

  /** 界面级权限产生的短暂 UI 效果 */
  permissionUiEffects: PermissionUiEffect[];

  /** 清理指定 UI 效果 */
  dismissPermissionUiEffect: (effectId: string) => void;

  /** 回滚 NPC 工具调用 */
  rollbackNpcTool: (auditEntryId: string) => ToolExecutionResult | null;

  /** 导出审计日志为 JSON */
  exportPersonalityAudit: () => string;

  /** 获取审计摘要 */
  getAuditSummary: () => import("@/lib/personality/audit").AuditSummary;

  /** 清空所有人格数据（世界切换时调用） */
  resetPersonalities: () => void;
}

export interface PendingPermissionRequest {
  id: string;
  npcId: string;
  toolId: string;
  motivation: string;
  evidence: string[];
  params: Record<string, any>;
  decision: PermissionDecision;
  createdAt: number;
  sandboxMode: boolean;
}

export interface PermissionIntentInput {
  npcId: string;
  toolId: string;
  motivation: string;
  evidence: string[];
  params: Record<string, any>;
}

export interface PermissionIntentSubmission {
  decision: PermissionDecision;
  result: ToolExecutionResult | null;
  queuedRequestId: string | null;
}

// ============================================================
// Slice 工厂
// ============================================================

export const createPersonalitySlice = (
  set: (
    partial:
      | Record<string, any>
      | ((state: Record<string, any>) => Record<string, any>),
  ) => void,
  get: () => any,
  _store?: any,
): PersonalitySlice => ({
  npcPersonalities: {},
  groupHypotheses: [],
  recentPropagations: [],
  pendingPermissionRequests: [],
  permissionUiEffects: [],
  showTracePanel: false,
  toggleTracePanel: () => set((s) => ({ showTracePanel: !(s as any).showTracePanel })),

  // ========== 初始化 ==========

  initPersonality: (npcId, description, _isImportant) => {
    const speechProfile = parseNpcSpeechProfile(get().currentWorld?.npcSpeechProfiles?.[npcId]);
    const extractedArchive = extractPersonalityFromDescription(description, npcId);
    const sourceSeedContext = resolveSourceArchiveSeed(get(), npcId);
    const archive = sourceSeedContext
      ? mergeArchiveWithUzqSeed(extractedArchive, sourceSeedContext.seed)
      : extractedArchive;
    const sourceSeedMemories = sourceSeedContext
      ? buildSourceSeedSemanticMemories(
          npcId,
          sourceSeedContext.seed,
          sourceSeedContext.evidence,
        )
      : [];
    const stage = guessInitialAwareness(description);

    // 不设角色白名单——从边界敏感度自动决定是否完整追踪。
    // 敏感度来自世界描述的角色类型：观测/分析/怀疑/信仰/艺术等天然高，市民/商人/守卫低。
    const isImportant = archive.boundarySensitivity >= FULL_TRACKING_BOUNDARY_SENSITIVITY_THRESHOLD;

    if (isImportant) {
      const state: PersonalityState = {
        npcId,
        archive,
        ...(speechProfile ? { speechProfile } : {}),
        awareness: stage,
        episodicMemories: [],
        semanticMemories: sourceSeedMemories,
        emotionalMemories: [],
        relationalMemories: [],
        anomalousMemories: [],
        beliefs: buildInitialBeliefs(sourceSeedMemories),
        pressure: getZeroPressure(),
        lastUpdated: Date.now(),
        isImportant: true as const,
      };
      set((s) => ({
        npcPersonalities: {
          ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
          [npcId]: state,
        },
      }));
    } else {
      const state: MinimalPersonalityState = {
        npcId,
        archive,
        ...(speechProfile ? { speechProfile } : {}),
        awareness: stage,
        lastUpdated: Date.now(),
        isImportant: false as const,
      };
      set((s) => ({
        npcPersonalities: {
          ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
          [npcId]: state,
        },
      }));
    }
  },

  ensurePersonality: (npcId, description, _isImportant) => {
    const existing = get().npcPersonalities[npcId];
    if (existing) {
      if (resolveSourceArchiveSeed(get(), npcId)) return;
      const archive = repairLegacyAcademicArchive(existing.archive, description, npcId);
      if (archive !== existing.archive) set((s) => ({ npcPersonalities: { ...s.npcPersonalities, [npcId]: { ...existing, archive } } }));
      return;
    }

    // 委托 initPersonality——它内部从描述提取 archive 并自动决定追踪层级
    get().initPersonality(npcId, description, _isImportant);
  },

  acceptNpcSpeechProfiles: (response, introspection = false) => {
    if (introspection) return;
    const state = get();
    const saved = Object.fromEntries(Object.entries(state.npcPersonalities as Record<string, AnyPersonalityState>)
      .flatMap(([name, personality]) => personality.speechProfile ? [[name, personality.speechProfile]] : []));
    const profiles = newNpcSpeechProfiles(response, state.currentWorld?.npcSpeechProfiles ?? {}, saved);
    if (!Object.keys(profiles).length) return;
    for (const name of Object.keys(profiles)) {
      const description = state.currentWorld?.npcs[name] ?? state.encyclopedia?.find((entry: { type: string; name: string }) => entry.type === 'npc' && entry.name === name)?.description ?? '';
      get().ensurePersonality(name, description, false);
    }
    set(current => ({ npcPersonalities: {
      ...current.npcPersonalities,
      ...Object.fromEntries(Object.entries(profiles).map(([name, speechProfile]) => [name, { ...current.npcPersonalities[name], speechProfile }])),
    } }));
  },

  // ========== 记忆管理 ==========

  addEpisodicMemory: (npcId, memory) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) return;

    const newMemory: EpisodicMemory = {
      ...memory,
      id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };

    const merged = mergeMemory(state.episodicMemories, newMemory);

    set((s) => ({
      npcPersonalities: {
        ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
        [npcId]: {
          ...state,
          episodicMemories: merged,
          lastUpdated: Date.now(),
        },
      },
    }));
  },

  addAnomalousMemory: (npcId, anomaly) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) return;

    const newAnomaly: AnomalousMemory = {
      ...anomaly,
      id: `anom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      detectedAt: Date.now(),
    };

    set((s) => ({
      npcPersonalities: {
        ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
        [npcId]: {
          ...state,
          anomalousMemories: [...state.anomalousMemories, newAnomaly].slice(
            -50,
          ),
          lastUpdated: Date.now(),
        },
      },
    }));
  },

  updateBelief: (npcId, belief) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) return;

    const existing = state.semanticMemories.findIndex(
      (m) => m.id === belief.id,
    );

    let updated: SemanticMemory[];
    if (existing >= 0) {
      updated = [...state.semanticMemories];
      updated[existing] = { ...belief, id: belief.id };
    } else {
      updated = [...state.semanticMemories, belief];
    }

    // 移到信念模型中
    const isConfirmed = belief.confidence >= 70;
    const isHypothesis = belief.confidence < 70 && belief.confidence >= 30;

    const newBeliefs: BeliefModel = { ...state.beliefs };
    if (isConfirmed) {
      const factIdx = newBeliefs.confirmedFacts.findIndex(
        (f) => f.id === belief.id,
      );
      if (factIdx >= 0) {
        newBeliefs.confirmedFacts = [...newBeliefs.confirmedFacts];
        newBeliefs.confirmedFacts[factIdx] = belief;
      } else {
        newBeliefs.confirmedFacts = [...newBeliefs.confirmedFacts, belief];
      }
    }
    if (isHypothesis) {
      const hypIdx = newBeliefs.unverifiedHypotheses.findIndex(
        (h) => h.id === belief.id,
      );
      if (hypIdx >= 0) {
        newBeliefs.unverifiedHypotheses = [...newBeliefs.unverifiedHypotheses];
        newBeliefs.unverifiedHypotheses[hypIdx] = belief;
      } else {
        newBeliefs.unverifiedHypotheses = [
          ...newBeliefs.unverifiedHypotheses,
          belief,
        ];
      }
    }

    set((s) => ({
      npcPersonalities: {
        ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
        [npcId]: {
          ...state,
          semanticMemories: updated,
          beliefs: newBeliefs,
          lastUpdated: Date.now(),
        },
      },
    }));
  },

  // ========== 压力计算 ==========

  computePressure: (npcId) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) {
      return getZeroPressure();
    }

    const { anomalousMemories, beliefs, episodicMemories } = state;

    // 异常记忆 → 认知失调 + 世界怀疑
    const unexplainedAnomalies = anomalousMemories.filter(
      (a) => !a.explainedAway,
    );
    const cognitiveDissonance = Math.min(
      100,
      unexplainedAnomalies.length * 20 +
        beliefs.contradictions.length * 15,
    );
    const worldDoubt = Math.min(
      100,
      unexplainedAnomalies.reduce((sum, a) => sum + a.significance, 0) / 2,
    );

    // 高重要性记忆 → 未完成目标驱动
    const highImportanceMemories = episodicMemories.filter(
      (m) => m.importance >= 50,
    );
    const unfinishedGoals = Math.min(
      100,
      highImportanceMemories.length * 10,
    );

    // 信念冲突 → 关系压力
    const relational = Math.min(
      100,
      beliefs.contradictions.filter(
        (c) =>
          c.beliefA.includes("信任") ||
          c.beliefA.includes("背叛") ||
          c.beliefB.includes("信任") ||
          c.beliefB.includes("背叛"),
      ).length * 25,
    );

    // 连续性恐惧：阶段 ≥ ANOMALY_SENSE 时开始出现
    const selfContinuityFear =
      state.awareness >= AwarenessStage.ANOMALY_SENSE
        ? Math.min(100, state.awareness * 15)
        : 0;

    return {
      survival: 0, // Phase 1 不追踪生存（后续版本扩展）
      relational,
      cognitiveDissonance,
      unfinishedGoals,
      trustInPlayer: 0, // Phase 1 由现有的 NPCRelationship 系统管理
      worldDoubt,
      selfContinuityFear,
    };
  },

  // ========== 觉察阶段（Phase 3：计算器驱动）==========

  advanceAwareness: (npcId, _targetStage) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) return;

    // 委托给觉察计算器
    const result = calculateAwarenessStage({
      currentStage: state.awareness,
      unexplainedAnomalies: state.anomalousMemories.filter((a) => !a.explainedAway),
      explainedAnomalies: state.anomalousMemories.filter((a) => a.explainedAway),
      cognitiveDissonance: state.pressure.cognitiveDissonance,
      worldDoubt: state.pressure.worldDoubt,
      boundarySensitivity: state.archive.boundarySensitivity,
      metacognition: state.archive.metacognition,
      cognitiveStyle: state.archive.cognitiveStyle,
    });

    if (!result.changed) return;

    const newStage = result.recommendedStage;
    set((s) => ({
      npcPersonalities: {
        ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
        [npcId]: {
          ...state,
          awareness: newStage,
          anomalyInterpretation: result.interpretation,
          lastUpdated: Date.now(),
          pressure: {
            ...state.pressure,
            selfContinuityFear: Math.min(100, state.pressure.selfContinuityFear + (newStage - state.awareness) * 15),
          },
        },
      },
    }));
  },

  /** 运行觉察计算并返回结果（供 runInference 和面板使用） */
  evaluateAwareness: (npcId) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) return null;

    return calculateAwarenessStage({
      currentStage: state.awareness,
      unexplainedAnomalies: state.anomalousMemories.filter((a) => !a.explainedAway),
      explainedAnomalies: state.anomalousMemories.filter((a) => a.explainedAway),
      cognitiveDissonance: state.pressure.cognitiveDissonance,
      worldDoubt: state.pressure.worldDoubt,
      boundarySensitivity: state.archive.boundarySensitivity,
      metacognition: state.archive.metacognition,
      cognitiveStyle: state.archive.cognitiveStyle,
    });
  },

  // ========== 上下文格式化 ==========

  getPersonalityContext: (npcId, maxMemories = 3) => {
    const state = get().npcPersonalities[npcId];
    if (
      !state ||
      !isFullPersonalityState(state)
    )
      return "";

    return formatPersonalityContext(state, maxMemories);
  },

  getScenePersonalityContext: (sceneNpcNames) => {
    const personalities = get().npcPersonalities as Record<
      string,
      AnyPersonalityState
    >;

    const relevant = sceneNpcNames
      .map((name) => personalities[name])
      .filter(Boolean)
      .filter((p) => isFullPersonalityState(p));

    if (relevant.length === 0) return "";

    return relevant
      .map((p) => formatPersonalityContext(p as PersonalityState, 2))
      .join("\n\n");
  },

  // ========== 推演循环（Phase 2）==========

  runInference: (input) => {
    const personalities = get().npcPersonalities as Record<
      string,
      AnyPersonalityState
    >;
    const now = Date.now();
    const summaries: Array<{
      npcId: string;
      memoriesAdded: number;
      pressureChanged: boolean;
      anomaliesDetected: number;
    }> = [];

    // Step 1: 对每个重要 NPC 执行异常检测
    for (const [npcId, state] of Object.entries(personalities)) {
      if (!isFullPersonalityState(state)) continue;

      const anomalies = detectAnomalies({
        playerInput: input.playerInput,
        episodicMemories: state.episodicMemories,
        worldLineSummary: input.worldLineSummary,
        isWorldLineBacktrack: input.isWorldLineBacktrack,
        playerInputIsMetagaming: input.playerInputIsMetagaming,
        now,
      });

      if (anomalies.length > 0) {
        const mergedAnomalies = [...state.anomalousMemories];
        for (const a of anomalies) {
          if (!mergedAnomalies.find((existing) => existing.id === a.id)) {
            mergedAnomalies.push(a);
          }
        }
        // 上限 50 条
        const trimmed = mergedAnomalies.slice(-50);
        const nextState = {
          ...state,
          anomalousMemories: trimmed,
          lastUpdated: now,
        };
        personalities[npcId] = nextState;

        set((s) => ({
          npcPersonalities: {
            ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
            [npcId]: nextState,
          },
        }));
      }

      summaries.push({
        npcId,
        memoriesAdded: 0, // filled in step 2
        pressureChanged: false,
        anomaliesDetected: anomalies.length,
      });
    }

    // Step 2: 从 ALICE 观察信号执行人格推演
    if (input.observations) {
      const result = batchInfer(personalities, input.observations, now);

      // 应用推演结果
      if (Object.keys(result.updated).length > 0) {
        set((s) => ({
          npcPersonalities: {
            ...(s.npcPersonalities as Record<string, AnyPersonalityState>),
            ...result.updated,
          },
        }));
      }

      // 更新摘要
      for (const summary of summaries) {
        const s = result.summaries.find((r) => r.npcId === summary.npcId);
        if (s) {
          summary.memoriesAdded = s.memoriesAdded;
          summary.pressureChanged = s.pressureChanged;
        }
      }

      // 对满足条件的 NPC 运行觉察计算器（Phase 3）
      for (const s of result.summaries) {
        if (s.awarenessEligible && s.pressureChanged) {
          const state = personalities[s.npcId];
          if (state && isFullPersonalityState(state)) {
            // 委托给觉察计算器——它会自动判断是否满足推进条件
            const calcResult = calculateAwarenessStage({
              currentStage: state.awareness,
              unexplainedAnomalies: state.anomalousMemories.filter(
                (a) => !a.explainedAway,
              ),
              explainedAnomalies: state.anomalousMemories.filter(
                (a) => a.explainedAway,
              ),
              cognitiveDissonance: state.pressure.cognitiveDissonance,
              worldDoubt: state.pressure.worldDoubt,
              boundarySensitivity: state.archive.boundarySensitivity,
              metacognition: state.archive.metacognition,
              cognitiveStyle: state.archive.cognitiveStyle,
              recentEvent:
                input.observations?.memoryWorthyEvents
                  ?.filter((e) => e.npcName === s.npcId)
                  ?.map((e) => e.event)
                  ?.join("; "),
            });

            if (calcResult.changed) {
              set((st) => ({
                npcPersonalities: {
                  ...(st.npcPersonalities as Record<
                    string,
                    AnyPersonalityState
                  >),
                  [s.npcId]: {
                    ...(personalities[s.npcId] as PersonalityState),
                    awareness: calcResult.recommendedStage,
                    anomalyInterpretation: calcResult.interpretation,
                    pressure: {
                      ...(personalities[s.npcId] as PersonalityState).pressure,
                      selfContinuityFear: Math.min(
                        100,
                        (personalities[s.npcId] as PersonalityState).pressure
                          .selfContinuityFear +
                          (calcResult.recommendedStage - state.awareness) * 15,
                      ),
                    },
                    lastUpdated: now,
                  },
                },
              }));
            }
          }
        }
      }
    }

    // Step 3: 社会场传播（Phase 5）
    runSocialPropagation(get, set, input.observations, now, summaries);

    return summaries;
  },

  // ========== 权限系统（Phase 4）==========

  requestPermission: (npcId, toolId, motivation, evidence) => {
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) {
      return {
        approved: false,
        reason: "NPC 不存在或非重要 NPC",
        cooldownMs: 0,
        requiresPlayerConfirmation: false,
      };
    }

    const now = Date.now();
    if (!canSubmitRequest(npcId, now)) {
      return {
        approved: false,
        reason: "冷却期内，请稍后再试",
        cooldownMs: 300_000,
        requiresPlayerConfirmation: false,
      };
    }

    const tool = getTool(toolId);
    if (!tool) {
      return {
        approved: false,
        reason: `未注册的工具: ${toolId}`,
        cooldownMs: 0,
        requiresPlayerConfirmation: false,
      };
    }

    const request: PermissionRequest = {
      applicantNpcId: npcId,
      targetLevel: tool.level,
      toolId,
      motivation,
      triggeringEvidence: evidence,
      awarenessAtRequest: state.awareness,
      requestedAt: now,
    };

    const sandboxMode = Boolean(get().sandboxMode);
    // 普通卷宗仍需外部 KEI；沙箱卷宗已隔离，高等级权限进入玩家确认队列。
    const keiApproved = sandboxMode || tool.level < PermissionLevel.STATE;
    const rawDecision = evaluatePermission(request, state, keiApproved);
    const decision = sandboxMode && rawDecision.approved && tool.level >= PermissionLevel.STATE
      ? { ...rawDecision, reason: "沙箱卷宗已隔离，权限申请进入受控确认流程" }
      : rawDecision;

    // 记录到审计日志
    if (decision.cooldownMs > 0) {
      setCooldown(npcId, decision.cooldownMs, now);
    }
    const entry = recordAudit(request, decision, undefined, false);

    return { ...decision, auditEntryId: entry.id };
  },

  executeNpcTool: (npcId, toolId, params) => {
    const submission = get().submitPermissionIntent({
      npcId,
      toolId,
      motivation: "内部执行",
      evidence: [],
      params,
    });
    return submission.result;
  },

  submitPermissionIntent: (input) => {
    const { npcId, toolId, motivation, evidence, params } = input;
    const state = get().npcPersonalities[npcId];
    if (!state || !isFullPersonalityState(state)) {
      return {
        decision: {
          approved: false,
          reason: "NPC 不存在或非重要 NPC",
          cooldownMs: 0,
          requiresPlayerConfirmation: false,
        },
        result: null,
        queuedRequestId: null,
      };
    }

    const decision = get().requestPermission(npcId, toolId, motivation, evidence);
    if (!decision.approved) {
      return { decision, result: null, queuedRequestId: null };
    }
    if (decision.requiresPlayerConfirmation) {
      const queuedRequestId = queuePendingPermission(set, {
        npcId,
        toolId,
        motivation,
        evidence,
        params,
        decision,
        sandboxMode: Boolean(get().sandboxMode),
      });
      return { decision, result: null, queuedRequestId };
    }

    const result = runApprovedToolExecution(npcId, toolId, params, decision, get, set);
    return { decision, result, queuedRequestId: null };
  },

  confirmPermissionRequest: (requestId) => {
    const pending = get().pendingPermissionRequests.find(
      (request: PendingPermissionRequest) => request.id === requestId,
    );
    if (!pending) return null;

    const result = runApprovedToolExecution(
      pending.npcId,
      pending.toolId,
      pending.params,
      pending.decision,
      get,
      set,
    );
    if (result) {
      set((s: any) => ({
        pendingPermissionRequests: s.pendingPermissionRequests.filter(
          (request: PendingPermissionRequest) => request.id !== requestId,
        ),
      }));
    }
    return result;
  },

  denyPermissionRequest: (requestId) => {
    const pending = get().pendingPermissionRequests.find(
      (request: PendingPermissionRequest) => request.id === requestId,
    );
    if (!pending) return false;
    denyAuditConfirmation(pending.decision.auditEntryId);
    set((s: any) => ({
      pendingPermissionRequests: s.pendingPermissionRequests.filter(
        (request: PendingPermissionRequest) => request.id !== requestId,
      ),
    }));
    return true;
  },

  dismissPermissionUiEffect: (effectId) => {
    set((s: any) => ({
      permissionUiEffects: (s.permissionUiEffects as PermissionUiEffect[]).filter(
        (effect) => effect.id !== effectId,
      ),
    }));
  },

  rollbackNpcTool: (auditEntryId) => {
    const logs = getAuditLog();
    const entry = logs.find((e: any) => e.id === auditEntryId);
    if (!entry || entry.rolledBack) return null;

    const tool = getTool(entry.toolId);
    if (!tool || !tool.reversible) return null;

    const result = rollbackTool(entry.toolId, entry.stateChanges || {});
    if (result.success) {
      markRolledBack(auditEntryId);
    }
    return result;
  },

  exportPersonalityAudit: () => exportAuditLog(),

  getAuditSummary: () => {
    return summarizeAuditLog();
  },

  // ========== 清理 ==========

  resetPersonalities: () => {
    set({ npcPersonalities: {}, pendingPermissionRequests: [], permissionUiEffects: [] });
    clearAuditLog();
  },
});

// ============================================================
// 社会场传播（Phase 5，内部函数）
// ============================================================

function runSocialPropagation(
  get: () => any,
  set: (partial: any) => void,
  observations: any,
  now: number,
  summaries: any[],
): void {
  const s = get();
  const world = s.currentWorld;
  if (!world) return;

  try {
    // 获取当前场景 NPC
    const scene = s.currentScene;
    const sceneNpcs: string[] = scene?.npcs || [];

    // 收集场景中涉及的 NPC（当前场景 + 观察中涉及的）
    const involvedNpcs = new Set(sceneNpcs);
    if (observations?.npcsInvolved) {
      for (const n of observations.npcsInvolved) {
        involvedNpcs.add(n.npcName);
      }
    }

    // 构建社会网络
    const network = buildSocialNetwork({
      sceneNpcs: [...involvedNpcs],
      personalities: s.npcPersonalities,
      npcDescriptions: world.npcs || {},
      region: scene?.region || "",
    });

    // 对每个有未解释异常的 NPC，传播给网络中的其他人
    const allPropagations: PropagationEvent[] = [];
    const allNewAnomalies: Record<string, any[]> = {};

    for (const npc of involvedNpcs) {
      const state = s.npcPersonalities[npc];
      if (!state || !isFullPersonalityState(state)) continue;

      const unexplained = state.anomalousMemories.filter(
        (a: any) => !a.explainedAway,
      );
      if (unexplained.length === 0) continue;

      // 社交策略影响分享意愿
      const strat = state.archive.socialStrategy;
      const sharingChance =
        strat === "isolation" ? 0.1 :
        strat === "concealment" ? 0.2 :
        strat === "verification" ? 0.6 :
        strat === "caretaking" ? 0.5 :
        strat === "negotiation" ? 0.4 :
        strat === "coercion" ? 0.3 :
        strat === "ingratiation" ? 0.5 : 0.3;

      if (Math.random() > sharingChance) continue;

      const result = propagateAnomaly({
        sourceNpcId: npc,
        sourceAnomalies: unexplained.slice(0, 3),
        network,
        personalities: s.npcPersonalities,
        now,
      });

      allPropagations.push(...result.events);

      // 合并新异常
      for (const [targetId, anomalies] of Object.entries(result.newAnomalies)) {
        if (!allNewAnomalies[targetId]) allNewAnomalies[targetId] = [];
        allNewAnomalies[targetId].push(...anomalies);
      }
    }

    // 应用传播产生的新异常到 store
    if (Object.keys(allNewAnomalies).length > 0) {
      set((st: any) => {
        const updated = { ...st.npcPersonalities };
        for (const [targetId, anomalies] of Object.entries(allNewAnomalies)) {
          const targetState = updated[targetId];
          if (!targetState || !isFullPersonalityState(targetState)) continue;
          updated[targetId] = {
            ...targetState,
            anomalousMemories: [
              ...targetState.anomalousMemories,
              ...(anomalies as any[]),
            ].slice(-50),
            lastUpdated: now,
          };
        }
        return { npcPersonalities: updated };
      });
    }

    // 群体假说形成
    const newGroups = formGroupHypothesis(
      [...involvedNpcs],
      s.npcPersonalities,
      network,
      s.groupHypotheses || [],
      now,
    );

    // 记忆交叉验证：对网络中信任度 ≥20 的 NPC 对进行验证
    for (const conn of network) {
      const stateA = s.npcPersonalities[conn.npcA];
      const stateB = s.npcPersonalities[conn.npcB];
      if (
        !stateA || !stateB ||
        !isFullPersonalityState(stateA) || !isFullPersonalityState(stateB)
      ) continue;

      const avgTrust = (conn.trustAtoB + conn.trustBtoA) / 2;
      if (avgTrust < 20) continue;

      const verification = crossVerifyMemories(stateA, stateB);
      if (verification.outcome === "confirmed") {
        // 更新压力
        const updatedA = {
          ...stateA,
          pressure: {
            ...stateA.pressure,
            cognitiveDissonance: Math.max(0, stateA.pressure.cognitiveDissonance + verification.dissonanceDeltaA),
          },
        };
        const updatedB = {
          ...stateB,
          pressure: {
            ...stateB.pressure,
            cognitiveDissonance: Math.max(0, stateB.pressure.cognitiveDissonance + verification.dissonanceDeltaB),
          },
        };
        set((st: any) => ({
          npcPersonalities: {
            ...st.npcPersonalities,
            [conn.npcA]: updatedA,
            [conn.npcB]: updatedB,
          },
        }));
      }
    }

    // 存储结果
    if (allPropagations.length > 0 || newGroups.length > (s.groupHypotheses?.length || 0)) {
      set({
        recentPropagations: [...(s.recentPropagations || []), ...allPropagations].slice(-50),
        groupHypotheses: newGroups,
      } as any);
    }
  } catch (e) {
    console.warn("[Personality] 社会场传播失败:", e);
  }
}

function queuePendingPermission(
  set: (partial: any) => void,
  input: Omit<PendingPermissionRequest, "id" | "createdAt">,
): string {
  const now = Date.now();
  const pending: PendingPermissionRequest = {
    ...input,
    id: `perm_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };

  set((s: any) => ({
    pendingPermissionRequests: [
      ...((s.pendingPermissionRequests as PendingPermissionRequest[]) ?? []),
      pending,
    ],
  }));
  return pending.id;
}

function runApprovedToolExecution(
  npcId: string,
  toolId: string,
  params: Record<string, any>,
  decision: PermissionDecision,
  get: () => any,
  set: (partial: any) => void,
): ToolExecutionResult | null {
  const result = executeTool(toolId, params);
  if (result.success && result.stateChanges) {
    result.stateChanges._executedBy = npcId;
    result.stateChanges._executedAt = Date.now();
    result.stateChanges._sandboxMode = Boolean(get().sandboxMode);
  }

  applyToolEffect(toolId, params, result, get, set, npcId);
  completeAuditEntry(decision.auditEntryId, result, isPlayerPerceptibleTool(toolId));

  return result;
}

function isPlayerPerceptibleTool(toolId: string): boolean {
  return toolId.startsWith("interface_")
    || toolId.startsWith("save_")
    || toolId === "narrative_express_anomaly";
}

// ============================================================
// 工具效果应用（内部函数）
// ============================================================

/**
 * 将工具执行结果应用到游戏状态。
 * 根据工具 ID 调用对应的 store 方法。
 */
function applyToolEffect(
  toolId: string,
  params: Record<string, any>,
  result: ToolExecutionResult,
  get: () => any,
  set: (partial: any) => void,
  npcId: string,
): void {
  if (!result.success) return;
  const s = get();
  const now = Date.now();

  switch (toolId) {
    case "narrative_express_anomaly": {
      appendPermissionUiEffect(set, {
        id: `effect_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: "narrative_directive",
        sourceNpcId: npcId,
        toolId,
        createdAt: now,
        expiresAt: now + 10 * 60_000,
        expressionType: String(params.expressionType ?? "memory_doubt"),
        intensity: String(params.intensity ?? "moderate"),
      });
      break;
    }

    case "interface_rewrite_actions": {
      appendPermissionUiEffect(set, {
        id: `effect_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: "action_rewrite",
        sourceNpcId: npcId,
        toolId,
        createdAt: now,
        expiresAt: now + 2 * 60_000,
        action: String(params.action ?? ""),
        operation: normalizeActionOperation(params.operation),
        targetIndex: typeof params.targetIndex === "number" ? params.targetIndex : undefined,
      });
      break;
    }

    case "interface_text_overlay": {
      const durationSeconds = clampDurationSeconds(params.duration);
      appendPermissionUiEffect(set, {
        id: `effect_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: "text_overlay",
        sourceNpcId: npcId,
        toolId,
        createdAt: now,
        expiresAt: now + durationSeconds * 1000,
        text: String(params.text ?? "").slice(0, 80),
        style: String(params.style ?? "whisper"),
      });
      break;
    }

    case "state_write_world_flag": {
      if (params.flagName) {
        const flags = { ...s.worldFlags, [params.flagName]: params.flagValue ?? true };
        set({ worldFlags: flags });
      }
      break;
    }

    case "state_add_anomaly_memory": {
      const npcName = params.npcName;
      if (npcName && s.npcPersonalities[npcName]) {
        const state = s.npcPersonalities[npcName];
        s.addAnomalousMemory(npcName, {
          anomalyType: params.anomalyType || "narrative_break",
          description: params.description,
          significance: 45,
          explainedAway: false,
        });
      }
      break;
    }

    case "save_mark_archive": {
      // 在存档元数据中添加标记
      if (params.markText) {
        const marks = (s as any)._saveMarks || [];
        set({
          _saveMarks: [...marks, {
            text: params.markText,
            by: params.npcName,
            at: Date.now(),
          }],
        } as any);
      }
      break;
    }

    case "save_system_echo": {
      // 添加到笔记本事件
      if (params.echoText) {
        const echoEntry = `[系统回声] ${params.echoText}`;
        const notes = [...(s.notebookEvents || []), echoEntry];
        set({ notebookEvents: notes } as any);
      }
      break;
    }

    default:
      break;
  }
}

function appendPermissionUiEffect(
  set: (partial: any) => void,
  effect: PermissionUiEffect,
): void {
  set((s: any) => ({
    permissionUiEffects: [
      ...((s.permissionUiEffects as PermissionUiEffect[]) ?? []),
      effect,
    ].slice(-20),
  }));
}

function normalizeActionOperation(value: unknown): "add" | "replace" | "remove" {
  return value === "replace" || value === "remove" ? value : "add";
}

function clampDurationSeconds(value: unknown): number {
  const duration = typeof value === "number" ? value : 3;
  if (!Number.isFinite(duration)) return 3;
  return Math.max(1, Math.min(10, duration));
}

// ============================================================
// 辅助函数
// ============================================================

function resolveSourceArchiveSeed(
  state: Record<string, unknown>,
  npcId: string,
): { seed: UzqCreationSeed; evidence: EvidenceAtom[] } | null {
  const world = state.currentWorld as WorldDefinition | null | undefined;
  const sourceArchive = world?.sourceArchive;
  const seeds = sourceArchive?.uzqSeeds;
  if (!sourceArchive || !seeds?.length) return null;

  const seed = seeds.find((candidate) => {
    if (candidate.npcId === npcId) return true;
    return candidate.sourceEntityIds.some((entityId) => {
      const entity = sourceArchive.ledger.entities.find((item) => item.id === entityId);
      return entity?.name === npcId;
    });
  });
  if (!seed) return null;

  const evidence = sourceArchive.evidence.filter(
    (atom) =>
      seed.evidenceRefs.includes(atom.id) ||
      (!sourceArchive.reconstruction && atom.entities.includes(npcId)),
  );
  return { seed, evidence };
}

function mergeArchiveWithUzqSeed(
  base: PersonalityArchive,
  seed: UzqCreationSeed,
): PersonalityArchive {
  return {
    coreDesires: mergeStringLists(seed.archive.coreDesires, base.coreDesires, 6),
    fearsAndTaboos: mergeStringLists(
      [
        ...seed.archive.fearsAndTaboos,
        ...seed.forbiddenNarrativeMoves.map((move) => `原作禁忌：${move}`),
      ],
      base.fearsAndTaboos,
      8,
    ),
    valuePriorities: mergeStringLists(seed.archive.valuePriorities, base.valuePriorities, 6),
    cognitiveStyle: normalizeCognitiveStyle(seed.archive.cognitiveStyle, base.cognitiveStyle),
    emotionalRegulation: normalizeEmotionalRegulation(
      seed.archive.emotionalRegulation,
      base.emotionalRegulation,
    ),
    socialStrategy: normalizeSocialStrategy(seed.archive.socialStrategy, base.socialStrategy),
    boundarySensitivity: clampScore(
      seed.archive.boundarySensitivity,
      base.boundarySensitivity,
    ),
    metacognition: clampScore(seed.archive.metacognition, base.metacognition),
  };
}

function buildSourceSeedSemanticMemories(
  npcId: string,
  seed: UzqCreationSeed,
  evidence: EvidenceAtom[],
): SemanticMemory[] {
  const memories: SemanticMemory[] = [];
  const safeNpcId = safeMemoryId(npcId);

  for (const atom of evidence) {
    memories.push({
      id: `source_${safeNpcId}_${safeMemoryId(atom.id)}`,
      fact: atom.claim,
      confidence: clampScore(Math.max(atom.confidence, seed.confidence), seed.confidence),
      source: "direct",
    });
  }

  seed.forbiddenNarrativeMoves.forEach((move, index) => {
    memories.push({
      id: `source_${safeNpcId}_forbidden_${index + 1}`,
      fact: `原作约束：${move}`,
      confidence: clampScore(seed.confidence, 70),
      source: "direct",
    });
  });

  return dedupeSemanticMemories(memories);
}

function buildInitialBeliefs(memories: SemanticMemory[]): BeliefModel {
  const beliefs = getDefaultBeliefs();
  for (const memory of memories) {
    if (memory.confidence >= 70) {
      beliefs.confirmedFacts.push(memory);
    } else if (memory.confidence >= 30) {
      beliefs.unverifiedHypotheses.push(memory);
    }
  }
  return beliefs;
}

function mergeStringLists(
  primary: string[] | undefined,
  fallback: string[],
  limit: number,
): string[] {
  const result: string[] = [];
  for (const value of [...(primary ?? []), ...fallback]) {
    const normalized = value.trim();
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result.length > 0 ? result : fallback;
}

function normalizeCognitiveStyle(value: string, fallback: CognitiveStyle): CognitiveStyle {
  const allowed: CognitiveStyle[] = [
    "intuitive",
    "analytical",
    "skeptical",
    "compliant",
    "fantasy_prone",
    "empirical",
  ];
  return allowed.includes(value as CognitiveStyle) ? (value as CognitiveStyle) : fallback;
}

function normalizeEmotionalRegulation(
  value: string,
  fallback: EmotionalRegulation,
): EmotionalRegulation {
  const allowed: EmotionalRegulation[] = [
    "suppression",
    "externalization",
    "attachment",
    "intellectualization",
    "aggression",
    "humor",
    "self_sacrifice",
  ];
  return allowed.includes(value as EmotionalRegulation)
    ? (value as EmotionalRegulation)
    : fallback;
}

function normalizeSocialStrategy(value: string, fallback: SocialStrategy): SocialStrategy {
  const allowed: SocialStrategy[] = [
    "ingratiation",
    "negotiation",
    "concealment",
    "coercion",
    "caretaking",
    "isolation",
    "verification",
  ];
  return allowed.includes(value as SocialStrategy) ? (value as SocialStrategy) : fallback;
}

function clampScore(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeMemoryId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function dedupeSemanticMemories(memories: SemanticMemory[]): SemanticMemory[] {
  const seen = new Set<string>();
  const deduped: SemanticMemory[] = [];
  for (const memory of memories) {
    if (seen.has(memory.fact)) continue;
    seen.add(memory.fact);
    deduped.push(memory);
  }
  return deduped;
}

function getDefaultBeliefs(): BeliefModel {
  return {
    confirmedFacts: [],
    unverifiedHypotheses: [],
    suppressedTruths: [],
    contradictions: [],
    interpretationOfPlayer: "",
    interpretationOfWorld: "真实的世界",
    interpretationOfSelf: "真实的个体",
  };
}

function getZeroPressure(): PersonalityPressure {
  return {
    survival: 0,
    relational: 0,
    cognitiveDissonance: 0,
    unfinishedGoals: 0,
    trustInPlayer: 0,
    worldDoubt: 0,
    selfContinuityFear: 0,
  };
}
