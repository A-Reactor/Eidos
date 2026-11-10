import type { TextEffect, TextEffectTarget } from '../text-effects';
export interface SegmentRange { start: number; textStart: number; end: number; textEnd: number; speakerStart: number; speakerEnd: number }
export interface PresentationCue {
  sourceEventId?:string;
  id: string; owner: string; source: number; targetNode: string; segment: number; field: TextEffectTarget;
  start: number; end: number; effect: TextEffect;
}
export interface Presentation {
  replicaOf?:string;
  /** Provenance for effects whose target story was outside an exported subtree. */
  detachedCues?:PresentationCue[];
  version: 1; ranges: SegmentRange[]; cues: PresentationCue[]; errors: string[];
  read: Record<string, { chars: number; complete: boolean }>;
  fired: Record<string, true>; armed: Record<string, number>;
  motion?: Record<string,number>;
  order?:Record<string,number>;
}
export interface ResolvedCue extends PresentationCue { active: boolean; executed:boolean; cancelled:boolean; remainingMs: number; clockArmed:boolean; order:number }
export interface PresentationEvidenceItem {
  id:string;kind:TextEffect['kind'];targetNode:string;segment:number;target:TextEffectTarget;
  state:'applied' | 'pending' | 'cancelled';effectId?:string;
  quote?:string;occurrence?:number;wholeField?:boolean;value?:string;detailsPartial?:boolean;
  brightness?:number;transitionMs?:number;
  beforeText?:string;afterText?:string;partial?:boolean;
}
