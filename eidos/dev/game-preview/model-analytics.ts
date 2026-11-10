import { createModelAnalytics, MODEL_ANALYTICS_STORAGE_KEY, recordModelCall, type StoredModelAnalytics } from '@/lib/game/model-analytics';
import { updateDurableMeta } from '@/lib/game/storage';
import { useGameStore } from '@/store/game-store';
import type { TelemetryCallRecord } from '@/store/slices/telemetry-slice';

// Deterministic chart fixtures live on the preview origin, without calling a provider.
export function seedModelAnalyticsPreview(scenario: string, worldId: string) {
  const stored: StoredModelAnalytics = { version: 1, total: createModelAnalytics(), worlds: {} };
  const calls: TelemetryCallRecord[] = [];
  const today = new Date();
  if (scenario !== 'analytics-empty') for (const [scope, counts] of [[worldId, [4, 9, 3, 10, 13, 8, 15]], ['preview-other-world', [2, 0, 3, 2, 1, 3, 4]]] as const) {
    stored.worlds[scope] = createModelAnalytics();
    counts.forEach((count, index) => {
      const date = new Date(today); date.setDate(date.getDate() - 6 + index); date.setHours(9, 0, 0, 0);
      for (let i = 0; i < count; i++) {
        const model = (['alice', 'kei', 'uzq'] as const)[i % 3];
        const record: TelemetryCallRecord = { timestamp: date.getTime() + i * 60_000, worldId: scope, model,
          callType: model === 'alice' ? 'alice_action' : model === 'kei' ? 'kei_quality' : 'uzq_personality',
          promptTokens: 2400 + i * 100, completionTokens: 360, totalTokens: 2760 + i * 100,
          cachedTokens: 1800, uncachedPromptTokens: 600 + i * 100, cacheUsageReported: true,
          elapsedMs: 1800 + i * 170, success: i !== 8 };
        calls.push(record);
        stored.total = recordModelCall(stored.total, record);
        stored.worlds[scope] = recordModelCall(stored.worlds[scope], record);
      }
    });
    stored.worlds[scope].speculationHits = scope === worldId ? 12 : 6;
    stored.worlds[scope].speculationMisses = scope === worldId ? 4 : 3;
  }
  stored.total.speculationHits = scenario === 'analytics-empty' ? 0 : 18;
  stored.total.speculationMisses = scenario === 'analytics-empty' ? 0 : 7;
  void updateDurableMeta(MODEL_ANALYTICS_STORAGE_KEY, () => stored).catch(error => console.warn('[Preview] Statistics fixture was not stored', error));
  useGameStore.setState({ aiCalls: calls, modelAnalytics: stored, phase: 'settings',
    navigationStack: scenario === 'analytics-total' ? ['world_select'] : ['playing'] });
}
