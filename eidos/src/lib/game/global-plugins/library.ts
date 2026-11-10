import { record, allowedFields, PluginInputError } from '../plugins/validation';
import { settingValue } from '../plugins/preferences';
import type { ModPreferenceValue } from '../plugins/preferences';
import { parseGlobalPlugin, validateGlobalPlugins } from './manifest';
import type { GlobalPlugin, GlobalPluginEntry, GlobalPluginLibrary } from './types';

export const GLOBAL_PLUGIN_LIBRARY_KEY = 'eidos_global_plugins_v1';
export const GLOBAL_PLUGINS_CHANGED = 'eidos:global-plugins-changed';
const EMPTY: GlobalPluginLibrary = { entries: [] };
let cachedSource: string | null | undefined, cached: GlobalPluginLibrary = EMPTY;
function preferences(plugin: GlobalPlugin, value: unknown) {
  const source = record(value ?? {});
  return Object.fromEntries((plugin.settings ?? []).map(setting => [setting.id, settingValue(setting, source[setting.id])]));
}
function parseLibrary(source: string): GlobalPluginLibrary {
  const data = record(JSON.parse(source)); allowedFields(data, ['format', 'version', 'entries']);
  if (data.format !== 'eidos-global-plugin-state' || data.version !== 1 || !Array.isArray(data.entries)) throw new Error('全局插件库格式不支持');
  const entries = data.entries.map(raw => {
    const entry = record(raw); allowedFields(entry, ['plugin', 'enabled', 'preferences']);
    const plugin = parseGlobalPlugin(entry.plugin);
    if (typeof entry.enabled !== 'boolean') throw new Error('全局插件启用状态无效');
    return { plugin, enabled: entry.enabled, preferences: preferences(plugin, entry.preferences) };
  });
  if (new Set(entries.map(entry => entry.plugin.id)).size !== entries.length) throw new Error('全局插件 ID 重复');
  return { entries: entries.filter(entry => entry.plugin.id !== 'eidos-japanese-voice') };
}
export function getGlobalPluginLibrary(): GlobalPluginLibrary {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const source = localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY);
    if (source === cachedSource) return cached;
    cachedSource = source;
    try { cached = source ? parseLibrary(source) : EMPTY; }
    catch (error) { cached = { entries: [], error: `全局插件库无法读取，原数据已保留：${error instanceof Error ? error.message : '格式错误'}` }; }
    return cached;
  } catch { cachedSource = undefined; return cached.error ? cached : (cached = { entries: [], error: '本机存储不可用，全局插件未加载' }); }
}
export const getServerGlobalPluginLibrary = () => EMPTY;
export function subscribeGlobalPlugins(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === GLOBAL_PLUGIN_LIBRARY_KEY) listener(); };
  window.addEventListener(GLOBAL_PLUGINS_CHANGED, listener); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(GLOBAL_PLUGINS_CHANGED, listener); window.removeEventListener('storage', storage); };
}
function modify(transform: (entries: GlobalPluginEntry[]) => GlobalPluginEntry[]) {
  const before = getGlobalPluginLibrary();
  if (before.error) throw new PluginInputError(before.error);
  const source = JSON.stringify({ format: 'eidos-global-plugin-state', version: 1, entries: transform(before.entries) });
  parseLibrary(source);
  try { localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY, source); }
  catch { throw new Error('全局插件保存失败，请检查本机存储空间'); }
  window.dispatchEvent(new Event(GLOBAL_PLUGINS_CHANGED));
}
export function installGlobalPlugins(input: GlobalPlugin[]) {
  const incoming = validateGlobalPlugins(input);
  modify(entries => {
    const merged = new Map(entries.map(entry => [entry.plugin.id, entry]));
    for (const plugin of incoming) merged.set(plugin.id, { plugin, enabled: false, preferences: preferences(plugin, merged.get(plugin.id)?.preferences) });
    return [...merged.values()];
  });
}
function changeEntry(id: string, transform: (entry: GlobalPluginEntry) => GlobalPluginEntry) {
  modify(entries => {
    if (!entries.some(entry => entry.plugin.id === id)) throw new Error('全局插件不存在');
    return entries.map(entry => entry.plugin.id === id ? transform(entry) : entry);
  });
}
export function setGlobalPluginEnabled(id: string, enabled: boolean) { changeEntry(id, entry => ({ ...entry, enabled })); }
export function setGlobalPluginPreference(id: string, settingId: string, value: ModPreferenceValue) {
  changeEntry(id, entry => {
    const definition = entry.plugin.settings?.find(setting => setting.id === settingId);
    if (!definition) throw new Error('插件设置不存在');
    return { ...entry, preferences: { ...entry.preferences, [settingId]: settingValue(definition, value) } };
  });
}
export function removeGlobalPlugin(id: string) { modify(entries => entries.filter(entry => entry.plugin.id !== id)); }
export function setGlobalPluginIntroduction(id: string, introduction: import('../plugins/introduction').PluginIntroduction) {
  changeEntry(id, entry => ({ ...entry, plugin: { ...entry.plugin, introduction } }));
}
export function exportGlobalPlugins(plugins: GlobalPlugin[]) {
  const data = { format: 'eidos-global-plugin-library', version: 1, plugins: validateGlobalPlugins(plugins) };
  return JSON.stringify(data, null, 2);
}
