import { expect, it } from 'vitest';
import { sourceRuntimeContext } from '@/lib/game/source-reconstruction/runtime';
import { applyBriefEdit, briefFromConcept } from '@/lib/game/world-creation-brief';
import type { SourceClaim, SourceReconstructionArchive } from '@/lib/game/source-reconstruction/types';
import type { WorldForm } from '@/lib/game/creation-materials';
function source() {
  const brief = briefFromConcept({ form: { name: '', overview: '', culture: '', regions: '', npcs: '', contradictions: '', history: '', clues: '', opening: '', narrativeStyle: 'balanced' } as WorldForm }); brief.origin = 'source';
  const ref = { documentId: 'd', revision: 'r', blockId: 'b', start: 0, end: 20 };
  const fact: SourceClaim = { id: 'merged', text: '林是船工', category: 'character', origin: 'source', assertion: 'objective', temporal: 'current', entities: ['lin'], knownBy: ['林'], sourceRefs: [ref], requiresFactIds: [] };
  const digest = { summary: '', blockIds: ['b'], claims: [fact], entities: [], unresolved: [], styleCandidates: [], starts: [], issues: [] };
  const value: SourceReconstructionArchive = { schemaVersion: 2, sourceRevision: 'r', brief, scope: '', digests: [{ ...digest, claims: [{ ...fact, id: 'leaf' }] }], entityMap: {}, dossier: { ...digest, id: 'd', sourceRevision: 'r', coverage: { expected: ['b'], completed: ['b'], failed: [] }, childRefs: [] } };
  return { value, fact };
}
it('does not restore an overridden merged fact from its old leaf ID', () => {
  const { value } = source(); value.brief.fields.npcs.factRefs = ['merged'];
  value.brief = applyBriefEdit(value.brief, { field: 'npcs', text: '林是医师' }).brief;
  const context = sourceRuntimeContext(value);
  expect(context).toContain('林是医师');
  expect(context).not.toContain('林是船工');
});
it('reserves budget for required facts even when optional facts appear first', () => {
  const { value, fact } = source();
  value.digests = [];
  value.dossier.claims = [...Array.from({ length: 18 }, (_, i) => ({ ...fact, id: `optional_${i}`, text: '装饰'.repeat(50) })), { ...fact, id: 'required', text: 'MUST_KEEP_FACT' }];
  value.brief.fields.clues.required = true; value.brief.fields.clues.factRefs = ['required'];
  expect(sourceRuntimeContext(value)).toContain('MUST_KEEP_FACT');
});
it('replaces temporal and knowledge boundaries when the player writes a custom opening', () => {
  const { value } = source();
  value.brief.startAnchor = { id: 'old', label: '洪水前', storyOrder: 1, sourceRefs: [], knownFactIds: { 林: ['secret'] } };
  const result = applyBriefEdit(value.brief, { field: 'opening', text: '洪水十年后' });
  expect(result.brief.startAnchor?.label).toBe('洪水十年后');
  expect(result.brief.startAnchor?.storyOrder).toBeUndefined();
  expect(result.brief.startAnchor?.knownFactIds).toEqual({});
});
it('does not resurrect an obsolete local interpretation after a later chapter corrects it', () => {
  const { value, fact } = source();
  value.dossier.claims = [{ ...fact, text: '医师关闭了闸门' }];
  value.digests[0].claims = [{ ...fact, id: 'old', text: '闸门自行关闭' }];
  expect(sourceRuntimeContext(value)).not.toContain('闸门自行关闭');
  expect(sourceRuntimeContext(value)).toContain('医师关闭了闸门');
});
it('keeps a conditional later event in the future even when the source calls it an uncertain historical account', async () => {
  const { resolveEffectiveFacts } = await import('@/lib/game/source-reconstruction/adaptation');
  const { value, fact } = source();
  value.brief.startAnchor = { id: 'start', label: '今天', storyOrder: 0, sourceRefs: [], knownFactIds: {} };
  value.dossier.claims = [{ ...fact, temporal: 'history', assertion: 'uncertain', storyOrder: 1, text: '原故事第二天失踪' }];
  expect(resolveEffectiveFacts({ brief: value.brief, dossier: value.dossier }).future).toHaveLength(1);
  expect(sourceRuntimeContext(value)).not.toContain('原故事第二天失踪');
});
it('only seeds a character with facts that character knows at the chosen opening', async () => {
  const { sourceCharacterFacts } = await import('@/lib/game/source-reconstruction/character-facts');
  const { value, fact } = source();
  value.dossier.entities = [{ id: 'lin', name: '林', aliases: [], kind: 'character', sourceRefs: fact.sourceRefs }];
  value.dossier.claims = [fact, { ...fact, id: 'secret', text: '林尚不知道的身世', knownBy: ['医师'] }];
  expect(sourceCharacterFacts(value, '林').map(c => c.id)).toEqual(['merged']);
  value.brief.startAnchor = { id: 'later', label: '获知身世之后', sourceRefs: [], knownFactIds: { 林: ['secret'] } };
  expect(sourceCharacterFacts(value, '林').map(c => c.id)).toEqual(['merged', 'secret']);
});
