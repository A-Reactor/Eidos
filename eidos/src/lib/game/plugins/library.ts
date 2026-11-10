import catalog from './catalog.json';
import { parseGameplayPlugins } from './manifest';
import { allowedFields, PluginInputError, record } from './validation';
import type { GameplayPlugin } from './types';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';
import { saveFile, type SaveFileResult } from '../save-file';

export const PLUGIN_LIBRARY_KEY = 'eidos_gameplay_plugin_library_v1';
export const PLUGIN_LIBRARY_CHANGED = 'eidos:gameplay-library-changed';
export const pluginContentKey = (plugin: GameplayPlugin): string => stableRecordJSON(plugin);
export function distinctPluginVersions(plugins: readonly GameplayPlugin[]): GameplayPlugin[] {
  const seen = new Set<string>();
  return plugins.filter(plugin => {
    const key = pluginContentKey(plugin);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function validatedLibrary(input: unknown): GameplayPlugin[] {
  if (!Array.isArray(input)) throw new PluginInputError('玩法插件须为列表');
  // The library keeps revisions; an enabled world manifest still requires unique IDs.
  const plugins = input.flatMap(value => parseGameplayPlugins([value]));
  if (plugins.some(plugin => catalog.some(builtin => builtin.id === plugin.id))) throw new PluginInputError('自定义插件不能覆盖内置插件');
  return distinctPluginVersions(plugins);
}

export function parsePluginLibraryFile(value: unknown): GameplayPlugin[] {
  return validatedLibrary(Array.isArray(value) ? value : [value]);
}
export function mergePluginLibrary(base: GameplayPlugin[], imported: GameplayPlugin[]): GameplayPlugin[] {
  return validatedLibrary([...base, ...imported]);
}

export function loadPluginLibrary(): { plugins: GameplayPlugin[]; error?: string } {
  if (typeof window === 'undefined') return { plugins: [] };
  try {
    const raw = localStorage.getItem(PLUGIN_LIBRARY_KEY);
    if (!raw) return { plugins: [] };
    const saved = record(JSON.parse(raw));
    allowedFields(saved, ['format', 'version', 'plugins']);
    if (saved.format !== 'eidos-gameplay-library' || saved.version !== 1) throw new PluginInputError('插件库格式不支持');
    return { plugins: validatedLibrary(saved.plugins) };
  } catch {
    return { plugins: [], error: '本机插件库暂时无法读取，原数据已保留。仍可在此次创建中导入插件。' };
  }
}
export function savePluginLibrary(plugins: GameplayPlugin[]): void {
  const checked = validatedLibrary(plugins);
  if (typeof window === 'undefined') throw new PluginInputError('本机插件库需要在应用中保存');
  // Never overwrite damaged cached authoring files with an empty fallback.
  const current = loadPluginLibrary();
  if (current.error) throw new PluginInputError(current.error);
  try { localStorage.setItem(PLUGIN_LIBRARY_KEY, JSON.stringify({ format: 'eidos-gameplay-library', version: 1, plugins: checked })); }
  catch { throw new PluginInputError('插件已用于此次创建，但本机插件库保存失败，请导出文件备份。'); }
  window.dispatchEvent(new Event(PLUGIN_LIBRARY_CHANGED));
}
export function exportPluginFile(plugins: GameplayPlugin[]): string {
  const checked = distinctPluginVersions(plugins.flatMap(plugin => parseGameplayPlugins([plugin])));
  if (!checked.length) throw new PluginInputError('没有可导出的插件');
  const data = checked.length === 1 ? checked[0] : checked;
  return JSON.stringify(data, null, 2) + '\n';
}
export function downloadPluginFile(plugins: GameplayPlugin[]): Promise<SaveFileResult> {
  const content = exportPluginFile(plugins);
  return saveFile(new Blob([content], { type: 'application/json' }), plugins.length === 1 ? `${plugins[0].id}.json` : 'eidos-gameplay-plugins.json');
}
