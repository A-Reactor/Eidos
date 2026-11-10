import type { GameplayPlugin } from './types';
import type { WorldDefinition } from '../types';
import { gameplayContextForModel } from './gameplay-state';
import { withoutLegacyProgress } from '../legacy-progress';

/** Presentation state and HTML stay in local snapshots, outside model transport. */
export function snapshotForModel<T extends { gameplayModState?: unknown; gameplayPluginSet?: string; workspaceState?: unknown; documentHeads?: unknown }>(snapshot: T): Omit<Omit<T, 'gameplayModState' | 'gameplayPluginSet' | 'workspaceState' | 'documentHeads'>, 'endings' | 'achievements'> & { gameplayContext?: import('./gameplay-state').GameplayModelContext[] } {
  const { gameplayModState: _presentation, gameplayPluginSet: _packageReference, workspaceState: _workspace, documentHeads: _documentHeads, ...simulation } = snapshot;
  const gameplayContext = gameplayContextForModel(_presentation as import('./mod-ui').GameplayModState | undefined);
  const memory = (simulation as { rewindMemory?: import('../rewind').RewindMemory }).rewindMemory;
  return { ...withoutLegacyProgress(simulation), ...(memory ? { rewindMemory: { ...memory, sourceNodeIds: [] } } : {}), ...(gameplayContext.length ? { gameplayContext } : {}) };
}
export function worldForModel(world: WorldDefinition): WorldDefinition {
  const { gameplayPluginHistory: _history, ...simulation } = world;
  return { ...withoutLegacyProgress(simulation), ...(world.gameplayPlugins ? { gameplayPlugins: world.gameplayPlugins.map(gameplayPluginForModel) } : {}) };
}

/** UI edits must neither consume model context nor invalidate a mechanism-only prefix. */
export function gameplayPluginForModel(plugin: GameplayPlugin): GameplayPlugin {
  const { introduction: _introduction, readouts: _readouts, ui: _ui, settings: _settings, release: _release, stateVersion: _version, migrations: _migrations, ...mechanics } = plugin;
  // The server needs the semantic capability to include its protocol, never the author's frame code.
  const nativeText = _ui?.presentation === 'native-text' ? { ui: { html: '<!-- native text capability -->', reading: 'inherit' as const, presentation: 'native-text' as const } } : {};
  if (!plugin.resources) return { ...mechanics, ...nativeText };
  const resources = Object.fromEntries(Object.entries(plugin.resources).map(([id, resource]) => {
    const { hud: _hud, ...mechanics } = resource;
    return [id, mechanics];
  }));
  return { ...mechanics, ...nativeText, resources };
}
