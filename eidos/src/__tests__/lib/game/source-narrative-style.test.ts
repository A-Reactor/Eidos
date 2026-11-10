import { expect, it } from 'vitest';
import { buildSourceNarrativeStyle, formatNarrativeStyleForAlice, normalizeNarrativeStyleProfile } from '@/lib/game/narrative-style';
it('injects verified original samples separately from preview examples and preserves them on normalization', () => {
  const style = buildSourceNarrativeStyle({ traits: '短句，声音先于景物', samples: [{ id: 's', text: '雨停了。门外只有船缆的声音。', traits: '短句', safe: true, ref: { documentId: 'd', revision: 'r', blockId: 'b', start: 0, end: 17 } }] });
  style.example = '只给界面看的例子';
  const normalized = normalizeNarrativeStyleProfile(style)!;
  expect(normalized.sourceReference).toEqual(style.sourceReference);
  expect(formatNarrativeStyleForAlice(normalized)).toContain('雨停了。门外只有船缆的声音。');
  expect(formatNarrativeStyleForAlice(normalized)).not.toContain(style.example);
  expect(formatNarrativeStyleForAlice(normalized)).toContain('不能作为角色知识');
});
it('does not offer samples evaluated at another opening until their knowledge boundary is checked', async () => {
  const { eligibleSourceStyleSamples } = await import('@/lib/game/source-reconstruction/style');
  const sample = { id: 's', text: '最后关闸的是医师。', traits: '短句', safe: true, ref: { documentId: 'd', revision: 'r', blockId: 'b', start: 0, end: 10 } };
  expect(eligibleSourceStyleSamples({ styleAnchorId: 'later', currentAnchorId: 'earlier', candidates: [sample] })).toEqual([]);
  expect(eligibleSourceStyleSamples({ styleAnchorId: 'later', currentAnchorId: 'later', candidates: [sample] })).toEqual([sample]);
});
