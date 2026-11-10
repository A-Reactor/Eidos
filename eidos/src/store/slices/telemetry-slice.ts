// ============================================================
// Eidos · 运行时遥测 Slice
// ============================================================
// 收集 AI 调用、因果预测、性能等运行时指标。
// 数据在游戏过程中持续累积，导出时一并写入 JSON。
// ============================================================

import type { TokenUsage } from "@/lib/ai/types";
import { createModelAnalytics, MODEL_ANALYTICS_STORAGE_KEY, parseModelAnalytics, recordModelCall, type ModelAnalytics, type StoredModelAnalytics } from '@/lib/game/model-analytics';
import { createUsageLedger } from '@/lib/game/usage-ledger';

// ============================================================
// 类型
// ============================================================

/** AI 调用类型细粒度标签 */
export type CallType =
  | "alice_action"
  | "alice_stream"
  | "alice_introspection"
  | "alice_identity"
  | "alice_npc_pov"
  | "alice_diary"
  | "kei_light"
  | "kei_quality"
  | "kei_causal"
  | "uzq_personality"
  | "uzq_gameplay_design"
  | "speculation"
  | "world_create";

/** 单次 AI 调用记录（精简版——导出时用） */
export interface TelemetryCallRecord extends Pick<TokenUsage, 'uncachedPromptTokens' | 'cacheWriteTokens' | 'cacheUsageReported' | 'providerId' | 'modelId' | 'firstTokenMs' | 'usageEstimated' | 'finishReason' | 'reasoningTokens' | 'outputChars' | 'errorCode'> {
  worldId?: string | null;
  timestamp: number;
  callType: CallType;
  model: "alice" | "kei" | "uzq";
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  elapsedMs: number;
  success: boolean;
}

/** 因果预测生命周期记录 */
export interface CausalLogEntry {
  predictionId: string;
  triggerAction: string;         // 触发行动摘要
  projectedOutcome: string;      // 预测结果
  confidence: number;            // 置信度 0-1
  estimatedTime: { day: number; hour: number; minute: number };
  involvedNpcs: string[];
  status: "pending" | "fulfilled" | "defied" | "expired";
  createdAt: number;             // 创建时的时间戳
  resolvedAt: number | null;     // 验证时的时间戳
  resolutionNote: string;        // 验证备注
}

export interface TelemetrySlice {
  modelAnalytics: StoredModelAnalytics | null;
  hydrateModelAnalytics: () => Promise<void>;
  /** AI 调用记录（按时间顺序） */
  aiCalls: TelemetryCallRecord[];
  /** 因果预测日志 */
  causalLog: CausalLogEntry[];
  /** 推测引擎统计 */
  speculationHits: number;
  speculationMisses: number;
  /** 差分上下文统计 */
  segmentSkips: number;
  segmentSent: number;

  // Actions
  recordAiCall: (record: TelemetryCallRecord) => void;
  logCausalPrediction: (entry: CausalLogEntry) => void;
  updateCausalStatus: (
    predictionId: string,
    status: "fulfilled" | "defied" | "expired",
    note: string
  ) => void;
  recordSpeculationHit: (worldId?: string | null) => void;
  recordSpeculationMiss: (worldId?: string | null) => void;
  recordSegmentSkip: () => void;
  recordSegmentSent: () => void;
  /** 重置本局遥测 */
  resetTelemetry: () => void;
}

// ============================================================
// Persistent aggregates are separate from raw records exported for the current runtime.
function analyticsFromRuntime(state: TelemetrySlice): StoredModelAnalytics {
  const empty: StoredModelAnalytics = { version: 1, total: createModelAnalytics(), worlds: {} };
  const migrated = state.aiCalls.reduce((analytics, call) => updateAnalytics(analytics, call.worldId, value => recordModelCall(value, call)), empty);
  migrated.total.speculationHits = state.speculationHits;
  migrated.total.speculationMisses = state.speculationMisses;
  return migrated;
}

function updateAnalytics(analytics: StoredModelAnalytics, worldId: string | null | undefined, update: (value: ModelAnalytics) => ModelAnalytics): StoredModelAnalytics {
  return { version: 1, total: update(analytics.total), worlds: worldId ? { ...analytics.worlds,
    [worldId]: update(Object.hasOwn(analytics.worlds, worldId) ? analytics.worlds[worldId] : createModelAnalytics()) } : analytics.worlds };
}

// Slice
// ============================================================

export const createTelemetrySlice = (
  set: (
    partial:
      | Partial<Record<string, any>>
      | ((state: Record<string, any>) => Partial<Record<string, any>>)
  ) => void,
  get: () => any,
  _store?: any
): TelemetrySlice => {
  const ledger = createUsageLedger(MODEL_ANALYTICS_STORAGE_KEY, parseModelAnalytics, modelAnalytics => set({ modelAnalytics }));
  const currentAnalytics = (state: TelemetrySlice) => state.modelAnalytics ?? ledger.legacy() ?? analyticsFromRuntime(state);
  const update = (state: TelemetrySlice, change: (value: StoredModelAnalytics) => StoredModelAnalytics) => {
    const baseline = currentAnalytics(state);
    void ledger.sync(baseline, change);
    return change(baseline);
  };
  return ({
  modelAnalytics: null,
  hydrateModelAnalytics: () => {
    const analytics = currentAnalytics(get());
    set({ modelAnalytics: analytics });
    return ledger.sync(analytics);
  },
  aiCalls: [],
  causalLog: [],
  speculationHits: 0,
  speculationMisses: 0,
  segmentSkips: 0,
  segmentSent: 0,

  recordAiCall: (record) => set((s) => {
    const worldId = record.worldId === undefined ? s.currentWorld?.id ?? null : record.worldId;
    const scoped = { ...record, worldId };
    const analytics = update(s as TelemetrySlice, data => updateAnalytics(data, worldId, value => recordModelCall(value, scoped)));
    return { aiCalls: [...s.aiCalls, scoped], modelAnalytics: analytics };
  }),

  logCausalPrediction: (entry) =>
    set((s) => ({
      causalLog: [...s.causalLog, entry],
    })),

  updateCausalStatus: (predictionId, status, note) =>
    set((s) => ({
      causalLog: s.causalLog.map((e: CausalLogEntry) =>
        e.predictionId === predictionId
          ? { ...e, status, resolvedAt: Date.now(), resolutionNote: note }
          : e
      ),
    })),

  recordSpeculationHit: (worldId = get().currentWorld?.id) => set((s) => {
    const analytics = update(s as TelemetrySlice, data => updateAnalytics(data, worldId, value => ({ ...value, speculationHits: value.speculationHits + 1 })));
    return { speculationHits: s.speculationHits + 1, modelAnalytics: analytics };
  }),

  recordSpeculationMiss: (worldId = get().currentWorld?.id) => set((s) => {
    const analytics = update(s as TelemetrySlice, data => updateAnalytics(data, worldId, value => ({ ...value, speculationMisses: value.speculationMisses + 1 })));
    return { speculationMisses: s.speculationMisses + 1, modelAnalytics: analytics };
  }),

  recordSegmentSkip: () =>
    set((s) => ({ segmentSkips: s.segmentSkips + 1 })),

  recordSegmentSent: () =>
    set((s) => ({ segmentSent: s.segmentSent + 1 })),

  resetTelemetry: () =>
    set({
      aiCalls: [],
      causalLog: [],
      speculationHits: 0,
      speculationMisses: 0,
      segmentSkips: 0,
      segmentSent: 0,
    }),
  });
};
