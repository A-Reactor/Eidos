import { expect, it } from 'vitest';
import { restoreSourceBriefChoices } from '@/lib/game/source-reconstruction/brief-choices';
import { briefFromConcept } from '@/lib/game/world-creation-brief';
import type { WorldForm } from '@/lib/game/creation-materials';
import type { SourceDossier } from '@/lib/game/source-reconstruction/types';
it('restores explicit opening and selected original samples when a completed preset is rebuilt from unchanged references', () => {
  const fresh = briefFromConcept({ form: { name: '', overview: '', culture: '', regions: '', npcs: '', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' } as WorldForm }); fresh.origin = 'source';
  const early = { id: 'early', label: '清晨', sourceRefs: [], knownFactIds: {} }, later = { ...early, id: 'later', label: '日落' };
  const sample = { id: 'sample', text: '海风停了。', safe: true, traits: '短句', ref: { documentId: 'd', revision: 'r', blockId: 'b', start: 0, end: 5 } };
  fresh.startAnchor = early; fresh.sourceStyleAnchorId = 'early'; fresh.sourceDossierRef = 'same';
  const previous = structuredClone(fresh); previous.startAnchor = later; previous.sourceStyleAnchorId = 'later'; previous.styleChoice = 'source'; previous.sourceStyle = { traits: '克制', samples: [sample] };
  const dossier: SourceDossier = { id: 'same', starts: [early, later], styleCandidates: [sample], sourceRevision: 'r', coverage: { expected: [], completed: [], failed: [] }, childRefs: [], summary: '', blockIds: [], claims: [], entities: [], unresolved: [], issues: [] };
  const restored = restoreSourceBriefChoices(fresh, previous, dossier);
  expect(restored.startAnchor?.id).toBe('later');
  expect(restored.sourceStyle?.samples).toEqual([sample]);
  expect(restored.sourceStyleAnchorId).toBe('later');
});
