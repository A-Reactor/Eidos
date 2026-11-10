import type { GameplayPlugin } from './types';
import { BUILTIN_GAMEPLAY_PLUGINS } from './builtins';
import { loadPluginLibrary } from './library';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';

/** Only compare plain numeric releases. Unknown schemes never become a claim of latest. */
export function comparePluginRelease(left?: string, right?: string): number | null {
  if (!left || !right || !/^v?\d+(?:\.\d+)*$/.test(left) || !/^v?\d+(?:\.\d+)*$/.test(right)) return null;
  const a = left.replace(/^v/, '').split('.').map(Number), b = right.replace(/^v/, '').split('.').map(Number);
  if ([...a, ...b].some(value => !Number.isSafeInteger(value))) return null;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta) return Math.sign(delta);
  }
  return 0;
}
export function pluginUpdateCandidates(current: GameplayPlugin) {
  const library = loadPluginLibrary();
  return { error: library.error, candidates: [
    ...library.plugins.filter(plugin => plugin.id === current.id).map(plugin => ({ plugin, source: '本机插件库' })),
    ...BUILTIN_GAMEPLAY_PLUGINS.filter(plugin => plugin.id === current.id).map(plugin => ({ plugin, source: '当前应用内置指南' })),
  ].filter(candidate => stableRecordJSON(candidate.plugin) !== stableRecordJSON(current)).map(candidate => ({ ...candidate, comparison: comparePluginRelease(candidate.plugin.release, current.release) })) };
}
