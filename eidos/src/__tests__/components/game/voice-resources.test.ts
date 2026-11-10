// @vitest-environment jsdom
import React from 'react';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VoiceResources } from '@/components/game/momoi/VoiceResources';
import { useGameStore } from '@/store/game-store';
import { DEFAULT_VOICE_CONFIG, voiceIdentity, type VoiceAsset } from '@/lib/game/momoi/model';
import { requestForSegment } from '@/lib/game/momoi/runtime';
import type { StorySegment } from '@/lib/ai/types';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  useGameStore.setState({ ...useGameStore.getInitialState(), voiceConfig: {
    ...DEFAULT_VOICE_CONFIG, provider: 'compatible', endpoint: 'http://localhost:8880/v1', model: 'kokoro', voice: 'zf_xiaobei',
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('combines saved or missing filters with search and gives an empty result when nothing matches', async () => {
  const segments: StorySegment[] = [
    { type: 'dialogue', speaker: '守卫', text: '钟楼今晚开放。' },
    { type: 'dialogue', speaker: '船夫', text: '渡口的船已经靠岸。' },
    { type: 'dialogue', speaker: '店主', text: '带一盏灯再出发。' },
  ];
  const assets: Record<string, VoiceAsset> = {};
  for (const segment of segments.slice(0, 2)) {
    const id = await voiceIdentity(requestForSegment(segment)!);
    assets[id] = { id, text: segment.text, speaker: segment.speaker!, emotion: 'neutral', audioBase64: 'UklGRg==', mimeType: 'audio/wav', provider: 'compatible', model: 'kokoro', createdAt: 1 };
  }
  useGameStore.setState({ voiceAssets: assets });
  render(React.createElement(VoiceResources, { segments }));
  await screen.findByText('钟楼今晚开放。');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: /^待生成/ }));
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article').textContent).toContain('店主');
  fireEvent.click(screen.getByRole('button', { name: /^已保存/ }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话音频' }), { target: { value: ' 守卫 ' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article').textContent).toContain('钟楼今晚开放。');
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话音频' }), { target: { value: '不存在' } });
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByText('没有找到匹配的音频。')).not.toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索对话音频' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: /^全部/ }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
});
