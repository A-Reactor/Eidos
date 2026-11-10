import type { Scene, WorldDefinition } from './types';

export interface MapRoute { from: string; to: string; status: 'open' | 'blocked' | 'hidden' }
export interface MapPlaceUpdate { id: string; name?: string; regionId?: string; note: string }
export interface MapUpdates { places?: MapPlaceUpdate[]; routes?: Array<MapRoute & { bidirectional: boolean }> }
export interface MapState { places: Record<string, Omit<MapPlaceUpdate, 'id'>>; routes: MapRoute[] }
export const emptyMapState = (): MapState => ({ places: {}, routes: [] });
const has = (object: object, key: string) => Object.hasOwn(object, key);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,100}$/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

export function mapScenes(world: WorldDefinition): Record<string, Scene> {
  const scenes = Object.assign({}, ...Object.values(world.regions).map(region => region.scenes)) as Record<string, Scene>;
  for (const [id, place] of Object.entries(world.mapState?.places ?? {})) {
    if (!has(scenes, id) && place.name && place.regionId && has(world.regions, place.regionId)) {
      scenes[id] = { id, name: place.name, region: place.regionId, initialDescription: place.note, connections: [], npcs: [], secrets: [], discoveredSecrets: [], detailLevel: 10 };
    }
  }
  return scenes;
}

export function mapRoutes(world: WorldDefinition): MapRoute[] {
  const routes = new Map<string, MapRoute>();
  const scenes = mapScenes(world);
  const put = (route: MapRoute) => {
    if (has(scenes, route.from) && has(scenes, route.to) && route.from !== route.to) routes.set(`${route.from}\0${route.to}`, route);
  };
  for (const [from, scene] of Object.entries(scenes)) for (const to of scene.connections ?? []) put({ from, to, status: 'open' });
  for (const route of [...(world.mapRoutes ?? []), ...(world.mapState?.routes ?? [])]) put(route);
  return [...routes.values()];
}

export function mappedScene(world: WorldDefinition, id: string): Scene | null {
  const scenes = mapScenes(world);
  if (!has(scenes, id)) return null;
  return { ...scenes[id], connections: mapRoutes(world).filter(route => route.from === id && route.status === 'open').map(route => route.to) };
}

/** Reject the whole batch: half an applied passage can contradict the narrative and the return route. */
export function applyMapUpdates(world: WorldDefinition, input: unknown): WorldDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('地图更新格式错误');
  const update = input as MapUpdates;
  if ((update.places !== undefined && !Array.isArray(update.places)) || (update.routes !== undefined && !Array.isArray(update.routes))) throw new Error('地图更新必须是列表');
  if ((update.places?.length ?? 0) > 12 || (update.routes?.length ?? 0) > 24) throw new Error('单次地图更新过多');
  const state: MapState = structuredClone(world.mapState ?? emptyMapState());
  const scenes = mapScenes(world);
  const updatedIds = new Set<string>();
  for (const place of update.places ?? []) {
    if (!place || !validId(place.id) || !text(place.note, 400)) throw new Error('地点 ID 或备注无效');
    if (updatedIds.has(place.id)) throw new Error('同一地点只能更新一次');
    updatedIds.add(place.id);
    if (!has(scenes, place.id)) {
      if (!text(place.name, 80) || !place.name.trim() || !validId(place.regionId) || !has(world.regions, place.regionId)) throw new Error('新地点需要名称和已有区域');
      state.places[place.id] = { name: place.name.trim(), regionId: place.regionId, note: place.note.trim() };
    } else {
      // Existing geography keeps its identity; only the public note is replaceable.
      state.places[place.id] = { ...state.places[place.id], note: place.note.trim() };
    }
  }
  const next = { ...world, mapState: state };
  const allScenes = mapScenes(next);
  for (const route of update.routes ?? []) {
    if (!route || !validId(route.from) || !validId(route.to) || route.from === route.to || !has(allScenes, route.from) || !has(allScenes, route.to) || !['open', 'blocked', 'hidden'].includes(route.status) || typeof route.bidirectional !== 'boolean') throw new Error('通路端点、状态或方向无效');
    const directions = route.bidirectional ? [[route.from, route.to], [route.to, route.from]] : [[route.from, route.to]];
    for (const [from, to] of directions) {
      if (route.status === 'hidden' && mapRoutes(next).some(old => old.from === from && old.to === to && old.status !== 'hidden')) throw new Error('已知通路不能重新隐藏，请使用封闭状态');
      state.routes = state.routes.filter(old => old.from !== from || old.to !== to);
      state.routes.push({ from, to, status: route.status });
    }
  }
  return next;
}

export function validateMapRegions(regions: WorldDefinition['regions']): WorldDefinition['regions'] {
  if (!regions || typeof regions !== 'object' || Array.isArray(regions)) throw new Error('世界地图缺少区域');
  const ids = new Set<string>();
  for (const [regionId, region] of Object.entries(regions)) {
    if (!validId(regionId)) throw new Error(`世界地图区域无效：区域 ID「${regionId}」只能包含字母、数字、下划线和连字符`);
    if (!region?.scenes || typeof region.scenes !== 'object' || Array.isArray(region.scenes)) throw new Error(`世界地图区域无效：区域「${regionId}」缺少以地点 ID 为键的 scenes 对象`);
    for (const [id, scene] of Object.entries(region.scenes)) {
      if (!scene || !validId(id) || ids.has(id) || scene.id !== id || !text(scene.name, 80) || !scene.name.trim() || !Array.isArray(scene.connections)) throw new Error(`世界地图地点无效或 ID 重复：${regionId}/${id}`);
      ids.add(id);
    }
  }
  if (!ids.size) throw new Error('世界地图没有地点');
  for (const region of Object.values(regions)) for (const scene of Object.values(region.scenes)) {
    const invalid = scene.connections.find(to => !ids.has(to) || to === scene.id);
    if (invalid !== undefined) throw new Error(`世界地图存在无效通路：${scene.id} → ${invalid}`);
  }
  return regions;
}

export function validateInitialMapRoutes(regions: WorldDefinition['regions'], input: unknown): MapRoute[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error('初始地图通路格式错误');
  const ids = new Set(Object.values(regions).flatMap(region => Object.keys(region.scenes)));
  return input.map(route => {
    if (!route || !ids.has(route.from) || !ids.has(route.to) || route.from === route.to || !['open', 'blocked', 'hidden'].includes(route.status)) throw new Error('初始地图通路无效');
    return { from: route.from, to: route.to, status: route.status };
  });
}
