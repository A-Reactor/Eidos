import { describe, expect, it } from 'vitest';
import { briefFromConcept, applyBriefEdit, serializeWorldBrief, WORLD_BRIEF_FIELDS } from '@/lib/game/world-creation-brief';
import type { WorldForm } from '@/lib/game/creation-materials';
const form = { ...Object.fromEntries(WORLD_BRIEF_FIELDS.map(k => [k, ''])), name: '雨港', npcs: '阿岚是船工', narrativeStyle: 'balanced' } as WorldForm;
describe('shared world brief', () => {
  it('builds a concept locally with explicit constraints and no source policy', () => {
    const brief = briefFromConcept({ form });
    expect(brief.origin).toBe('concept');
    expect(brief.fields.npcs.policy).toBe('custom');
    expect(Object.values(brief.fields).some(f => f.policy === 'source')).toBe(false);
    const edited = applyBriefEdit(brief, { field: 'npcs', required: true });
    expect(serializeWorldBrief(edited.brief)).toContain('必须保留');
    expect(serializeWorldBrief(edited.brief)).not.toContain('更有戏剧性');
  });
  it('retains source and custom drafts when switching policies and invalidates dependent stages', () => {
    const brief = briefFromConcept({ form }); brief.origin = 'source'; brief.fields.npcs.policy = 'source'; brief.fields.npcs.sourceText = '阿岚是船工';
    brief.fields.npcs.factRefs = ['f1'];
    const edit = applyBriefEdit(brief, { field: 'npcs', text: '阿岚是医师' });
    expect(edit.brief.fields.npcs.policy).toBe('custom');
    expect(edit.invalidated).toEqual(['world', 'timeline', 'seeds']);
    expect(edit.brief.overrides[0].factIds).toEqual(['f1']);
    const source = applyBriefEdit(edit.brief, { field: 'npcs', policy: 'source' });
    expect(source.brief.fields.npcs.text).toBe('阿岚是船工');
    const custom = applyBriefEdit(source.brief, { field: 'npcs', policy: 'custom' });
    expect(custom.brief.fields.npcs.text).toBe('阿岚是医师');
    expect(brief.fields.npcs.text).toBe('阿岚是船工');
  });
  it('changing only style preserves structural generations', () => {
    const result = applyBriefEdit(briefFromConcept({ form }), { styleChoice: 'preset' });
    expect(result.invalidated).toEqual(['style']);
  });
});
