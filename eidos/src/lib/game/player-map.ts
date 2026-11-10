import { mapScenes, mapRoutes } from "./map-state";
import type { WorldDefinition } from './types';

export interface MapPlace {
  id: string; name: string; regionId: string; regionName: string;
  current: boolean; visited: boolean; reachable: boolean; note?: string;
}
export interface PlayerMap {
  places: MapPlace[];
  paths: Array<{ from: string; to: string; blocked?: boolean }>;
}

/** Only explored origins disclose their routes; a visible neighbour is not an explored room. */
export function buildPlayerMap(world: WorldDefinition | null, currentId: string, visited: string[]): PlayerMap {
  if (!world) return { places: [], paths: [] };
  const scenes = mapScenes(world);
  const entries = Object.entries(scenes).map(([id, scene]) => {
    const regionId = Object.keys(world.regions).find(key => Object.hasOwn(world.regions[key].scenes, id)) ?? world.mapState?.places[id]?.regionId ?? scene.region;
    return { id, scene, regionId, region: world.regions[regionId] };
  }).filter(entry => entry.region);
  const routes = mapRoutes(world);
  const reachable = new Set(routes.filter(route => route.from === currentId && route.status === 'open').map(route => route.to));
  const explored = new Set([currentId, ...visited]);
  const known = new Set([...explored, ...Object.keys(world.mapState?.places ?? {})]);
  for (const route of routes) if (explored.has(route.from) && route.status !== 'hidden') known.add(route.to);
  const visible = entries.filter(entry => known.has(entry.id));
  const regions = [...new Set(visible.map(entry => entry.regionId))];
  const readable = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^(region[_-]|[a-z0-9]+_)/i.test(value);
  const places = visible.map(({ id, scene, regionId, region }) => {
    const explicit = (region as typeof region & { name?: string }).name;
    const regionName = readable(explicit) ? explicit : readable(scene.region) ? scene.region : readable(regionId) ? regionId : `区域 ${String(regions.indexOf(regionId) + 1).padStart(2, '0')}`;
    return { id, name: scene.name, regionId, regionName, current: id === currentId, visited: explored.has(id), reachable: id !== currentId && reachable.has(id), ...(world.mapState?.places[id]?.note ? { note: world.mapState.places[id].note } : {}) };
  });
  const ids = new Set(places.map(place => place.id));
  const paths = routes.filter(route => route.status !== 'hidden' && explored.has(route.from) && ids.has(route.from) && ids.has(route.to)).map(route => ({ from: route.from, to: route.to, ...(route.status === 'blocked' ? { blocked: true } : {}) }));
  return { places, paths };
}

/** Fewest hops through known, open, directed edges; no geographic distance is implied. */
export function findMapPath(map: PlayerMap, from: string, to: string): string[] | null {
  if (!map.places.some(place => place.id === from) || !map.places.some(place => place.id === to)) return null;
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    const last = path[path.length - 1];
    if (last === to) return path;
    for (const edge of map.paths) {
      if (edge.from !== last || edge.blocked || seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push([...path, edge.to]);
    }
  }
  return null;
}
