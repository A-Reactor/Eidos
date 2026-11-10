import { summarizeCacheUsage } from '@/lib/ai/cache-usage';
import type { TelemetryCallRecord } from '@/store/slices/telemetry-slice';

export const MODEL_ANALYTICS_STORAGE_KEY = 'eidos_model_analytics_v1';
const MODELS = ['alice', 'kei', 'uzq'] as const;
const DAILY_HISTORY_LIMIT = 90;
const TREND_DAYS = 7;
type Model = typeof MODELS[number];
type CacheTotals = Omit<ReturnType<typeof summarizeCacheUsage>, 'hitRate'>;
export interface DailyModelCalls { date: string; calls: number; failures: number }
export interface ModelAnalytics {
  totalCalls: number;
  successfulCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
  timedCalls: number;
  cache: CacheTotals;
  models: Record<Model, { calls: number; tokens: number }>;
  daily: DailyModelCalls[];
  speculationHits: number;
  speculationMisses: number;
}
export interface StoredModelAnalytics {
  version: 1;
  total: ModelAnalytics;
  worlds: Record<string, ModelAnalytics>;
}

const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function createModelAnalytics(): ModelAnalytics {
  return { totalCalls: 0, successfulCalls: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0,
    elapsedMs: 0, timedCalls: 0, speculationHits: 0, speculationMisses: 0, daily: [],
    cache: { reportedCalls: 0, unknownCalls: 0, estimatedCalls: 0, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, uncachedPromptTokens: 0 },
    models: { alice: { calls: 0, tokens: 0 }, kei: { calls: 0, tokens: 0 }, uzq: { calls: 0, tokens: 0 } } };
}

function recordDailyCall(daily: DailyModelCalls[], call: TelemetryCallRecord) {
  if (!Number.isFinite(call.timestamp) || call.timestamp < 0 || call.timestamp >= 8.64e15) return daily;
  const date = dayKey(new Date(call.timestamp));
  const previous = daily.find(day => day.date === date);
  const day = { date, calls: (previous?.calls ?? 0) + 1, failures: (previous?.failures ?? 0) + (call.success === false ? 1 : 0) };
  return [...daily.filter(day => day.date !== date), day].sort((a, b) => a.date.localeCompare(b.date)).slice(-DAILY_HISTORY_LIMIT);
}

export function recordModelCall(previous: ModelAnalytics, call: TelemetryCallRecord): ModelAnalytics {
  const cache = summarizeCacheUsage([call]);
  const timed = Number.isFinite(call.elapsedMs) && call.elapsedMs > 0;
  const model = previous.models[call.model];
  return { ...previous,
    totalCalls: previous.totalCalls + 1, successfulCalls: previous.successfulCalls + (call.success === false ? 0 : 1),
    totalTokens: previous.totalTokens + nonnegative(call.totalTokens),
    promptTokens: previous.promptTokens + nonnegative(call.promptTokens),
    completionTokens: previous.completionTokens + nonnegative(call.completionTokens),
    elapsedMs: previous.elapsedMs + (timed ? call.elapsedMs : 0), timedCalls: previous.timedCalls + (timed ? 1 : 0),
    models: { ...previous.models, [call.model]: { calls: model.calls + 1, tokens: model.tokens + nonnegative(call.totalTokens) } },
    cache: {
      reportedCalls: previous.cache.reportedCalls + cache.reportedCalls, unknownCalls: previous.cache.unknownCalls + cache.unknownCalls,
      estimatedCalls: previous.cache.estimatedCalls + cache.estimatedCalls, promptTokens: previous.cache.promptTokens + cache.promptTokens,
      cachedTokens: previous.cache.cachedTokens + cache.cachedTokens, cacheWriteTokens: previous.cache.cacheWriteTokens + cache.cacheWriteTokens,
      uncachedPromptTokens: previous.cache.uncachedPromptTokens + cache.uncachedPromptTokens,
    },
    daily: recordDailyCall(previous.daily, call),
  };
}

export function summarizeModelAnalytics(analytics: ModelAnalytics) {
  return { ...analytics,
    successRate: analytics.totalCalls ? analytics.successfulCalls / analytics.totalCalls : undefined,
    averageElapsedMs: analytics.timedCalls ? analytics.elapsedMs / analytics.timedCalls : undefined,
    cache: { ...analytics.cache, hitRate: analytics.cache.promptTokens ? analytics.cache.cachedTokens / analytics.cache.promptTokens : undefined },
    models: MODELS.map(model => ({ model, ...analytics.models[model] })),
  };
}

export function buildCallTimeline(analytics: ModelAnalytics, now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: TREND_DAYS }, (_, index) => {
    // Calendar days can be 23 or 25 hours when daylight saving time changes.
    const date = new Date(today); date.setDate(date.getDate() - (TREND_DAYS - 1 - index));
    const day = analytics.daily.find(day => day.date === dayKey(date));
    return { timestamp: date.getTime(), calls: day?.calls ?? 0, failures: day?.failures ?? 0 };
  });
  return { buckets };
}

function isAnalytics(value: unknown): value is ModelAnalytics {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ModelAnalytics, empty = createModelAnalytics();
  const validCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  return Object.keys(empty).filter(key => !['cache', 'models', 'daily'].includes(key)).every(key => validCount(candidate[key as keyof ModelAnalytics]))
    && !!candidate.cache && Object.keys(empty.cache).every(key => validCount(candidate.cache[key as keyof CacheTotals]))
    && !!candidate.models && MODELS.every(model => candidate.models[model] && validCount(candidate.models[model].calls) && validCount(candidate.models[model].tokens))
    && Array.isArray(candidate.daily) && candidate.daily.length <= DAILY_HISTORY_LIMIT
    && candidate.daily.every(day => day && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && validCount(day.calls) && validCount(day.failures));
}

export function parseModelAnalytics(value: unknown): StoredModelAnalytics | null {
  const data = value as StoredModelAnalytics | null;
  return data?.version === 1 && isAnalytics(data.total) && data.worlds && typeof data.worlds === 'object'
    && !Array.isArray(data.worlds) && Object.values(data.worlds).every(isAnalytics) ? data : null;
}
