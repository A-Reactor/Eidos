// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { parseGameplayPlugins, parsePluginFile } from '@/lib/game/plugins/manifest';
import { loadPluginLibrary, savePluginLibrary, mergePluginLibrary, exportPluginFile, PLUGIN_LIBRARY_KEY } from '@/lib/game/plugins/library';
import { resourcePluginDraft } from './gameplay-resource-fixtures';
const plugin = () => parseGameplayPlugins([resourcePluginDraft])[0];
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('keeps validated plugins across sessions and exports a portable full manifest', () => {
  savePluginLibrary([plugin()]);
  expect(loadPluginLibrary().plugins[0].resources?.stamina.initial).toBe(3);
  const exported = parsePluginFile(JSON.parse(exportPluginFile(loadPluginLibrary().plugins)));
  expect(exported[0].rules.find(rule => rule.id === 'explore')?.resourceChanges).toEqual({ stamina: -2 });
  expect(exported[0].prompts.review).toBe('核对实际行动与消耗依据');
});
it('persists distinct content under the same manifest ID and deduplicates reimports', () => {
  expect(mergePluginLibrary([plugin()], [plugin()])).toHaveLength(1);
  const edited = { ...plugin(), name: '旅途补给第二版' };
  const variants = mergePluginLibrary([plugin()], [edited, plugin(), edited]);
  savePluginLibrary(variants);
  expect(loadPluginLibrary().plugins.map(p => p.name)).toEqual(['旅途补给', '旅途补给第二版']);
  expect(() => parseGameplayPlugins(variants)).toThrow(/ID/);
});
it('refuses builtin overrides and unsupported executable fields before persistence', () => {
  savePluginLibrary([plugin()]);
  const before = localStorage.getItem(PLUGIN_LIBRARY_KEY);
  expect(() => savePluginLibrary([{ ...plugin(), id: 'mystery' }])).toThrow();
  expect(() => savePluginLibrary([{ ...plugin(), script: 'fetch()' } as never])).toThrow();
  expect(localStorage.getItem(PLUGIN_LIBRARY_KEY)).toBe(before);
});
it('reports corrupt cached data and refuses to silently overwrite it', () => {
  localStorage.setItem(PLUGIN_LIBRARY_KEY, '{bad-json');
  expect(loadPluginLibrary().error).toMatch(/插件库/);
  expect(() => savePluginLibrary([plugin()])).toThrow();
  expect(localStorage.getItem(PLUGIN_LIBRARY_KEY)).toBe('{bad-json');
});
it('reports quota failures while leaving the previous library intact', () => {
  savePluginLibrary([plugin()]);
  const before = localStorage.getItem(PLUGIN_LIBRARY_KEY);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  expect(() => savePluginLibrary([])).toThrow(/保存/);
  expect(localStorage.getItem(PLUGIN_LIBRARY_KEY)).toBe(before);
});
it('exports Unicode libraries beyond the former byte limit without content loss', () => {
  const large = { ...plugin(), prompts: { creation: '字'.repeat(12000), action: '字'.repeat(12000), review: '字'.repeat(12000) } };
  const plugins = [{ ...large, id: 'large-a' }, { ...large, id: 'large-b' }];
  const source = exportPluginFile(plugins);
  expect(new TextEncoder().encode(source).byteLength).toBeGreaterThan(200000);
  expect(parsePluginFile(JSON.parse(source))).toEqual(plugins);
});
