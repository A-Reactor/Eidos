import type { GameplayPlugin } from './types';

/** Conditions reuse accepted world flags; absent conditions preserve older packages. */
export function isGameplayPluginActive(plugin: GameplayPlugin, flags: Record<string, boolean> = {}, sceneId?: string): boolean {
  const condition = plugin.activation;
  if (!condition) return true;
  if (condition.scenes?.length && (!sceneId || !condition.scenes.includes(sceneId))) return false;
  return Object.entries(condition.requires).every(([id, expected]) => Boolean(flags[`gameplay.${plugin.id}.${id}`]) === expected);
}
