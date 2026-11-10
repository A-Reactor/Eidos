import type { GameplayPlugin, GameplayReadout } from './types';
import { resourceKey } from './resources';
import { isGameplayPluginActive } from './activation';

export interface ActiveGameplayReadout { key: string; pluginId: string; pluginName: string; definition: GameplayReadout }

/** Project accepted state into text only; visibility never grants or rejects a player action. */
export function activeGameplayReadouts(plugins: GameplayPlugin[], flags: Record<string, boolean> = {}, resources: Record<string, number> = {}, sceneId?: string): ActiveGameplayReadout[] {
  return plugins.filter(plugin => isGameplayPluginActive(plugin, flags, sceneId)).flatMap(plugin => (plugin.readouts ?? []).filter(readout => {
    if (Object.entries(readout.requires).some(([id, expected]) => Boolean(flags[`gameplay.${plugin.id}.${id}`]) !== expected)) return false;
    return Object.entries(readout.resourceRequires).every(([id, bounds]) => {
      const value = resources[resourceKey(plugin.id, id)] ?? plugin.resources![id].initial;
      return value >= (bounds.min ?? -Infinity) && value <= (bounds.max ?? Infinity);
    });
  }).map(definition => ({ key: `gameplay.${plugin.id}.readout:${definition.id}`, pluginId: plugin.id, pluginName: plugin.name, definition })));
}
