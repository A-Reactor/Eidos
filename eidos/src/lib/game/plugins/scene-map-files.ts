import type { GameStore } from '@/store/game-store';
import { getPlayerVisibleText, getReadingPath } from '../player-reading';
import { storeResource, readResource } from '../workspace/resources';
import type { WorkspaceSession } from '../workspace/session';
import { isGameplayPluginActive } from './activation';
import { parseGameplayPlugins } from './manifest';
import { buildModScene } from './world-interaction';
import type { ResourceRef } from '../workspace/types';

type Source = Pick<GameStore, 'currentWorld' | 'currentSceneId' | 'worldFlags' | 'gameplayModState' | 'allNodes' | 'currentNode' | 'workspaceState'>;
export interface SceneMapFile { path: string; version: string; name: string; size: number }
const activeMaps = (state: Source) => parseGameplayPlugins(state.currentWorld?.gameplayPlugins)
  .filter(plugin => plugin.ui?.presentation === 'scene-map' && isGameplayPluginActive(plugin, state.worldFlags, state.currentSceneId));
const mapState = (state: Source, id: string) => {
  const data = state.gameplayModState[id] ?? {};
  const maps = data.maps as Record<string, { layout?: unknown }> | undefined;
  const positions = data.positions as Record<string, unknown> | undefined;
  return { map: maps?.[state.currentSceneId]?.layout, player: positions?.[state.currentSceneId] };
};

/** Only the current public map is materialized; a large atlas stays out of every prompt. */
export async function mountSceneMapFiles(session: WorkspaceSession, state: GameStore): Promise<void> {
  const scene = buildModScene(state);
  if (!scene) return;
  for (const plugin of activeMaps(state)) {
    const view = mapState(state, plugin.id);
    if (!view.map || typeof view.map !== 'object' || (view.map as {sceneId?:unknown}).sceneId !== scene.id) continue;
    const path = `maps/${plugin.id}/current.json`;
    const resource = await storeResource({ name: `${scene.name}地图`, mimeType: 'application/json',
      text: JSON.stringify({ format: 'eidos-scene-map-context', version: 1, scene, ...view }) });
    if (session.closed || !session.isCurrent()) throw new DOMException('地图读取归属已变化', 'AbortError');
    session.files[path] = resource;
    session.initialFiles[path] = resource;
  }
}
export function sceneMapInputRevision(state: Source): string {
  return JSON.stringify(activeMaps(state).map(plugin => [plugin.id, state.currentSceneId, mapState(state, plugin.id)]));
}

/** Output paths are discovered from the live branch projection, never from pending candidates. */
function visibleMapFiles(state: Source): Array<[string, ResourceRef]> {
  const nodes = getReadingPath(state.allNodes, state.currentNode?.id ?? null).filter(node => node.generationComplete && getPlayerVisibleText(node) && node.actionId);
  const actions = new Map(nodes.map((node, index) => [node.actionId!, {node,index}]));
  return Object.entries(state.workspaceState ?? {}).filter(([path]) => {
    const parts = path.split('/');
    const node = actions.get(parts[1])?.node;
    if (parts.length !== 3 || parts[0] !== 'outputs' || !node || !/^scene_map(?:_[a-zA-Z0-9_-]+)?\.txt$/.test(parts[2])) return false;
    return !node.workspaceBranch || node.workspaceBranch.outputs.some(output => output.path === path && output.resource.id === state.workspaceState[path].id && output.segmentIndex <= node.workspaceBranch!.mergedThrough);
  }).sort(([a], [b]) => actions.get(a.split('/')[1])!.index - actions.get(b.split('/')[1])!.index);
}
export function sceneMapFileCatalog(state: Source): SceneMapFile[] {
  return visibleMapFiles(state).map(([path, ref]) => ({ path, version: ref.id, name: ref.name, size: ref.size }));
}
export async function readSceneMapFile(state: Source, params: Record<string, unknown>, current: () => boolean) {
  if (Object.keys(params).some(key => !['path', 'version'].includes(key))) throw new Error('地图文件读取参数无效');
  const found = visibleMapFiles(state).find(([path, ref]) => path === params.path && ref.id === params.version);
  if (!found) throw new Error('地图文件尚未播放、版本已变化或不属于当前分支');
  const resource = await readResource(found[1]);
  if (!current()) throw new DOMException('地图读取归属已变化', 'AbortError');
  if (resource.text === undefined) throw new Error('地图文件须为文本');
  return { path: found[0], version: resource.id, text: resource.text };
}
