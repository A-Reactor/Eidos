// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { parseGlobalPlugin, parseGlobalPluginFile } from '@/lib/game/global-plugins/manifest';
import { GLOBAL_PLUGIN_LIBRARY_KEY, getGlobalPluginLibrary, installGlobalPlugins, setGlobalPluginEnabled, setGlobalPluginPreference, removeGlobalPlugin } from '@/lib/game/global-plugins/library';
it('retires the former Japanese voice plugin while preserving other installed plugins', () => {
  localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY, JSON.stringify({ format: 'eidos-global-plugin-state', version: 1, entries: [
    { plugin: { format: 'eidos-global-plugin', version: 1, id: 'eidos-japanese-voice', name: '日语语音材料', release: '1.0.0', description: '旧内置扩展', script: 'api.voice.registerJapaneseMaterial();' }, enabled: true, preferences: {} },
    { plugin: { format: 'eidos-global-plugin', version: 1, id: 'keep-plugin', name: '保留插件', release: '1.0.0', description: '其他插件', css: 'body {}' }, enabled: false, preferences: {} },
  ] }));
  expect(getGlobalPluginLibrary().entries.map(entry => entry.plugin.id)).toEqual(['keep-plugin']);
});
const definition = { format: 'eidos-global-plugin', version: 1, id: 'reading-lab', name: '阅读实验室', release: '1.0.0', description: '跨世界的样式和逻辑', script: 'return () => {};', settings: [{ id: 'density', type: 'number', label: '密度', default: 2, min: 1, max: 4 }] };
beforeEach(() => localStorage.clear());
it('imports disabled, preserves preferences, and disables replacements before their new code can execute', () => {
  const plugin = parseGlobalPlugin(definition);
  installGlobalPlugins([plugin]);
  expect(getGlobalPluginLibrary().entries[0]).toMatchObject({ enabled: false, preferences: { density: 2 } });
  setGlobalPluginEnabled(plugin.id, true); setGlobalPluginPreference(plugin.id, 'density', 3);
  installGlobalPlugins([parseGlobalPlugin({ ...definition, release: '2.0.0', script: 'return undefined;' })]);
  expect(getGlobalPluginLibrary().entries[0]).toMatchObject({ plugin: { release: '2.0.0' }, enabled: false, preferences: { density: 3 } });
});
it('validates the whole import before modifying the library and rejects world plugin files', () => {
  installGlobalPlugins([parseGlobalPlugin(definition)]);
  const before = localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY);
  expect(() => parseGlobalPluginFile(JSON.stringify([{ ...definition, id: 'another' }, { ...definition, format: 'eidos-gameplay-plugin' }]))).toThrow();
  expect(() => parseGlobalPlugin({ ...definition, id: '__proto__' })).toThrow();
  expect(() => parseGlobalPlugin({ ...definition, version: 99 })).toThrow();
  expect(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY)).toBe(before);
});
it('retains a damaged library and refuses to overwrite it with a fallback', () => {
  localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY, 'damaged source');
  expect(getGlobalPluginLibrary().error).toBeTruthy();
  expect(() => installGlobalPlugins([parseGlobalPlugin(definition)])).toThrow();
  expect(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY)).toBe('damaged source');
});
it('bounds preferences by their schema and never mutates world preferences or unrelated storage', () => {
  localStorage.setItem('eidos_settings', 'untouched');
  installGlobalPlugins([parseGlobalPlugin(definition)]);
  setGlobalPluginPreference('reading-lab', 'density', 90);
  expect(getGlobalPluginLibrary().entries[0].preferences.density).toBe(4);
  expect(() => setGlobalPluginPreference('reading-lab', 'unknown', true)).toThrow();
  removeGlobalPlugin('reading-lab');
  expect(getGlobalPluginLibrary().entries).toHaveLength(0);
  expect(localStorage.getItem('eidos_settings')).toBe('untouched');
});
it('returns a stable snapshot until storage really changes, including changes from another window', () => {
  const first = getGlobalPluginLibrary(); expect(getGlobalPluginLibrary()).toBe(first);
  installGlobalPlugins([parseGlobalPlugin(definition)]);
  const saved = getGlobalPluginLibrary();
  const data = JSON.parse(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY)!); data.entries[0].enabled = true;
  localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY, JSON.stringify(data));
  expect(getGlobalPluginLibrary()).not.toBe(saved);
  expect(getGlobalPluginLibrary().entries[0].enabled).toBe(true);
});
