import { parsePluginIntroduction } from '../plugins/introduction';
import { allowedFields, pluginIdentifier, PluginInputError, record, text } from '../plugins/validation';
import { parsePluginSettings } from '../plugins/settings-manifest';
import type { GlobalPlugin } from './types';

export function parseGlobalPlugin(input: unknown): GlobalPlugin {
  const raw = record(input);
  allowedFields(raw, ['format', 'version', 'id', 'name', 'release', 'description', 'author', 'css', 'script', 'settings', 'introduction']);
  if (raw.format !== 'eidos-global-plugin' || raw.version !== 1) throw new PluginInputError('请选择 eidos-global-plugin v1 全局插件包，世界模组请在创建世界时加载');
  if (!pluginIdentifier(raw.id)) throw new PluginInputError('全局插件 ID 无效');
  const introduction = parsePluginIntroduction(raw.introduction);
  const result: GlobalPlugin = { format: 'eidos-global-plugin', version: 1, id: raw.id, ...(introduction ? { introduction } : {}),
    name: text(raw.name, Infinity), release: text(raw.release, Infinity), description: text(raw.description, Infinity, false) };
  if (raw.author !== undefined) result.author = text(raw.author, Infinity, false);
  if (raw.css !== undefined) result.css = text(raw.css, Infinity, false);
  if (raw.script !== undefined) result.script = text(raw.script, Infinity, false);
  if (!result.css && !result.script) throw new PluginInputError('插件至少需要 CSS 或 JavaScript');
  const settings = parsePluginSettings(raw.settings);
  if (settings) result.settings = settings;
  return result;
}
export function parseGlobalPluginFile(source: string): GlobalPlugin[] {
  const raw = JSON.parse(source);
  if (raw?.format === 'eidos-global-plugin-library' && raw.version === 1) {
    const value = record(raw); allowedFields(value, ['format', 'version', 'plugins']);
    return validateGlobalPlugins(value.plugins);
  }
  return validateGlobalPlugins(Array.isArray(raw) ? raw : [raw]);
}
export function validateGlobalPlugins(raw: unknown): GlobalPlugin[] {
  if (!Array.isArray(raw) || !raw.length) throw new PluginInputError('全局插件列表须为非空列表');
  const plugins = raw.map(parseGlobalPlugin), ids = new Set(plugins.map(plugin => plugin.id));
  if (ids.size !== plugins.length) throw new PluginInputError('插件包有重复的 ID');
  return plugins;
}
