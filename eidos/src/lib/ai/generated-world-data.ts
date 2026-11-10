import type { WorldDefinition, WorldTimelineEvent } from '@/lib/game/types';
import { isRecord } from '@/lib/game/source-reconstruction/validation';
import { parseCreationJSON } from './creation-stream';
import { normalizeCreatedWorldStructure, validateCreatedWorld } from './world-creation-compiler';
import { validateGameModeConfig } from '@/lib/game/plugins/manifest';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import type { NarrativeStyleProfile } from '@/lib/game/narrative-style';
import type { WorldGenerationProfile } from './world-generation-profile';
import { parseNpcSpeechProfiles } from '@/lib/game/npc-speech';
import { buildSystemPrompt, buildIdentityPrompt } from './builtin-worlds';
import { WORLD_CREATION_FIELDS } from '@/lib/game/world-creation-session';
import { parseWorldIdentityOptions } from '@/lib/game/world-identities';
import { withoutLegacyProgress } from '@/lib/game/legacy-progress';

type GeneratedWorldData = Pick<WorldDefinition, 'name' | 'subtitle' | 'overview' | 'regions' | 'npcs' | 'contradictions' | 'history' | 'clues'> &
  Partial<Pick<WorldDefinition, 'mapRoutes' | 'calendarEra' | 'gameModeConfig' | 'timeline' | 'identityOptions'>> & { npcSpeechProfiles?: unknown };
type Entry = { key: string; value: Record<string, unknown>; id: string };
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
function entries(input: unknown, label: string): Entry[] {
  if (!isRecord(input) && !Array.isArray(input)) throw new Error(`${label}必须是以 ID 为键的对象（或带 ID 的列表）`);
  const result = Object.entries(input).map(([key, value]) => {
    if (!isRecord(value)) throw new Error(`${label} ${key} 必须包含完整资料`);
    const source = Array.isArray(input) ? value.id ?? value.name : key;
    if (typeof source !== 'string' || !source.trim() || unsafe.has(source)) throw new Error(`${label} ${key} 缺少安全、唯一的 ID`);
    const id = source.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_');
    if (id.length > 100 || unsafe.has(id)) throw new Error(`${label} ${source} 的 ID 无效`);
    return { key: Array.isArray(input) ? source : key, value, id };
  });
  if (new Set(result.map(item => item.id)).size !== result.length) throw new Error(`${label} ID 重复`);
  return result;
}

function aliases(items: Entry[], label: string) {
  const index = new Map<string, Set<string>>();
  for (const { key, id, value } of items) for (const alias of [key, id, value.id, value.name]) {
    if (typeof alias !== 'string' || !alias.trim()) continue;
    const found = index.get(alias.trim()) ?? new Set<string>();
    found.add(id); index.set(alias.trim(), found);
  }
  const ids = new Set(items.map(item => item.id));
  return (value: unknown): string => {
    if (typeof value !== 'string') throw new Error(`${label}引用必须是地点或区域 ID`);
    // Exact canonical IDs take precedence over display names shared by other places.
    if (ids.has(value)) return value;
    const found = index.get(value.trim());
    if (!found || found.size !== 1) throw new Error(`${label}引用「${value}」${found ? '存在歧义' : '不存在'}`);
    return [...found][0];
  };
}

/** Normalize representation only. Unknown or ambiguous geography still requires model repair. */
export function parseGeneratedWorldData(text: string, options: { includeTimeline?: boolean } = {}): GeneratedWorldData {
  const raw = parseCreationJSON<unknown>(text);
  if (!isRecord(raw)) throw new Error('世界设定必须是 JSON 对象');
  const regions = entries(raw.regions, '世界地图区域');
  const regionId = aliases(regions, '区域');
  const grouped = regions.map(region => ({ region, scenes: entries(region.value.scenes ?? region.value.locations, `区域 ${region.key} 的地点`) }));
  const allScenes = grouped.flatMap(group => group.scenes);
  if (new Set(allScenes.map(scene => scene.id)).size !== allScenes.length) throw new Error('世界地图地点 ID 重复');
  const sceneId = aliases(allScenes, '地点');
  const world = { ...withoutLegacyProgress(raw), clues: raw.clues ?? [], regions: {} } as unknown as GeneratedWorldData;
  if (Object.hasOwn(raw, 'identityOptions')) world.identityOptions = parseWorldIdentityOptions(raw.identityOptions, sceneId);
  world.gameModeConfig = validateGameModeConfig(raw.gameModeConfig);
  for (const { region, scenes } of grouped) {
    world.regions[region.id] = { ...region.value, id: region.id, scenes: {} } as WorldDefinition['regions'][string];
    for (const scene of scenes) {
      const value = scene.value;
      if (value.connections !== undefined && !Array.isArray(value.connections)) throw new Error(`地点 ${scene.key} 的 connections 必须是 ID 列表`);
      world.regions[region.id].scenes[scene.id] = {
        ...value, id: scene.id, region: value.region ? regionId(value.region) : region.id,
        connections: [...new Set((value.connections as unknown[] | undefined ?? []).map(sceneId))],
        npcs: value.npcs ?? [], secrets: value.secrets ?? [], discoveredSecrets: value.discoveredSecrets ?? [],
        detailLevel: value.detailLevel ?? 10,
        initialDescription: value.initialDescription ?? value.description ?? '',
      } as WorldDefinition['regions'][string]['scenes'][string];
    }
  }
  if (Array.isArray(raw.clues)) world.clues = raw.clues.map(clue => {
    if (!isRecord(clue)) throw new Error('线索资料无效');
    return { ...clue, sceneId: sceneId(clue.sceneId) } as WorldDefinition['clues'][number];
  });
  if (Array.isArray(raw.mapRoutes)) world.mapRoutes = raw.mapRoutes.map(route => {
    if (!isRecord(route)) throw new Error('初始地图通路格式错误');
    return { ...route, from: sceneId(route.from), to: sceneId(route.to) } as NonNullable<WorldDefinition['mapRoutes']>[number];
  });
  if (options.includeTimeline && Array.isArray(raw.timeline)) world.timeline = raw.timeline.map(event => isRecord(event) ? { ...event, sceneId: sceneId(event.sceneId) } as unknown as WorldTimelineEvent : event);
  normalizeCreatedWorldStructure(world as WorldDefinition);
  const checked = validateCreatedWorld({ world: world as WorldDefinition });
  if (!checked.ok) throw new Error(checked.issues.join('；'));
  return world;
}

