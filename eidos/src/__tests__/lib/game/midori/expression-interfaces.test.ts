import { expect, it } from 'vitest';
import { buildDialogueReadoutModel } from '@/components/game/DialogueReadout';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { createEmptyMidoriAssetRegistry, bindMidoriAsset } from '@/lib/game/midori/asset-registry';
import { imageWorkspacePath, type ImageResource } from '@/lib/game/midori/image-resource';
import { selectImageResource } from '@/lib/game/midori/image-selection';
import { selectDialogueImageResource } from '@/lib/game/midori/image-selection';
import { expressionVocabulary, EXPRESSION_VOCABULARY_CHAR_LIMIT, imageCatalogPrompt } from '@/lib/game/midori/image-context';
import type { StorySegment } from '@/lib/ai/types';

const image = (id: string, tags: string[], patch: Partial<ImageResource> = {}): ImageResource => ({
  id, tags, worldId: 'world', targetId: '神秘猫', type: 'character', slot: 'portrait', label: '猫的表情', description: '',
  imageUrl: `/${id}.gif`, source: 'uploaded', createdAt: 1, updatedAt: 1, ...patch,
});
function assets() {
  const registry = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: 'world', targetType: 'character', targetId: '神秘猫', slot: 'avatar', imageUrl: '/default.png', source: 'uploaded' });
  registry.images = Object.fromEntries([
    image('happy', ['开心']), image('dress', ['开心', '礼服']), image('cat2', ['猫猫脸2']),
    image('wrong-person', ['开心', '礼服', '猫猫脸2'], { targetId: '其他角色' }),
    image('wrong-world', ['开心', '礼服', '猫猫脸2'], { worldId: 'other' }),
    image('illustration', ['开心', '礼服', '猫猫脸2'], { type: 'illustration' }),
    image('deleted', ['开心', '礼服', '猫猫脸2']),
  ].map(item => [item.id, item]));
  registry.removedImageIds = ['deleted'];
  return registry;
}
function shown(segment: Partial<StorySegment>) {
  return buildDialogueReadoutModel({ currentSegment: { type: 'dialogue', speaker: '神秘猫', text: '喵。', ...segment }, displayedText: '喵。',
    assetRegistry: assets(), worldId: 'world', sceneName: '广场', hasSceneImage: false })?.imageUrl;
}

it('selects the best combination of expression keywords directly, with no file lookup or image ID', () => {
  expect(shown({ expressionTags: ['开心', '礼服'] })).toBe('/dress.gif');
  expect(shown({ expressionTags: ['猫猫脸2'], emotion: 'happy' })).toBe('/cat2.gif');
  expect(shown({ expressionTags: ['不存在'], emotion: 'happy' })).toBe('/happy.gif');
  expect(shown({ expressionTags: ['不存在'] })).toBe('/default.png');
  const registry = assets();
  registry.images!.avatar = image('avatar', ['开心'], { slot: 'avatar' });
  expect(selectDialogueImageResource(registry, { worldId: 'world', targetId: '神秘猫', expressionTags: ['开心', '礼服'] })?.id).toBe('dress');
});
it('uses familiar synonyms and metadata keywords without erasing custom tag suffixes', () => {
  expect(shown({ expressionTags: ['高兴', '礼服'] })).toBe('/dress.gif');
  expect(shown({ expressionTags: ['猫猫脸'] })).toBe('/default.png');
  const registry = assets();
  registry.images!.shy = image('shy', [], { label: '羞涩', description: '穿着雨衣，低头躲开视线。' });
  expect(selectImageResource(registry, { worldId: 'world', targetType: 'character', targetId: '神秘猫', slot: 'portrait', expressionTags: ['雨衣', '羞涩'] })?.id).toBe('shy');
});
it('uses the real workspace image path as an explicit reference with the same scope checks', () => {
  expect(shown({ expressionTags: ['开心'], imagePath: imageWorkspacePath('cat2') })).toBe('/cat2.gif');
  for (const id of ['wrong-person', 'wrong-world', 'illustration', 'deleted']) expect(shown({ imagePath: imageWorkspacePath(id) })).toBe('/default.png');
  for (const imagePath of ['/private/file.png', 'images/../cat2.json', 'https://example.com/image.png']) expect(shown({ imagePath })).toBe('/default.png');
  expect(shown({ imageId: 'cat2', expressionTags: ['开心'] })).toBe('/cat2.gif');
});
it('keeps complete and streaming expression arrays and paths, including more than 32 requested tags', () => {
  const segment = { type: 'dialogue', speaker: '神秘猫', expressionTags: [...Array.from({ length: 40 }, (_, i) => `其他${i}`), '猫猫脸2'], imagePath: imageWorkspacePath('cat2'), text: '喵。' };
  const json = JSON.stringify({ segments: [segment] });
  for (const input of [json, json.slice(0, json.indexOf('喵') + 1)]) {
    const decoded = extractSegmentsProgressive(input).segments[0];
    expect(decoded.expressionTags).toHaveLength(41);
    expect(decoded.imagePath).toBe(segment.imagePath);
    expect(shown(decoded)).toBe('/cat2.gif');
    expect(shown({ expressionTags: decoded.expressionTags })).toBe('/cat2.gif');
  }
  const escaped = String.raw`{"segments":[{"type":"dialogue","speaker":"\u795e\u79d8\u732b","expressionTags":["\u732b\u732b\u81382"],"text":"喵`;
  expect(shown(extractSegmentsProgressive(escaped).segments[0])).toBe('/cat2.gif');
});
it('exposes available tag categories beyond the old 12-image index while bounding the vocabulary', () => {
  const catalog = Array.from({ length: 90 }, (_, i) => ({ ...image(`entry${i}`, [`标签${i}`, '开心']), available: true }));
  const prompt = imageCatalogPrompt('world', catalog, undefined, ['神秘猫']);
  expect(prompt).toContain('标签89');
  expect(prompt).toContain('expressionTags');
  expect(prompt).toContain('imagePath');
  expect(prompt).not.toContain('entry89');
  const large = [...catalog, ...Array.from({ length: 800 }, (_, i) => ({ ...image(`later${i}`, [`其他长表情类别${i}`]), available: true }))];
  const vocabulary = expressionVocabulary(large, ['神秘猫']);
  expect(JSON.stringify(vocabulary.tags).length).toBeLessThanOrEqual(EXPRESSION_VOCABULARY_CHAR_LIMIT);
  expect(vocabulary.omitted).toBeGreaterThan(0);
  expect(expressionVocabulary([{ ...catalog[0], available: false }]).tags).toEqual([]);
});
