import { chapterNarrativeEnabled } from '@/lib/game/chapters/context';
import { parseChapterSignal } from '@/lib/game/chapters/validation';
import type { AIGameResponse, KeiReviewMode } from './types';
import type { WorldDefinition, WorldSnapshot } from '@/lib/game/types';

export type KeiReviewTrigger = 'chapter_change' | 'periodic' | 'alice_request' | 'timeline_change' | 'relationship_change' | 'state_recheck';
export interface KeiReviewPlan { mode: KeiReviewMode; trigger: KeiReviewTrigger; causal: boolean }

export function selectKeiReviewPlan(response: AIGameResponse, world: WorldDefinition, periodic: boolean, snapshot?: WorldSnapshot): KeiReviewPlan | null {
  const request = response.reviewRequest;
  const requested = typeof request?.evidence === 'string' && request.evidence.trim().length > 0;
  const deviation = response.timelineDeviation;
  if (typeof deviation?.newOutcome === 'string' && deviation.newOutcome.trim() && world.timeline?.some(e => e.id === deviation.eventId)) {
    return { mode: 'blocking', trigger: 'timeline_change', causal: true };
  }
  if (snapshot && chapterNarrativeEnabled(world, snapshot) && parseChapterSignal(response.chapterSignal)) return { mode: 'background', trigger: 'chapter_change', causal: false };
  const meaningfulRelationship = response.relationshipUpdates?.some(r => Math.abs(r.affinityDelta ?? 0) >= 15 || Math.abs(r.trustDelta ?? 0) >= 15);
  const allowed = ['narrative_stall', 'continuity_uncertainty', 'major_turn', 'causal_change'];
  if (requested && allowed.includes(request!.reason)) return { mode: 'background', trigger: 'alice_request', causal: request!.reason === 'causal_change' };
  if (meaningfulRelationship) return { mode: 'background', trigger: 'relationship_change', causal: true };
  if (periodic) return { mode: 'background', trigger: 'periodic', causal: false };
  return null;
}
