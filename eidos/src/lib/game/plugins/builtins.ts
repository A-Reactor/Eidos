import manifests from './builtin-guides.json';
import { parseGameplayPlugins, pluginIdentifier, PluginInputError } from './manifest';

export const BUILTIN_GAMEPLAY_PLUGINS = parseGameplayPlugins(manifests);
export function resolveGameplayPlugins(ids: unknown = [], custom: unknown = []) {
  if (!Array.isArray(ids) || ids.some(id => !pluginIdentifier(id)) || new Set(ids).size !== ids.length) throw new PluginInputError('玩法 ID 列表无效');
  const imported = parseGameplayPlugins(custom);
  if (imported.some(plugin => BUILTIN_GAMEPLAY_PLUGINS.some(builtin => builtin.id === plugin.id))) throw new PluginInputError('自定义插件不能覆盖内置插件');
  const available = [...BUILTIN_GAMEPLAY_PLUGINS, ...imported];
  return ids.map(id => {
    const plugin = available.find(p => p.id === id);
    if (!plugin) throw new PluginInputError(`未知玩法插件：${id}`);
    return plugin;
  });
}
