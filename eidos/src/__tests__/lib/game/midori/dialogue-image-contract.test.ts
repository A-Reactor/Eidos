import { expect, it } from 'vitest';
import { buildDialogueReadoutModel } from '@/components/game/DialogueReadout';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
import { imageCatalogPrompt } from '@/lib/game/midori/image-context';
import { selectImageResource } from '@/lib/game/midori/image-selection';
import type { ImageResource } from '@/lib/game/midori/image-resource';

const image: ImageResource = { id: 'expression', worldId: 'world', type: 'character', targetId: '神秘猫',
  slot: 'portrait', label: '猫的表情', tags: ['love', '猫猫脸2'], description: '', imageUrl: '/expression.gif',
  source: 'uploaded', createdAt: 1, updatedAt: 1 };
function registry() {
  const assets = bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: 'world', targetType: 'character',
    targetId: '神秘猫', slot: 'avatar', imageUrl: '/default.png', source: 'uploaded' });
  assets.images = { [image.id]: image };
  return assets;
}
function displayedImage(json: string, assets = registry()) {
  const segment = extractSegmentsProgressive(json).segments[0];
  return buildDialogueReadoutModel({ currentSegment: segment, displayedText: segment?.text ?? '',
    assetRegistry: assets, worldId: 'world', sceneName: '广场', hasSceneImage: false })?.imageUrl;
}

it.each(['Love', ' ＬＯＶＥ ', 'love'])('matches custom tags consistently in avatars and portraits: %s', emotion => {
  expect(displayedImage(JSON.stringify({ segments: [{ type: 'dialogue', speaker: '神秘猫', emotion, text: '喵。' }] }))).toBe('/expression.gif');
  expect(selectImageResource(registry(), { worldId: 'world', targetType: 'character', targetId: '神秘猫', slot: 'portrait', emotion })?.imageUrl).toBe('/expression.gif');
});

it('decodes escaped speaker and expression metadata before streaming the dialogue', () => {
  const prefix = String.raw`{"segments":[{"type":"dialogue","speaker":"\u795e\u79d8\u732b","emotion":"\u732b\u732b\u81382","text":"喵`;
  expect(displayedImage(prefix)).toBe('/expression.gif');
  expect(displayedImage(prefix + '。"}]}')).toBe('/expression.gif');
});

it('does not fuzzy-match tag suffixes or assign another character or world image', () => {
  for (const patch of [{ emotion: 'love2' }, { emotion: '猫猫脸' }, { speaker: '陌生人', imageId: 'expression' }]) {
    const json = JSON.stringify({ segments: [{ type: 'dialogue', speaker: '神秘猫', emotion: 'love', text: '喵。', ...patch }] });
    expect(displayedImage(json)).not.toBe('/expression.gif');
  }
  expect(selectImageResource(registry(), { worldId: 'other', targetType: 'character', targetId: '神秘猫', slot: 'portrait', imageId: 'expression' })).toBeNull();
});

it('provides an executable dialogue example using an available character image, including later custom tags', () => {
  const catalog = [{ ...image, tags: ['平静', '开心', '悲伤', '生气', '惊讶', '思考', '担忧', '微笑', '猫猫脸2'], available: true }];
  const prompt = imageCatalogPrompt('world', catalog, undefined, ['神秘猫']);
  expect(prompt).toContain('猫猫脸2');
  const example = prompt.split('\n').find(line => line.startsWith('{"segments":'));
  expect(example).toBeDefined();
  expect(displayedImage(example!, { ...registry(), images: { [image.id]: { ...image, tags: catalog[0].tags } } })).toBe('/expression.gif');
  expect(JSON.parse(example!).segments[0]).toMatchObject({ speaker: '神秘猫', expressionTags: ['平静', '开心'] });
  expect(JSON.parse(example!).segments[0]).not.toHaveProperty('imageId');
  const unavailable = imageCatalogPrompt('world', [{ ...catalog[0], available: false }], undefined, ['神秘猫']);
  expect(unavailable.split('\n').some(line => line.startsWith('{"segments":'))).toBe(false);
});
