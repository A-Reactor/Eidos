// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DialogueReadout } from '@/components/game/DialogueReadout';
import { extractSegmentsProgressive } from '@/lib/ai/stream-parser';
import { segmentKaomoji } from '@/lib/game/kaomoji';
import { useGameStore } from '@/store/game-store';
import { bindMidoriAsset, createEmptyMidoriAssetRegistry } from '@/lib/game/midori/asset-registry';
afterEach(cleanup);
const segment = { type: 'dialogue' as const, text: '你好。', speaker: '甲', emotion: 'happy' as const, kaomoji: '(ﾉ◕ヮ◕)ﾉ' };
it('keeps custom expressions in complete and streaming segments', () => {
  const full = JSON.stringify({ segments: [segment] });
  expect(extractSegmentsProgressive(full).segments[0].kaomoji).toBe(segment.kaomoji);
  const draft = '{"segments":[{"type":"dialogue","speaker":"甲","kaomoji":"(＾▽＾)","text":"你';
  expect(extractSegmentsProgressive(draft).segments[0].kaomoji).toBe('(＾▽＾)');
});
it('uses safe emotion fallbacks for old or malformed expressions', () => {
  expect(segmentKaomoji({ ...segment, kaomoji: 'x\ny' })).toBe('(＾▽＾)');
  expect(segmentKaomoji({ ...segment, kaomoji: 'x'.repeat(33) })).toBe('(＾▽＾)');
  expect(segmentKaomoji({ type: 'narration', text: '房间静了。' })).toBe('');
});
it('puts expressions in an empty dialogue avatar and lets an uploaded image cover them', () => {
  useGameStore.setState({ midoriAssetRegistry: createEmptyMidoriAssetRegistry() });
  const view = render(React.createElement(DialogueReadout, { currentSegment: segment, displayedText: "你好。", sceneName: "门口", hasSceneImage: true }));
  expect(screen.getByLabelText('甲 头像').textContent).toContain(segment.kaomoji);
  expect(screen.getByText('你好。', { exact: false })).toBeTruthy();
  act(() => useGameStore.setState({ midoriAssetRegistry: bindMidoriAsset(createEmptyMidoriAssetRegistry(), { worldId: 'world', targetType: 'character', targetId: '甲', slot: 'avatar', source: 'uploaded', imageUrl: 'data:image/png;base64,YQ==' }) }));
  expect(screen.getByRole('img', { name: '甲' })).toBeTruthy();
  expect(screen.getByLabelText('甲 头像').textContent).not.toContain(segment.kaomoji);
  view.unmount();
});
