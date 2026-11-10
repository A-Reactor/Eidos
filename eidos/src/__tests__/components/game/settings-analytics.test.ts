// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EidosShell } from '@/components/shell/EidosShell';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { useGameStore } from '@/store/game-store';
import type { TelemetryCallRecord } from '@/store/slices/telemetry-slice';
import { MODEL_ANALYTICS_STORAGE_KEY, type StoredModelAnalytics } from '@/lib/game/model-analytics';
import { loadMeta } from '@/lib/game/storage';

const call: TelemetryCallRecord = {
  timestamp: new Date('2026-11-04T04:00:00Z').getTime(), callType: 'alice_action', model: 'alice',
  promptTokens: 1000, completionTokens: 200, totalTokens: 1200,
  cachedTokens: 800, uncachedPromptTokens: 200, cacheUsageReported: true,
  elapsedMs: 2000, success: true,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('eidos_settings', JSON.stringify(DEFAULT_SETTINGS));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  useGameStore.setState({ ...useGameStore.getInitialState(), phase: 'settings', navigationStack: [] });
});
afterEach(async () => {
  cleanup();
  if (useGameStore.getState().modelAnalytics) await useGameStore.getState().hydrateModelAnalytics();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const flushAnalytics = () => act(async () => { await useGameStore.getState().hydrateModelAnalytics(); });

function openAnalytics() {
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  fireEvent.click(screen.getByRole('button', { name: '数据管理' }));
  return within(screen.getByRole('region', { name: '运行统计' }));
}

it('shows actual runtime metrics in data management and updates when a call is recorded', () => {
  useGameStore.setState({ aiCalls: [call], speculationHits: 3, speculationMisses: 1 });
  const analytics = openAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('1');
  expect(analytics.getByLabelText('Token 用量').textContent).toContain('1,200');
  expect(analytics.getByRole('meter', { name: '缓存命中率' }).getAttribute('aria-valuenow')).toBe('80');
  expect(analytics.getByRole('meter', { name: '预生成命中率' }).getAttribute('aria-valuenow')).toBe('75');
  act(() => useGameStore.getState().recordAiCall({ ...call, model: 'kei', callType: 'kei_quality', success: false, elapsedMs: 4000 }));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('2');
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('50%');
  expect(analytics.getByLabelText('平均耗时').textContent).toContain('3.0 s');
  expect(analytics.getByRole('meter', { name: 'KEI 调用占比' }).getAttribute('aria-valuenow')).toBe('50');
});

it('keeps absent cache reporting distinct from measured zero hits and handles an empty runtime', () => {
  const analytics = openAnalytics();
  expect(analytics.getByText('暂无调用记录')).not.toBeNull();
  expect(analytics.queryByRole('meter', { name: '缓存命中率' })).toBeNull();
  expect(analytics.queryByRole('meter', { name: '预生成命中率' })).toBeNull();
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('—');
  act(() => useGameStore.getState().recordAiCall({ ...call, cachedTokens: 0, cacheUsageReported: false }));
  expect(analytics.queryByRole('meter', { name: '缓存命中率' })).toBeNull();
  act(() => useGameStore.getState().recordAiCall({ ...call, cachedTokens: 0, uncachedPromptTokens: 1000 }));
  expect(analytics.getByRole('meter', { name: '缓存命中率' }).getAttribute('aria-valuenow')).toBe('0');
});

it('localizes the analytics alongside the existing settings page', () => {
  localStorage.setItem('eidos_settings', JSON.stringify({ ...DEFAULT_SETTINGS, interfaceLanguage: 'en' }));
  render(React.createElement(EidosShell, null, React.createElement(SettingsScreen)));
  fireEvent.click(screen.getByRole('button', { name: 'Data management' }));
  const analytics = within(screen.getByRole('region', { name: 'Runtime analytics' }));
  expect(analytics.getByRole('heading', { name: 'Call activity' })).not.toBeNull();
  expect(analytics.getByLabelText('Model calls').textContent).toContain('0');
});

it('continues accumulated statistics after a restart and a runtime telemetry reset', async () => {
  useGameStore.getState().recordAiCall(call);
  useGameStore.getState().recordSpeculationHit();
  useGameStore.getState().recordSpeculationMiss();
  await flushAnalytics();
  expect((await loadMeta<StoredModelAnalytics>(MODEL_ANALYTICS_STORAGE_KEY))?.total.totalCalls).toBe(1);
  useGameStore.getState().resetTelemetry();
  useGameStore.setState({ ...useGameStore.getInitialState(), phase: 'settings' });
  const analytics = openAnalytics();
  await flushAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('1');
  expect(analytics.getByRole('meter', { name: '预生成命中率' }).getAttribute('aria-valuenow')).toBe('50');
  expect(analytics.queryByText(/重新累计|刷新或重启/)).toBeNull();
  act(() => useGameStore.getState().recordAiCall(call));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('2');
  await flushAnalytics();
  expect((await loadMeta<StoredModelAnalytics>(MODEL_ANALYTICS_STORAGE_KEY))?.total.totalCalls).toBe(2);
});

it('merges saved totals when the first call arrives before the settings page opens', async () => {
  useGameStore.getState().recordAiCall(call);
  useGameStore.setState(useGameStore.getInitialState());
  useGameStore.getState().recordAiCall({ ...call, model: 'kei', callType: 'kei_quality', success: false });
  const analytics = openAnalytics();
  await flushAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('2');
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('50%');
  expect(analytics.getByRole('meter', { name: 'ALICE 调用占比' }).getAttribute('aria-valuenow')).toBe('50');
});

it('shows only the open world inside an archive and all worlds outside it, even with a stale currentWorld', async () => {
  const worldA = { id: 'analytics-a', name: '世界 A' } as never;
  const worldB = { id: 'analytics-b', name: '世界 B' } as never;
  useGameStore.setState({ currentWorld: worldA });
  useGameStore.getState().recordAiCall(call);
  useGameStore.getState().recordSpeculationHit();
  useGameStore.setState({ currentWorld: worldB });
  useGameStore.getState().recordAiCall({ ...call, model: 'kei', callType: 'kei_quality', success: false });
  useGameStore.getState().recordSpeculationMiss();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: worldA, phase: 'settings', navigationStack: ['playing'] });
  const analytics = openAnalytics();
  await flushAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('1');
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('100%');
  expect(analytics.getByRole('meter', { name: '预生成命中率' }).getAttribute('aria-valuenow')).toBe('100');
  act(() => useGameStore.setState({ currentWorld: worldB }));
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('0%');
  expect(analytics.getByRole('meter', { name: '预生成命中率' }).getAttribute('aria-valuenow')).toBe('0');
  act(() => useGameStore.setState({ navigationStack: ['world_select'] }));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('2');
  expect(analytics.getByLabelText('调用成功率').textContent).toContain('50%');
});

it('retains the request world for calls finishing after the player switches worlds', () => {
  useGameStore.setState({ currentWorld: { id: 'analytics-b', name: '世界 B' } as never });
  useGameStore.getState().addTokenUsage({ ...call, worldId: 'analytics-a' });
  useGameStore.getState().addTokenUsage({ ...call, worldId: null });
  useGameStore.setState({ currentWorld: { id: 'analytics-a', name: '世界 A' } as never,
    phase: 'settings', navigationStack: ['playing'] });
  const analytics = openAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('1');
  act(() => useGameStore.setState({ currentWorld: { id: 'analytics-b', name: '世界 B' } as never }));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('0');
  act(() => useGameStore.setState({ navigationStack: [] }));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('2');
});

it('recovers from malformed saved statistics without breaking settings or new counters', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.setItem(MODEL_ANALYTICS_STORAGE_KEY, '{broken');
  const analytics = openAnalytics();
  expect(analytics.getByLabelText('模型调用').textContent).toContain('0');
  act(() => useGameStore.getState().recordAiCall(call));
  expect(analytics.getByLabelText('模型调用').textContent).toContain('1');
  expect(warning).toHaveBeenCalled();
});
