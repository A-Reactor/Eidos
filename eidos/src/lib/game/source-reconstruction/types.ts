import type { SourceCorpus } from '@/lib/ai/source-archive';
import type { WorldCreationBrief } from '../world-creation-brief';

export interface SourceRef { documentId: string; revision: string; blockId: string; start: number; end: number }
export interface SourceBlock extends SourceRef { id: string; title: string; text: string; sourceRevision: string; index: number }
export type SourceCategory = 'character' | 'place' | 'organization' | 'event' | 'relationship' | 'world_rule' | 'object' | 'theme' | 'unknown';
export type SourceOrigin = 'source' | 'inference' | 'player_override' | 'generated';
export interface SourceClaim {
  id: string; text: string; category: SourceCategory; origin: SourceOrigin;
  assertion: 'objective' | 'character_claim' | 'uncertain';
  entities: string[]; knownBy: string[]; sourceRefs: SourceRef[];
  temporal: 'history' | 'current' | 'future' | 'timeless' | 'unknown';
  storyOrder?: number; untilOrder?: number; requiresFactIds: string[];
}
export interface SourceEntity { id: string; name: string; aliases: string[]; kind: 'character' | 'place' | 'organization' | 'object'; sourceRefs: SourceRef[] }
export interface SourceStyleSample { id: string; ref: SourceRef; text: string; traits: string; safe: boolean }
export interface SourceStyleReference { traits: string; samples: SourceStyleSample[] }
export interface StartAnchor { origin?: 'source' | 'generated'; id: string; label: string; storyOrder?: number; sourceRefs: SourceRef[]; knownFactIds: Record<string, string[]> }
export interface SourceIssue { code: string; message: string; blocking: boolean; factIds?: string[] }
export interface SourceCoverage { expected: string[]; completed: string[]; failed: string[] }
export interface ChunkDigest {
  summary: string; blockIds: string[]; entities: SourceEntity[]; claims: SourceClaim[];
  unresolved: string[]; styleCandidates: SourceStyleSample[]; starts: StartAnchor[]; issues: SourceIssue[];
}
/** Claims carry temporal, knowledge and dependency edges instead of duplicating the same fact in six arrays. */
export interface SourceDossier extends ChunkDigest { id: string; sourceRevision: string; coverage: SourceCoverage; childRefs: string[] }
export type SourceTaskStage = 'extract' | 'merge' | 'brief' | 'verify';
export interface SourceTaskEnvelope<T> {
  schemaVersion: 2; taskId: string; stage: SourceTaskStage; inputHash: string;
  sourceRevision: string; promptVersion: string; modelConfigHash: string; dependsOn: string[];
  coverage: SourceCoverage; payload: T; issues: SourceIssue[];
}
export interface SourceTaskNode {
  id: string; status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
  dependsOn: string[]; blockIds: string[]; inputHash: string; error?: string;
}
export interface SourceTaskGraph { tasks: Record<string, SourceTaskNode> }
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export interface SourceIndex { blocks: SourceBlock[]; revision: string }
export interface SourceLookupRequest { refIds: string[]; reason: string }
export interface SourceReconstructionArchive {
  blockTargetTokens?: number;
  schemaVersion: 2; sourceRevision: string; dossier: SourceDossier; brief: WorldCreationBrief;
  /** Original leaf digests remain available when an upper-level summary omits a detail. */
  digests: ChunkDigest[]; entityMap: Record<string, string>; scope: string;
}
export interface SourceCheckpoint {
  targetTokens?: number;
  mergeTokens?: number;
  maxMergeGroupSize?: number;
  version: 2; id: string; corpus: SourceCorpus; sourceRevision: string;
  tasks: Record<string, SourceTaskEnvelope<ChunkDigest | WorldCreationBrief>>;
  graph: SourceTaskGraph; dossier?: SourceDossier; brief?: WorldCreationBrief;
  updatedAt: number; modelConfigHash: string;
}
