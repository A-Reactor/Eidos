import type { WorldDefinition } from '../types';
import { parseGameplayPlugins } from './manifest';
import { resourceInteger } from './resource-manifest';
import { PluginInputError, record } from './validation';

export const resourceKey = (pluginId: string, resourceId: string) => `gameplay.${pluginId}.${resourceId}`;

/** Missing legacy fields use declared defaults; a stored zero remains a zero. */
export function normalizeGameplayResources(world: Pick<WorldDefinition, 'gameplayPlugins'>, input?: unknown): Record<string, number> {
  const plugins = parseGameplayPlugins(world.gameplayPlugins);
  const stored = input === undefined ? {} : record(input);
  const next: Record<string, number> = {};
  for (const plugin of plugins) {
    for (const [id, definition] of Object.entries(plugin.resources ?? {})) {
      const key = resourceKey(plugin.id, id);
      const value = Object.hasOwn(stored, key) ? resourceInteger(stored[key]) : definition.initial;
      if (value < definition.min || value > definition.max) throw new PluginInputError(`资源存档超出上下限：${plugin.name} / ${definition.name}`);
      next[key] = value;
    }
  }
  if (Object.keys(stored).some(key => !Object.hasOwn(next, key))) throw new PluginInputError('资源存档包含未知插件或资源');
  return next;
}
