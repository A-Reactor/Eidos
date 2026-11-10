// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameplayHud } from '@/components/game/GameplayHud';
import { GameplayPluginDetails } from '@/components/game/GameplayPluginDetails';
import { SettingsScreen } from '@/components/game/SettingsScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { finalizeImportedWorld } from '@/lib/game/import-records';
import type { WorldDefinition } from '@/lib/game/types';
import { hudWorld, resourceWorld } from '../../lib/game/gameplay-resource-fixtures';
import { openPlugin } from '../../lib/game/plugin-open-fixtures';
beforeEach(() => useGameStore.setState({ phase: 'settings', previousPhase: 'playing', navigationStack: ['playing'], currentWorld: { ...buildRiftCityStartState().world, ...hudWorld() },
  gameplayResources: { 'gameplay.supplies.stamina': 0, 'gameplay.supplies.food': 2, 'gameplay.supplies.secret': 4 }, worldFlags: {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps loaded mod names in the drawer with no expandable manifest or author controls', () => {
  render(React.createElement(GameplayPluginDetails));
  const reference = screen.getByRole('region', { name: '已加载模组' });
  expect(within(reference).getByText('旅途补给')).toBeTruthy();
  expect(within(reference).getByLabelText('体力资源').textContent).toContain('0');
  expect(reference.querySelector('details')).toBeNull();
  expect(within(reference).queryByText('设计能补给与休息的路径')).toBeNull();
  expect(within(reference).queryByRole('button')).toBeNull();
  act(() => useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, gameplayPlugins: [] } }));
  expect(screen.queryByText('旅途补给')).toBeNull();
});
it('renders optional text from raw imported defaults and reads zero values without mutating the world', () => {
  const world = finalizeImportedWorld({ ...buildRiftCityStartState().world, gameplayPlugins: [openPlugin] } as unknown as WorldDefinition, { existingWorldIds: new Set() });
  const before = JSON.stringify(world.gameplayPlugins);
  useGameStore.getState().setCurrentWorld(world);
  render(React.createElement(React.Fragment, null, React.createElement(GameplayHud), React.createElement(GameplayPluginDetails)));
  const hud = screen.getByRole('region', { name: '玩法 HUD' });
  expect(within(hud).getByText('寻找未知信号')).toBeDefined();
  expect(within(hud).queryByText('可以休息或继续探索')).toBeNull();
  act(() => useGameStore.setState({ gameplayResources: { 'gameplay.open-story.energy': 0 }, worldFlags: { 'gameplay.open-story.found': true } }));
  expect(within(hud).queryByText('寻找未知信号')).toBeNull();
  expect(within(hud).getByText('可以休息或继续探索')).toBeDefined();
  expect(within(hud).queryByRole('button')).toBeNull();
  expect(JSON.stringify(useGameStore.getState().currentWorld?.gameplayPlugins)).toBe(before);
});
it('qualifies same local readout IDs by plugin and keeps omitted flags false', () => {
  useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, gameplayPlugins: parseGameplayPlugins([
    openPlugin, { ...openPlugin, id: 'other-story', readouts: [{ id: 'signal', text: '另一个信号', requires: { found: false } }] },
  ]) }, gameplayResources: {}, worldFlags: { 'gameplay.other-story.found': true } });
  render(React.createElement(GameplayHud));
  const hud = screen.getByRole('region', { name: '玩法 HUD' });
  expect(within(hud).getByText('寻找未知信号')).toBeDefined();
  expect(within(hud).queryByText('另一个信号')).toBeNull();
  act(() => useGameStore.setState({ worldFlags: { 'gameplay.open-story.found': true } }));
  expect(within(hud).queryByText('寻找未知信号')).toBeNull();
  expect(within(hud).getByText('另一个信号')).toBeDefined();
});
it('shares bounded HUD slots with text while preserving full text in the existing drawer', () => {
  const long = '沿着城市中的各种路径自由调查未知信号。'.repeat(12);
  const readouts = [long, '第二条提示', '第三条提示', '第四条提示'].map((text, i) => ({ id: `hint-${i}`, text }));
  useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, gameplayPlugins: parseGameplayPlugins([{ ...openPlugin, readouts }]) }, gameplayResources: {}, worldFlags: {} });
  render(React.createElement(React.Fragment, null, React.createElement(GameplayHud), React.createElement(GameplayPluginDetails)));
  const hud = screen.getByRole('region', { name: '玩法 HUD' });
  expect(within(hud).getByText(long).getAttribute('title')).toContain(long);
  expect(within(hud).queryByText('第四条提示')).toBeNull();
  expect(within(screen.getByRole('region', { name: '玩法提示' })).getByText('第四条提示')).toBeDefined();
  expect(within(screen.getByRole('region', { name: '玩法提示' })).getByText(long)).toBeDefined();
});
it('renders author defaults from an imported raw world without rewriting its manifest', () => {
  const raw = { format: 'eidos-gameplay-plugin', version: 2, id: 'imported', name: '导入仪表', description: '默认显示', tags: [],
    prompts: { creation: '', action: '', review: '' }, resources: { oxygen: { name: '氧气', initial: 4, min: 0, max: 10, hud: { style: 'gauge' } } } };
  const world = finalizeImportedWorld({ ...buildRiftCityStartState().world, gameplayPlugins: [raw] } as unknown as WorldDefinition, { existingWorldIds: new Set() });
  const before = JSON.stringify(world.gameplayPlugins);
  useGameStore.getState().setCurrentWorld(world);
  render(React.createElement(React.Fragment, null, React.createElement(GameplayHud), React.createElement(GameplayPluginDetails)));
  expect(screen.getByRole('meter', { name: '氧气' }).getAttribute('aria-valuenow')).toBe('4');
  expect(screen.getByLabelText('氧气资源').textContent).toContain('4');
  expect(screen.getByText('导入仪表')).toBeDefined();
  expect(JSON.stringify(useGameStore.getState().currentWorld?.gameplayPlugins)).toBe(before);
});
it('renders current HUD values, warnings and ranges while excluding hidden resources', () => {
  render(React.createElement(GameplayHud));
  const hud = screen.getByRole('region', { name: '玩法 HUD' });
  const gauge = within(hud).getByRole('meter', { name: '体力' });
  expect(gauge.getAttribute('aria-valuenow')).toBe('0');
  expect(gauge.getAttribute('aria-valuemax')).toBe('5');
  expect(within(hud).getByLabelText('体力数值').textContent).toContain('0');
  expect(gauge.closest('[data-warning]')?.getAttribute('data-warning')).toBe('true');
  expect(hud.textContent).toContain('偏低');
  expect(hud.textContent).not.toContain('内部进度');
  expect(within(hud).queryByRole('button')).toBeNull();
  act(() => useGameStore.setState({ gameplayResources: { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1 } }));
  expect(gauge.getAttribute('aria-valuenow')).toBe('3');
  expect(hud.textContent).not.toContain('偏低');
  act(() => useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, ...resourceWorld() } }));
  expect(screen.queryByRole('region', { name: '玩法 HUD' })).toBeNull();
});
it('limits crowded HUDs while keeping every visible resource available in the drawer', () => {
  const plugin = hudWorld().gameplayPlugins[0];
  const resources = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`r${i}`, {
    name: `状态${i}`, initial: 1, min: 1, max: 1, unit: '', visible: true,
    hud: { style: 'bar' as const, placement: i < 4 ? 'left' as const : 'right' as const, tone: 'cyan' as const },
  }]));
  useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, gameplayPlugins: [{ ...plugin, resources, rules: [] }] }, gameplayResources: {} });
  render(React.createElement(React.Fragment, null, React.createElement(GameplayHud), React.createElement(GameplayPluginDetails)));
  expect(within(screen.getByRole('region', { name: '玩法 HUD' })).getAllByRole('meter')).toHaveLength(6);
  expect(screen.getAllByLabelText(/^状态[0-9]+资源$/)).toHaveLength(8);
  expect(screen.getByRole('meter', { name: '状态0' }).getAttribute('aria-valuenow')).toBe('1');
});
it('exports a portable full manifest from mod settings without changing the current world', async () => {
  let captured!: Blob, filename = '';
  vi.stubGlobal('showSaveFilePicker', vi.fn(async ({ suggestedName }: { suggestedName: string }) => {
    filename = suggestedName;
    return { createWritable: async () => ({ write: async (blob: Blob) => { captured = blob; }, close: async () => {} }) };
  }));
  const before = useGameStore.getState().currentWorld;
  render(React.createElement(SettingsScreen));
  fireEvent.click(screen.getByRole('button', { name: '旅途补给' }));
  fireEvent.click(screen.getByText('创作说明与完整清单 · 可能包含未发现的设定'));
  expect(screen.getByText('设计能补给与休息的路径')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '导出旅途补给 JSON' }));
  await waitFor(() => expect(captured).toBeInstanceOf(Blob));
  const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(captured); });
  const json = JSON.parse(raw);
  expect(filename).toBe('supplies.json');
  expect(json.resources.stamina.hud.style).toBe('gauge');
  expect(json.rules[0].resourceChanges).toEqual({ stamina: -2 });
  expect(useGameStore.getState().currentWorld).toBe(before);
});
it('exports a large manifest completely from mod settings', async () => {
  let captured!: Blob;
  vi.stubGlobal('showSaveFilePicker', vi.fn(async () => ({ createWritable: async () => ({ write: async (blob: Blob) => { captured = blob; }, close: async () => {} }) })));
  const plugin = hudWorld().gameplayPlugins[0];
  const large = { ...plugin, prompts: { creation: '字'.repeat(12000), action: '字'.repeat(12000), review: '字'.repeat(12000) },
    rules: Array.from({ length: 32 }, (_, i) => ({ id: `rule-${i}`, description: '字'.repeat(1000), sets: { done: true } })) };
  useGameStore.setState({ currentWorld: { ...buildRiftCityStartState().world, gameplayPlugins: parseGameplayPlugins([large]) } });
  render(React.createElement(SettingsScreen));
  fireEvent.click(screen.getByRole('button', { name: '旅途补给' }));
  fireEvent.click(screen.getByRole('button', { name: '导出旅途补给 JSON' }));
  await waitFor(() => expect(captured).toBeInstanceOf(Blob));
  const raw = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(captured); });
  expect(new TextEncoder().encode(raw).length).toBeGreaterThan(200000);
  expect(JSON.parse(raw)).toEqual(useGameStore.getState().currentWorld!.gameplayPlugins![0]);
  expect(screen.queryByRole('alert')).toBeNull();
});
