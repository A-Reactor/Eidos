import type { SourceStyleSample } from './types';

/** Model safety was evaluated against one entry point; moving the entry point invalidates that judgment. */
export function eligibleSourceStyleSamples(input: { styleAnchorId?: string; currentAnchorId?: string; candidates: SourceStyleSample[] }): SourceStyleSample[] {
  return input.styleAnchorId === input.currentAnchorId ? input.candidates.filter(s => s.safe) : [];
}
