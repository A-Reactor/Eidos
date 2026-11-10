import { describe, expect, it } from 'vitest';
import { compileWorldCreation, validateCreatedWorld, sourceTimelinePrompt } from '@/lib/ai/world-creation-compiler';
import { resolveEffectiveFacts } from '@/lib/game/source-reconstruction/adaptation';
import { briefFromConcept, applyBriefEdit, WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
import type { WorldForm } from '@/lib/game/creation-materials';
import type { SourceDossier, SourceClaim } from '@/lib/game/source-reconstruction/types';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

function materials() {
  const form = { ...Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, ''])), name: '雨港', npcs: '阿岚是船工', narrativeStyle: 'balanced' } as WorldForm;
  const brief = briefFromConcept({ form }); brief.origin = 'source'; brief.fields.npcs.policy = 'source'; brief.fields.npcs.sourceText = form.npcs; brief.fields.npcs.factRefs = ['identity'];
  brief.startAnchor = { id: 's', label: '雨停时', storyOrder: 1, sourceRefs: [], knownFactIds: {} };
  const base: SourceClaim = { id: 'identity', text: '阿岚是船工', category: 'character', origin: 'source', assertion: 'objective', temporal: 'current', entities: ['阿岚'], knownBy: ['阿岚'], sourceRefs: [], requiresFactIds: [] };
  const dossier: SourceDossier = { id: 'd', sourceRevision: 'r', summary: '雨港', blockIds: ['b'], entities: [], claims: [base, { ...base, id: 'past', text: '去年建了堤坝', category: 'event', temporal: 'history', storyOrder: 0 }, { ...base, id: 'future', text: '阿岚在洪水中失踪', category: 'event', temporal: 'future', storyOrder: 2 }], unresolved: [], styleCandidates: [], starts: [brief.startAnchor], issues: [], coverage: { expected: ['b'], completed: ['b'], failed: [] }, childRefs: [] };
  return { brief, dossier };
}
describe('common world compiler', () => {
  it('keeps future events conditional and applies explicit overrides without mutating the source', () => {
    const { brief, dossier } = materials();
    const effective = resolveEffectiveFacts({ brief, dossier });
    expect(effective.history.map(f => f.id)).toEqual(['past']);
    expect(effective.future.map(f => f.id)).toEqual(['future']);
    const edited = applyBriefEdit(brief, { field: 'npcs', text: '阿岚是医师' }).brief;
    expect(resolveEffectiveFacts({ brief: edited, dossier }).current.some(f => f.id === 'identity')).toBe(false);
    expect(dossier.claims[0].text).toBe('阿岚是船工');
    expect(compileWorldCreation({ brief: edited, dossier }).userMessage).toContain('阿岚是医师');
  });
  it('shares the standard world schema and rejects incomplete coverage or blocking conflicts', () => {
    const { brief, dossier } = materials();
    const source = compileWorldCreation({ brief, dossier });
    const concept = compileWorldCreation({ concept: '雨港中的调查故事' });
    expect(source.systemPrompt).toContain('regions');
    expect(concept.systemPrompt).toContain('regions');
    expect(source.userMessage).not.toContain('corpus');
    expect(sourceTimelinePrompt('quick')).not.toContain('365');
    const incomplete = { ...dossier, coverage: { ...dossier.coverage, completed: [] } };
    expect(() => compileWorldCreation({ brief, dossier: incomplete })).toThrow('完整');
    expect(() => compileWorldCreation({ brief: { ...brief, issues: [{ code: 'conflict', message: '开局身份冲突', blocking: true }] }, dossier })).toThrow('开局身份冲突');
  });
  it('validates scene and clue references before semantic review', () => {
    const world = buildRiftCityStartState().world;
    expect(validateCreatedWorld({ world }).ok).toBe(true);
    expect(validateCreatedWorld({ world: { ...world, regions: {} } }).ok).toBe(false);
    const invalid = { ...world, clues: [{ ...world.clues[0], sceneId: 'missing' }] };
    expect(validateCreatedWorld({ world: invalid }).ok).toBe(false);
  });
});
it('normalizes an explicitly declared scene region without inventing map content', async () => {
  const { normalizeCreatedWorldStructure } = await import('@/lib/ai/world-creation-compiler');
  const world = structuredClone(buildRiftCityStartState().world);
  const from = Object.keys(world.regions)[0], sceneId = Object.keys(world.regions[from].scenes)[0];
  world.regions.destination = { ...world.regions[from], id: 'destination', scenes: {} };
  world.regions[from].scenes[sceneId].region = 'destination';
  normalizeCreatedWorldStructure(world);
  expect(world.regions.destination.scenes[sceneId].region).toBe('destination');
  expect(world.regions[from].scenes[sceneId]).toBeUndefined();
});
it('passes canonical source names and aliases to the shared compiler for NPC identity mapping', () => {
  const { brief, dossier } = materials();
  dossier.entities = [{ id: 'npc_alan', name: '阿岚', aliases: ['阿兰'], kind: 'character', sourceRefs: [] }];
  expect(compileWorldCreation({ brief, dossier }).userMessage).toContain('阿兰');
});
