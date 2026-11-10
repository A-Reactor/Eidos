import type { GameplayPlugin, GameplaySetting } from './types';

export type ModPreferenceValue = boolean | number | string;
export type ModPreferences = Record<string, Record<string, ModPreferenceValue>>;
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);

/** Retain preferences for uninstalled packages, but never arbitrary objects or host data. */
export function normalizeModPreferences(value: unknown): ModPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ModPreferences = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!safeKey(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    result[id] = Object.fromEntries(Object.entries(raw).filter(([key, v]) => safeKey(key) && (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v)))) as Record<string, ModPreferenceValue>;
  }
  return result;
}
export function settingValue(setting: GameplaySetting, value: unknown): ModPreferenceValue {
  if (setting.type === 'boolean') return typeof value === 'boolean' ? value : setting.default;
  if (setting.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? Math.max(setting.min ?? -Infinity, Math.min(setting.max ?? Infinity, value)) : setting.default;
  if (setting.type === 'select') return typeof value === 'string' && setting.options?.includes(value) ? value : setting.default;
  return typeof value === 'string' ? value : setting.default;
}
export function pluginPreferences(plugin: GameplayPlugin, preferences: ModPreferences): Record<string, ModPreferenceValue> {
  return Object.fromEntries((plugin.settings ?? []).map(s => [s.id, settingValue(s, preferences[plugin.id]?.[s.id])]));
}

/** Merge only edited fields so a different settings window can save other mod choices. */
export function mergeModPreferenceDraft(remote: ModPreferences, baseline: ModPreferences, local: ModPreferences): ModPreferences {
  const result = normalizeModPreferences(remote);
  for (const id of new Set([...Object.keys(baseline), ...Object.keys(local)])) {
    for (const key of new Set([...Object.keys(baseline[id] ?? {}), ...Object.keys(local[id] ?? {})])) {
      if (baseline[id]?.[key] === local[id]?.[key]) continue;
      result[id] = { ...result[id] };
      if (local[id]?.[key] === undefined) delete result[id][key];
      else result[id][key] = local[id][key];
    }
  }
  return result;
}
