import { buildPlayerMap, findMapPath } from './player-map';
import type { WorldDefinition, WorldSnapshot } from './types';

export interface TravelSegment { from: string; to: string; arrived: boolean; text: string; minutes: number }
export function validateTravelPath(world: WorldDefinition, snapshot: WorldSnapshot, input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 31 || input.some(id => typeof id !== 'string') || new Set(input).size !== input.length || input[0] !== snapshot.currentSceneId || snapshot.worldId !== world.id) throw new Error('旅行路线已失效');
  const map = buildPlayerMap({ ...world, mapState: snapshot.mapState }, snapshot.currentSceneId, snapshot.visitedScenes);
  for (let i = 1; i < input.length; i++) {
    const edge = findMapPath(map, input[i - 1], input[i]);
    if (edge?.length !== 2) throw new Error('旅行路线包含未知或封闭的通路');
  }
  return input;
}
export function validateTravelSegments(input: unknown, path: string[]): TravelSegment[] {
  if (!Array.isArray(input) || !input.length || input.length >= path.length) throw new Error('旅行段落数量不正确');
  const segments = input.map((segment, i): TravelSegment => {
    if (!segment || segment.from !== path[i] || segment.to !== path[i + 1] || typeof segment.arrived !== 'boolean' || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 1600 || !Number.isFinite(segment.minutes) || segment.minutes < 0 || segment.minutes > 1440 || (!segment.arrived && i !== input.length - 1)) throw new Error('旅行段落与路线不一致');
    return { from: segment.from, to: segment.to, arrived: segment.arrived, text: segment.text.trim(), minutes: Math.round(segment.minutes) };
  });
  if (segments.length !== path.length - 1 && segments.at(-1)?.arrived) throw new Error('旅行路线未生成完整');
  return segments;
}
