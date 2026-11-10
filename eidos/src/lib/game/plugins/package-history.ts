import type { WorldDefinition } from '../types';
import type { GameplayPlugin } from './types';
import { parseGameplayPlugins } from './manifest';
import { record } from './validation';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';

export interface GameplayPackageHistory {
  initial: string;
  current: string;
  packages: Record<string, GameplayPlugin[]>;
}
/** A manual save may predate packages in the separately persisted worldline graph. */
export function mergePluginArchives(world: WorldDefinition, graph?: GameplayPackageHistory): WorldDefinition {
  if (!graph) return world;
  const saved = world.gameplayPluginHistory;
  if (saved && saved.initial !== graph.initial) throw new Error('模组版本历史不属于同一世界线');
  for (const [key, value] of Object.entries(saved?.packages ?? {})) {
    if (graph.packages[key] && stableRecordJSON(value) !== stableRecordJSON(graph.packages[key])) throw new Error('模组版本历史冲突，请恢复完整备份');
  }
  const merged = { ...world, gameplayPluginHistory: { ...graph, packages: { ...graph.packages, ...saved?.packages } } };
  return worldAtPluginSet(merged, saved?.current ?? graph.initial);
}
/** Legacy nodes select the package set used before the first explicit update. */
export function worldAtPluginSet(world: WorldDefinition, reference?: string): WorldDefinition {
  const history = world.gameplayPluginHistory;
  if (!history) {
    if (reference) throw new Error('存档引用的模组版本缺失');
    return world;
  }
  const key = reference ?? history.initial, packages = record(history.packages);
  if (!/^[a-f0-9]{16}$/.test(key) || !Object.hasOwn(packages, key)) throw new Error('存档引用的模组版本缺失');
  return { ...world, gameplayPlugins: parseGameplayPlugins(packages[key]), gameplayPluginHistory: { ...history, current: key } };
}
