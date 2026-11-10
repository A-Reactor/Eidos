import { resolveEffectiveFacts } from './adaptation';
import type { SourceReconstructionArchive } from './types';

/** A fact about a character is not necessarily a fact the character knows. */
export function sourceCharacterFacts(source: SourceReconstructionArchive, npcId: string) {
  const entities = source.dossier.entities.filter(e => e.kind === 'character' && (e.name === npcId || e.aliases.includes(npcId) || source.entityMap[e.id] === npcId));
  const names = new Set([npcId, ...entities.flatMap(e => [e.id, e.name, ...e.aliases])]);
  const known = new Set(Object.entries(source.brief.startAnchor?.knownFactIds ?? {}).filter(([name]) => names.has(name)).flatMap(([, ids]) => ids));
  const effective = resolveEffectiveFacts({ brief: source.brief, dossier: source.dossier });
  return [...effective.history, ...effective.current].filter(f => f.entities.some(id => names.has(id)) && (known.has(f.id) || f.knownBy.some(name => names.has(name))));
}
