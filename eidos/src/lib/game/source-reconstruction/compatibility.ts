import { assertWorldBrief } from '../world-creation-brief';
import { isRecord, strings, validateDigest } from './validation';
import { indexSources, sourceRevision } from './source-index';
import type { SourceDossier, SourceReconstructionArchive } from './types';
import type { WorldSourceArchive } from '@/lib/ai/source-archive';

export function assertSourceDossier(value: unknown): asserts value is SourceDossier {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.sourceRevision !== 'string' || !strings(value.blockIds) || !strings(value.childRefs) || !isRecord(value.coverage) || ['expected', 'completed', 'failed'].some(k => !strings((value.coverage as Record<string, unknown>)[k])) || !Array.isArray(value.claims) || !Array.isArray(value.entities) || !Array.isArray(value.starts) || !Array.isArray(value.styleCandidates)) throw new Error('文本档案结构无效');
  const blockIds = value.blockIds;
  const refs = [...value.claims, ...value.entities, ...value.starts];
  for (const item of refs) {
    if (!isRecord(item) || !Array.isArray(item.sourceRefs) || item.sourceRefs.some(r => !isRecord(r) || typeof r.documentId !== 'string' || typeof r.revision !== 'string' || typeof r.blockId !== 'string' || !blockIds.includes(r.blockId) || !Number.isInteger(r.start) || !Number.isInteger(r.end) || Number(r.start) < 0 || Number(r.end) <= Number(r.start))) throw new Error('档案来源引用无效');
  }
  for (const sample of value.styleCandidates) if (!isRecord(sample) || typeof sample.id !== 'string' || typeof sample.text !== 'string' || !isRecord(sample.ref)) throw new Error('原文风格样本无效');
  const result = validateDigest(value, { blocks: [], sourceRevision: value.sourceRevision, digests: [value as unknown as SourceDossier] });
  if (!result.ok) throw new Error(result.issues.join('；'));
  const coverage = value.coverage as unknown as SourceDossier['coverage'];
  if (new Set(coverage.expected).size !== coverage.expected.length || value.blockIds.length !== coverage.expected.length || value.blockIds.some(id => !coverage.expected.includes(id)) || [...coverage.completed, ...coverage.failed].some(id => !coverage.expected.includes(id))) throw new Error('文本档案覆盖信息无效');
}

export function assertReconstructionArchive(value: unknown): asserts value is SourceReconstructionArchive {
  if (!isRecord(value) || value.schemaVersion !== 2) throw new Error('不支持此文本建档版本，请保留原始资料');
  assertWorldBrief(value.brief); assertSourceDossier(value.dossier);
  if (value.sourceRevision !== value.dossier.sourceRevision || !Array.isArray(value.digests) || !isRecord(value.entityMap) || Object.values(value.entityMap).some(v => typeof v !== 'string') || typeof value.scope !== 'string') throw new Error('文本建档元数据无效');
}

export function validatePortableSourceArchive(archive?: WorldSourceArchive): void {
  if (!archive?.reconstruction) return; // Existing v1 worlds remain playable without reprocessing.
  assertReconstructionArchive(archive.reconstruction);
  const source = archive.reconstruction;
  if (sourceRevision(archive.corpus) !== source.sourceRevision) throw new Error('原始资料与文本档案版本不一致');
  const blocks = indexSources(archive.corpus, { targetTokens: source.blockTargetTokens });
  for (const sample of [...source.dossier.styleCandidates, ...(source.brief.sourceStyle?.samples ?? [])]) {
    const doc = archive.corpus.documents.find(d => d.id === sample.ref.documentId);
    if (!doc || doc.content.slice(sample.ref.start, sample.ref.end) !== sample.text || !blocks.some(b => b.id === sample.ref.blockId && sample.ref.start >= b.start && sample.ref.end <= b.end)) throw new Error('原文样本与资料不一致');
  }
}
