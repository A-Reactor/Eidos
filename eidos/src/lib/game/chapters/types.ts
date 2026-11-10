/** Editorial memory describes reading experience; it never grants character knowledge. */
export interface ChapterEvidenceRef { actionId: string; segment: number }
export interface ChapterPlan {
  id: string; title: string; kind: string; focus: string; stage: string;
  cast: Array<{ name: string; desire: string; tension: string }>;
  material: string[]; possibilities: string[]; closure: string[]; threadIds: string[];
}
export type ChapterStatus = 'active' | 'suspended' | 'completed' | 'merged';
export interface ChapterInstance extends ChapterPlan {
  status: ChapterStatus; openedAt: string; closedAt?: string; summary: string; experienceIds: string[];
}
export interface ChapterThread {
  id: string; title: string; kind: string; question: string;
  status: 'open' | 'paused' | 'resolved' | 'abandoned';
  characters: string[]; note: string; evidence: ChapterEvidenceRef[];
}
export interface ChapterPromise {
  id: string; text: string; status: 'open' | 'paid_off' | 'dropped'; evidence: ChapterEvidenceRef[];
}
export interface ChapterRelationship {
  id: string; characters: string[]; change: string; unresolved: string; evidence: ChapterEvidenceRef[];
}
export interface ChapterOpportunity {
  id: string; title: string; focus: string; grounds: string; characters: string[]; invalidatedBy: string;
}
export interface ChapterDecision {
  move: 'continue' | 'revise' | 'transition' | 'resume' | 'complete' | 'suspend' | 'merge';
  reason: string; evidence: ChapterEvidenceRef[];
  chapter?: ChapterPlan; targetId?: string; previousStatus?: Exclude<ChapterStatus, 'active'>;
  recap?: string;
  threads: ChapterThread[]; promises: ChapterPromise[]; relationships: ChapterRelationship[];
  candidates: ChapterOpportunity[];
}
export interface ChapterSignal {
  reason: 'turn' | 'departure' | 'closure' | 'stalled' | 'return' | 'new_focus';
  note: string; segments: number[];
}
export type ChapterInputSource = 'player' | 'choice' | 'continue' | 'automatic' | 'unknown';
export interface ChapterExperience {
  actionId: string; chapterId: string | null; input: string; inputSource: ChapterInputSource;
  sceneId: string; summary: string; segments: string[]; perspective: 'protagonist' | 'reader';
  signal?: ChapterSignal;
}
export interface ChapterBasis { worldId: string; revision: number; lastActionId: string | null }
export interface ChapterPreparation { basis: ChapterBasis; decision: ChapterDecision }
export interface ChapterEvent {
  actionId: string; move: ChapterDecision['move']; from: string | null; to: string | null;
  reason: string; evidence: ChapterEvidenceRef[];
}
export interface ChapterState {
  version: 1; worldId: string; revision: number; activeId: string | null;
  chapters: ChapterInstance[]; threads: ChapterThread[]; promises: ChapterPromise[];
  relationships: ChapterRelationship[]; candidates: ChapterOpportunity[];
  experiences: ChapterExperience[]; events: ChapterEvent[];
  needsPlanning?: ChapterSignal;
  /** Background proposals are rechecked against the next action's actual world state. */
  pending?: { basis: ChapterBasis; decision: ChapterDecision };
}
