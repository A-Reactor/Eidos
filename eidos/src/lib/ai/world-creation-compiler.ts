import { assertSourceDossier } from '@/lib/game/source-reconstruction/compatibility';
import { worldCreationPrompt, compactWorldPrompt, type WorldGenerationProfile } from './world-generation-profile';
import { formatNarrativeStyleForKei, type NarrativeStyleProfile } from '@/lib/game/narrative-style';
import { resolveEffectiveFacts } from '@/lib/game/source-reconstruction/adaptation';
import { serializeWorldBrief, assertWorldBrief, type WorldCreationBrief } from '@/lib/game/world-creation-brief';
import type { SourceDossier, ValidationResult } from '@/lib/game/source-reconstruction/types';
import type { WorldDefinition } from '@/lib/game/types';
import { validateMapRegions, validateInitialMapRoutes } from '@/lib/game/map-state';
import { isRecord } from '@/lib/game/source-reconstruction/validation';

export interface WorldCreationInput { settings?: Record<string, string>; concept?: string; brief?: WorldCreationBrief; dossier?: SourceDossier; generationProfile?: WorldGenerationProfile; narrativeStyle?: NarrativeStyleProfile; skillGuide?: string }
export interface CompiledCreationRequest { systemPrompt: string; userMessage: string }
export function compileWorldCreation(input: WorldCreationInput): CompiledCreationRequest {
  const { brief, dossier } = input;
  if (brief) assertWorldBrief(brief);
  const blocking = brief?.issues.filter(i => i.blocking) ?? [];
  if (blocking.length) throw new Error(blocking.map(i => i.message).join('；'));
  let source = '';
  if (brief?.origin === 'source') {
    if (!dossier || dossier.coverage.failed.length || dossier.coverage.expected.some(id => !dossier.coverage.completed.includes(id))) throw new Error('原文资料覆盖尚未完整，请完成梳理');
    const facts = resolveEffectiveFacts({ brief, dossier });
    source = `\n\n## 来源与本次改编\n${JSON.stringify({ summary: dossier.summary, sourceEntities: dossier.entities.map(({ id, name, aliases, kind }) => ({ id, name, aliases, kind })), effectiveFacts: facts, start: brief.startAnchor, overrides: brief.overrides })}`;
  }
  const sourceRules = source ? '\n\n本次是文本逆向建世。只使用下面提供的有效事实，不凭作品名称回忆外部知识。history 只含开局前已发生事件；future 是可干预的原文参考，不能提前写成当前状态。未知可留白。玩家明确改编优先于被改动的源事实，其余遵照原文。将证据分类留在内部，面向玩家的描述不出现元标签。' : '';
  return {
    systemPrompt: compactWorldPrompt(worldCreationPrompt() + '\n' + formatNarrativeStyleForKei(input.narrativeStyle) + (input.skillGuide ?? ''), input.generationProfile) + sourceRules + (source ? '\n来源方式高于模板数量：选择遵照原文的人物只创建原文出现过的角色，可以只有一位，不得为了满足 NPC 人数下限新增具名角色。区域遵照原文或玩家指定范围时，可以只生成一个区域中的一个场景，不为场景数量下限杜撰原文未说明的地理关系。缺失字段依其来源方式留白或补全；补全不得伪称原文事实。' : ''),
    userMessage: `请根据以下生成稿建立可游玩的世界，输出标准世界 JSON。\n${brief ? serializeWorldBrief(brief) : input.concept ?? ''}${source}${brief?.origin === 'concept' && input.concept ? '\n补充材料与玩法要求：\n' + input.concept : ''}`,
  };
}
export { assertWorldBrief } from '@/lib/game/world-creation-brief';
export function readWorldCreationInput(body: Record<string, unknown>): Pick<WorldCreationInput, 'brief' | 'dossier' | 'settings'> | undefined {
  if (body.brief === undefined) return undefined;
  assertWorldBrief(body.brief);
  if (body.brief.origin === 'source') assertSourceDossier(body.sourceDossier);
  return { brief: body.brief, ...(isRecord(body._settings) ? { settings: body._settings as Record<string, string> } : {}), ...(body.sourceDossier ? { dossier: body.sourceDossier as SourceDossier } : {}) };
}
export function validateCreatedWorld({ world }: { world: WorldDefinition }): ValidationResult<WorldDefinition> {
  try {
    if (typeof world.name !== 'string' || !world.name.trim() || typeof world.subtitle !== 'string' || typeof world.overview !== 'string' || !world.overview.trim() || !isRecord(world.npcs) || Object.values(world.npcs).some(v => typeof v !== 'string') || !Array.isArray(world.contradictions) || !Array.isArray(world.history) || !Array.isArray(world.clues)) throw new Error('世界必要字段不完整：请检查 name、subtitle、overview、npcs、contradictions、history、clues 的类型');
    validateMapRegions(world.regions); validateInitialMapRoutes(world.regions, world.mapRoutes);
    const scenes = new Set(Object.values(world.regions).flatMap(r => Object.keys(r.scenes)));
    const clues = new Set(world.clues.map(c => c.id));
    if (clues.size !== world.clues.length || world.clues.some(c => !scenes.has(c.sceneId) || [...(c.prerequisiteClues ?? []), ...(c.unlocksClues ?? [])].some(id => !clues.has(id)))) throw new Error('线索引用了不存在的地点或线索');
    return { ok: true, value: world };
  } catch (error) { return { ok: false, issues: [error instanceof Error ? error.message : '世界无效'] }; }
}

/** A scene's explicit region determines its container; this fixes structure without changing story facts. */
export function normalizeCreatedWorldStructure(world: WorldDefinition): void {
  for (const [containerId, region] of Object.entries(world.regions)) for (const [sceneId, scene] of Object.entries({ ...region.scenes })) {
    if (!scene.region || scene.region === containerId) { scene.region = containerId; continue; }
    const target = world.regions[scene.region];
    if (!target) throw new Error(`地点 ${sceneId} 引用了不存在的区域 ${scene.region}`);
    if (target.scenes[sceneId]) throw new Error(`地点 ${sceneId} 重复出现在多个区域`);
    target.scenes[sceneId] = scene;
    delete region.scenes[sceneId];
  }
}
export function sourceTimelinePrompt(profile?: WorldGenerationProfile): string {
  return `你是 Eidos 的世界推演引擎。根据开局状态、人物动机和原文的条件性后续，生成玩家未干预时可能发生的时间线。原文未来不是必然；人物行动类事件设 playerModifiable:true。仅世界不可干预的自然规律可设 false。跨度依照原文与当前开局，未知时间不捏造为原文事实。${profile === 'quick' ? '只保留启动冲突和关键转折。' : '覆盖有因果依据的关键事件，不凑数量。'}\n输出 {"timeline":[{"id":"wt_001","timePoint":{"day":0,"hour":8,"minute":0},"title":"事件","region":"实际区域ID","sceneId":"实际场景ID","description":"事件与前提","npcsInvolved":[],"defaultOutcome":"无干预时结果","worldFlags":[],"playerModifiable":true,"rippleEffects":[]}]}。`;
}
export function sourceTimelineContext(world: WorldDefinition): string {
  const source = world.sourceArchive?.reconstruction;
  return source ? `\n## 开局与条件性原文走向\n${JSON.stringify({ start: source.brief.startAnchor, facts: resolveEffectiveFacts({ brief: source.brief, dossier: source.dossier }), overrides: source.brief.overrides })}` : '';
}
