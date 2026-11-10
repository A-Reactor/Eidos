import type { WorldCreationBrief, WorldBriefField } from '../world-creation-brief';
import type { SourceClaim, SourceDossier } from './types';
export interface AdaptationInput { brief: WorldCreationBrief; dossier: SourceDossier }
export interface EffectiveSourceFacts { history: SourceClaim[]; current: SourceClaim[]; future: SourceClaim[]; uncertain: SourceClaim[]; overridden: SourceClaim[]; unresolved: string[] }
const fieldCategories: Partial<Record<WorldBriefField, SourceClaim['category'][]>> = { npcs: ['character', 'relationship'], regions: ['place'], culture: ['world_rule', 'organization', 'theme'], history: ['event'], clues: ['unknown', 'object'] };
export function resolveEffectiveFacts({ brief, dossier }: AdaptationInput): EffectiveSourceFacts {
  const result: EffectiveSourceFacts = { history: [], current: [], future: [], uncertain: [], overridden: [], unresolved: dossier.unresolved };
  const overrides = new Set(brief.overrides.flatMap(o => o.factIds));
  const broad = new Set(brief.overrides.filter(o => !o.factIds.length).flatMap(o => fieldCategories[o.field] ?? []));
  const at = brief.startAnchor?.storyOrder;
  for (const fact of dossier.claims) {
    if (overrides.has(fact.id) || broad.has(fact.category)) { result.overridden.push(fact); continue; }
    if (at !== undefined && fact.storyOrder !== undefined && fact.storyOrder > at) { result.future.push(fact); continue; }
    if (fact.assertion !== 'objective' || fact.origin === 'inference') { result.uncertain.push(fact); continue; }
    if (fact.temporal === 'timeless') { result.current.push(fact); continue; }
    // A free-text entry point cannot inherit the source entry point's clock or character knowledge.
    if (brief.startAnchor?.id.startsWith('custom_')) { result.uncertain.push(fact); continue; }
    if (at !== undefined && fact.storyOrder !== undefined) {
      if (fact.storyOrder > at) result.future.push(fact);
      else if (fact.category === 'event' && fact.storyOrder < at || fact.untilOrder !== undefined && fact.untilOrder < at) result.history.push(fact);
      else result.current.push(fact);
    } else if (fact.temporal === 'history') result.history.push(fact);
    else if (fact.temporal === 'future') result.future.push(fact);
    else if (fact.temporal === 'current') result.current.push(fact);
    else result.uncertain.push(fact);
  }
  return result;
}