export function parseGeneratedTimeline(text: string, world: WorldDefinition, options: { allowEmpty?: boolean } = {}): WorldTimelineEvent[] {
  const raw = parseCreationJSON<unknown>(text);
  if (!isRecord(raw) || !Array.isArray(raw.timeline) || !options.allowEmpty && !raw.timeline.length) throw new Error('时间线缺少完整事件列表');
  const regions = entries(world.regions, '世界地图区域');
  const scenes = regions.flatMap(region => entries(region.value.scenes, '世界地图地点'));
  const sceneId = aliases(scenes, '时间线地点');
  const ids = new Set<string>();
  return raw.timeline.map((event, index) => {
    if (!isRecord(event) || typeof event.id !== 'string' || !event.id || ids.has(event.id)) throw new Error(`时间线事件 ${index + 1} 的 ID 缺失或重复`);
    ids.add(event.id);
    const time = event.timePoint;
    if (!isRecord(time) || !Number.isInteger(time.day) || (time.day as number) < 0 || !Number.isInteger(time.hour) || (time.hour as number) < 0 || (time.hour as number) > 23 || !Number.isInteger(time.minute) || (time.minute as number) < 0 || (time.minute as number) > 59) throw new Error(`时间线事件 ${event.id} 的时间无效`);
    if (typeof event.title !== 'string' || !event.title.trim() || typeof event.description !== 'string' || typeof event.defaultOutcome !== 'string' || !Array.isArray(event.npcsInvolved) || !Array.isArray(event.worldFlags) || !Array.isArray(event.rippleEffects) || typeof event.playerModifiable !== 'boolean') throw new Error(`时间线事件 ${event.id} 的必要字段不完整`);
    const id = sceneId(event.sceneId);
    const region = Object.values(world.regions).find(region => Object.hasOwn(region.scenes, id))!;
    return { ...event, sceneId: id, region: region.id } as unknown as WorldTimelineEvent;
  });
}

/** Host-owned world IDs, prompts and installed plugins cannot be overwritten by generated fields. */
export function assembleGeneratedWorld(text: string, options: { id: string; plugins: GameplayPlugin[]; narrativeStyle?: NarrativeStyleProfile; generationProfile?: WorldGenerationProfile; includeTimeline?: boolean }): WorldDefinition {
  const data = parseGeneratedWorldData(text, { includeTimeline: options.includeTimeline });
  const authored = Object.fromEntries(WORLD_CREATION_FIELDS.filter(field => Object.hasOwn(data, field)).map(field => [field, data[field as keyof GeneratedWorldData]])) as GeneratedWorldData;
  const world: WorldDefinition = {
    ...authored, id: options.id, timeline: [], gameplayPlugins: options.plugins,
    npcSpeechProfiles: parseNpcSpeechProfiles(data.npcSpeechProfiles, Object.keys(data.npcs)),
    systemPromptBase: buildSystemPrompt(data.name, data.overview), identityPrompt: buildIdentityPrompt(data.name, data.overview),
    generationProfile: options.generationProfile, isPlayerCreated: true, createdAt: Date.now(),
    ...(options.narrativeStyle ? { narrativeStyle: options.narrativeStyle } : {}),
  };
  if (options.includeTimeline) world.timeline = parseGeneratedTimeline(JSON.stringify(data), world, { allowEmpty: true });
  return world;
}
