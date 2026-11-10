import { describe, expect, it } from 'vitest';
import { buildCallTimeline, createModelAnalytics, recordModelCall, summarizeModelAnalytics } from '@/lib/game/model-analytics';
import type { TelemetryCallRecord } from '@/store/slices/telemetry-slice';

const start = new Date('2026-11-04T04:00:00Z').getTime();
const call: TelemetryCallRecord = {
  timestamp: start, callType: 'alice_action', model: 'alice',
  promptTokens: 1000, completionTokens: 100, totalTokens: 1100,
  cachedTokens: 800, uncachedPromptTokens: 200, cacheUsageReported: true,
  elapsedMs: 2000, success: true,
};
const analyticsFor = (calls: TelemetryCallRecord[]) => calls.reduce(recordModelCall, createModelAnalytics());

describe('runtime analytics', () => {
  it('weights cache hits by reported input tokens and includes failed calls in success and usage totals', () => {
    const result = summarizeModelAnalytics(analyticsFor([
      call,
      { ...call, model: 'kei', promptTokens: 100, cachedTokens: 0, uncachedPromptTokens: 100, totalTokens: 200, elapsedMs: 4000, success: false },
      { ...call, usageEstimated: true, elapsedMs: 0 },
      { ...call, cacheUsageReported: false, elapsedMs: NaN },
    ]));
    expect(result).toMatchObject({ totalCalls: 4, successfulCalls: 3, successRate: .75,
      totalTokens: 3500, promptTokens: 3100, completionTokens: 400, averageElapsedMs: 3000,
      cache: { hitRate: 800 / 1100, reportedCalls: 2, unknownCalls: 1, estimatedCalls: 1 } });
    expect(result.models).toMatchObject([{ model: 'alice', calls: 3, tokens: 3300 }, { model: 'kei', calls: 1, tokens: 200 }, { model: 'uzq', calls: 0, tokens: 0 }]);
  });

  it('leaves ratios and latency unknown when no observations exist', () => {
    expect(summarizeModelAnalytics(createModelAnalytics())).toMatchObject({ totalCalls: 0, totalTokens: 0,
      successRate: undefined, averageElapsedMs: undefined, cache: { hitRate: undefined } });
    expect(buildCallTimeline(createModelAnalytics()).buckets.every(bucket => bucket.calls === 0)).toBe(true);
  });

  it('groups unsorted calls by local calendar day and fills days without calls', () => {
    const today = new Date(2026, 10, 4, 14).getTime();
    const yesterday = new Date(2026, 10, 3).getTime();
    const midnight = new Date(2026, 10, 4).getTime();
    const timeline = buildCallTimeline(analyticsFor([
      { ...call, timestamp: midnight, success: false },
      { ...call, timestamp: midnight - 1 },
      { ...call, timestamp: yesterday },
    ]), today);
    expect(timeline.buckets).toHaveLength(7);
    expect(timeline.buckets.slice(-2)).toEqual([
      { timestamp: yesterday, calls: 2, failures: 0 },
      { timestamp: midnight, calls: 1, failures: 1 },
    ]);
    expect(timeline.buckets[0].calls).toBe(0);
  });

  it('keeps only the last seven calendar days, including the first midnight and excluding tomorrow', () => {
    const today = new Date(2026, 10, 4, 14).getTime();
    const firstDay = new Date(2026, 9, 29).getTime();
    const timeline = buildCallTimeline(analyticsFor([
      { ...call, timestamp: firstDay }, { ...call, timestamp: firstDay - 1 },
      { ...call, timestamp: new Date(2026, 10, 5).getTime() },
      { ...call, timestamp: NaN },
    ]), today);
    expect(timeline.buckets).toHaveLength(7);
    expect(timeline.buckets.reduce((sum, bucket) => sum + bucket.calls, 0)).toBe(1);
    expect(timeline.buckets[0]).toEqual({ timestamp: firstDay, calls: 1, failures: 0 });
    expect(timeline.buckets.at(-1)!.timestamp).toBe(new Date(2026, 10, 4).getTime());
  });
});
