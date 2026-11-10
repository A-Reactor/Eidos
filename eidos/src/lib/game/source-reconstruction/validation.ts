import { blockRef, stableHash } from './source-index';
import type { ChunkDigest, SourceBlock, SourceClaim, SourceEntity, SourceRef, SourceStyleSample, StartAnchor, ValidationResult } from './types';

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
export interface SourceValidationContext { blocks: SourceBlock[]; sourceRevision: string; digests?: ChunkDigest[] }
const categories = ['character', 'place', 'organization', 'event', 'relationship', 'world_rule', 'object', 'theme', 'unknown'];

export function validateDigest(input: unknown, context: SourceValidationContext): ValidationResult<ChunkDigest> {
  try {
    if (context.blocks.some(b => b.sourceRevision !== context.sourceRevision)) throw new Error('资料版本已变化');
    if (!isRecord(input) || typeof input.summary !== 'string' || !Array.isArray(input.claims) || !Array.isArray(input.entities) || !strings(input.unresolved) || !Array.isArray(input.styleCandidates)) throw new Error('摘要结构不完整');
    const refs = new Map(context.blocks.map(b => [b.id, blockRef(b)]));
    for (const digest of context.digests ?? []) for (const item of [...digest.claims, ...digest.entities, ...digest.starts]) for (const ref of item.sourceRefs) refs.set(ref.blockId, ref);
    const resolveRefs = (raw: Record<string, unknown>): SourceRef[] => {
      if (Array.isArray(raw.sourceRefs)) return raw.sourceRefs.map(value => {
        if (!isRecord(value) || typeof value.blockId !== 'string') throw new Error('来源引用无效');
        const ref = refs.get(value.blockId);
        if (!ref || JSON.stringify(ref) !== JSON.stringify({ documentId: value.documentId, revision: value.revision, blockId: value.blockId, start: value.start, end: value.end })) throw new Error('来源引用不存在或已过期');
        return ref;
      });
      if (!strings(raw.blockIds)) throw new Error('缺少来源片段');
      return raw.blockIds.map(id => { const ref = refs.get(id); if (!ref) throw new Error(`未知来源：${id}`); return ref; });
    };
    const seen = new Set<string>();
    const checkId = (raw: Record<string, unknown>) => { if (typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)) throw new Error('条目 ID 为空或重复'); seen.add(raw.id); return raw.id; };
    const claims: SourceClaim[] = input.claims.map(value => {
      if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim() || !categories.includes(String(value.category)) || !['source', 'inference', 'generated', 'player_override'].includes(String(value.origin)) || !['objective', 'character_claim', 'uncertain'].includes(String(value.assertion)) || !['history', 'current', 'future', 'timeless', 'unknown'].includes(String(value.temporal)) || !strings(value.entities) || !strings(value.knownBy)) throw new Error('事实结构无效');
      const id = checkId(value), sourceRefs = resolveRefs(value);
      if (['source', 'inference'].includes(String(value.origin)) && !sourceRefs.length) throw new Error('事实缺少原文依据');
      for (const key of ['storyOrder', 'untilOrder']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error('故事顺序无效');
      if (value.requiresFactIds !== undefined && !strings(value.requiresFactIds)) throw new Error('因果引用无效');
      return { id, text: value.text, category: value.category as SourceClaim['category'], origin: value.origin as SourceClaim['origin'], assertion: value.assertion as SourceClaim['assertion'], temporal: value.temporal as SourceClaim['temporal'], entities: value.entities, knownBy: value.knownBy, sourceRefs, requiresFactIds: value.requiresFactIds as string[] ?? [], ...(value.storyOrder !== undefined ? { storyOrder: value.storyOrder as number } : {}), ...(value.untilOrder !== undefined ? { untilOrder: value.untilOrder as number } : {}) };
    });
    const entities: SourceEntity[] = input.entities.map(value => {
      if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || !strings(value.aliases) || !['character', 'place', 'organization', 'object'].includes(String(value.kind))) throw new Error('实体结构无效');
      const sourceRefs = resolveRefs(value); if (!sourceRefs.length) throw new Error('实体缺少依据');
      return { id: checkId(value), name: value.name, aliases: value.aliases, kind: value.kind as SourceEntity['kind'], sourceRefs };
    });
    const factIds = new Set(claims.map(c => c.id));
    if (claims.some(c => c.requiresFactIds.some(id => !factIds.has(id)))) throw new Error('因果依赖引用了不存在的事实');
    for (const claim of claims) claim.entities = claim.entities.map(value => {
      const matching = entities.filter(e => e.id === value || e.name === value || e.aliases.includes(value));
      return matching.length === 1 ? matching[0].id : value;
    });
    const existingSamples = (context.digests ?? []).flatMap(d => d.styleCandidates);
    const styleIssues: ChunkDigest['issues'] = [];
    const styleCandidates: SourceStyleSample[] = input.styleCandidates.flatMap(value => {
      if (!isRecord(value) || typeof value.traits !== 'string' || typeof value.safe !== 'boolean') throw new Error('文风样本结构无效');
      const prior = existingSamples.find(s => s.id === value.id || s.ref.blockId === value.blockId && s.text === value.quote || isRecord(value.ref) && s.ref.blockId === value.ref.blockId && s.text === value.text);
      if (prior) return [{ ...prior, traits: value.traits, safe: value.safe && prior.safe }];
      if (context.digests) { styleIssues.push({ code: 'invalid_style_reference', message: '合并时有文风样本无法核验，已保留写法特征并排除该引文。', blocking: false }); return []; }
      const block = context.blocks.find(b => b.id === value.blockId);
      if (!block || typeof value.quote !== 'string' || !value.quote.trim()) throw new Error('样本来源无效');
      const offset = block.text.indexOf(value.quote);
      if (offset < 0) throw new Error('样本不是原文');
      return [{ id: `style_${stableHash([block.id, offset, value.quote])}`, ref: { ...blockRef(block), start: block.start + offset, end: block.start + offset + value.quote.length }, text: value.quote, traits: value.traits, safe: value.safe }];
    });
    const starts: StartAnchor[] = (Array.isArray(input.starts) ? input.starts : []).map(value => {
      if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') throw new Error('开局锚点无效');
      const sourceRefs = resolveRefs(value);
      if (!sourceRefs.length && value.origin !== 'generated' || value.storyOrder !== undefined && (typeof value.storyOrder !== 'number' || !Number.isFinite(value.storyOrder))) throw new Error('开局时间或来源无效');
      const knowledge = isRecord(value.knownFactIds) ? value.knownFactIds : {};
      if (!Object.values(knowledge).every(value => strings(value) && value.every(id => factIds.has(id)))) throw new Error('角色知识映射无效');
      return { id: value.id, label: value.label, ...(value.origin === 'generated' ? { origin: 'generated' as const } : {}), sourceRefs, ...(value.storyOrder !== undefined ? { storyOrder: value.storyOrder as number } : {}), knownFactIds: knowledge as Record<string, string[]> };
    });
    const issues = Array.isArray(input.issues) ? input.issues : [];
    if (issues.some(v => !isRecord(v) || typeof v.code !== 'string' || typeof v.message !== 'string' || typeof v.blocking !== 'boolean')) throw new Error('冲突说明无效');
    return { ok: true, value: { summary: input.summary, blockIds: [...new Set([...context.blocks.map(b => b.id), ...(context.digests ?? []).flatMap(d => d.blockIds)])], entities, claims, unresolved: input.unresolved, styleCandidates, starts, issues: [...issues as ChunkDigest['issues'], ...styleIssues] } };
  } catch (error) { return { ok: false, issues: [error instanceof Error ? error.message : '摘要无效'] }; }
}
