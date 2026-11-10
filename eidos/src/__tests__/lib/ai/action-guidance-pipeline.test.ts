import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIGameResponse } from '@/lib/ai/types';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { usage } from './kei-fixtures';

vi.mock('@/lib/ai/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai/client')>(),
  callAi: vi.fn(),
  callAiStream: vi.fn(),
  callDeepSeek: vi.fn(),
}));

import { callAi, callAiStream, callDeepSeek } from '@/lib/ai/client';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { buildSystemPrompt } from '@/lib/ai/builtin-worlds';
import { AI_SYSTEM_PROMPT_BASE } from '@/data/world/rift-city';

const response: AIGameResponse = {
  validity: { isPossible: true, fantasyResponse: null, reason: null },
  segments: [{ type: 'narration', text: '守卫确认没有看见驾驶者，将货运登记簿递给你。' }],
  availableActions: ['用已知时间核对货运登记', '向守卫道谢，离开仓库'],
  summary: '得到时间线与登记簿',
  timeSpent: { day: 0, hour: 0, minute: 5 },
  sceneChanges: [], discoveredSecrets: [], npcsReacted: [], worldImpacts: [],
  itemsGained: [], itemsUsed: [], cluesDiscovered: [],
};

beforeEach(() => {
  vi.mocked(callDeepSeek).mockReset().mockResolvedValue({ content: '{"narrative":"我不知道","summary":"回忆"}', usage, elapsedMs: 1 });
  vi.mocked(callAi).mockReset().mockResolvedValue({ content: JSON.stringify(response), usage, elapsedMs: 1 });
  vi.mocked(callAiStream).mockReset().mockImplementation(async (options) => {
    options.onChunk(JSON.stringify(response));
    options.onDone(JSON.stringify(response), usage);
  });
});

describe('recommended actions at the model boundary', () => {
  it('sends scoped raw card originals in both action paths and keeps secrets out of introspection', async () => {
    const { world, snapshot } = buildRiftCityStartState();
    const assetId = 'a'.repeat(64);
    const boundWorld = { ...world, cardBindings: [{ assetId, role: 'world' as const, name: '原卡', enabled: true }] };
    const cardContext = { stablePrefix: '原卡长期规则\n  缩进', dynamicSuffix: '原卡秘密：金箔', selected: [{ assetId, pointer: '/data/description', reason: 'core', chars: 20 }], omitted: [] };
    const options = { world: boundWorld, snapshot, playerInput: '检查金箔', cardContext };
    await processPlayerAction(options);
    await processPlayerActionStream({ ...options, callbacks: {} });
    for (const prompt of [vi.mocked(callAi).mock.calls[0][0].systemPrompt, vi.mocked(callAiStream).mock.calls[0][0].systemPrompt]) {
      expect(prompt).toContain('原卡长期规则\n  缩进');
      expect(prompt).toContain('原卡秘密：金箔');
      expect(prompt).toContain('availableActions');
    }
    await processPlayerAction({ ...options, introspection: true });
    expect(vi.mocked(callDeepSeek).mock.calls[0][0]).not.toContain('原卡秘密');
  });
  it.each([
    [0, '细节展示'], [30, null], [50, null], [70, null], [100, '任务推进'],
  ] as const)('uses the same continuation policy at bias %i in both generation paths', async (generationBias, mode) => {
    const { world, snapshot } = buildRiftCityStartState();
    snapshot.lastDirectorFrame = {
      beatFunction: 'recognition', tensionTarget: 'hold', narrativeFocus: [],
      revealBudget: { allowNewSecret: false, maxFactsToReveal: 1, forbiddenFacts: ['核心秘密'] },
      successCriteria: ['明确守卫的认知边界'],
    };
    const options = { playerInput: '询问驾驶者的身份', world, snapshot, generationBias, narrativeLanguage: 'en' as const };
    const candidate = await processPlayerAction({ ...options, skipKeiStorage: true });
    let streamed: AIGameResponse | undefined;
    await processPlayerActionStream({ ...options, callbacks: { onDone: data => { streamed = data; } } });

    expect(callAi).toHaveBeenCalledOnce();
    expect(callAiStream).toHaveBeenCalledOnce();
    expect(candidate.availableActions).toEqual(['用已知时间核对货运登记', '向守卫道谢，离开仓库']);
    expect(streamed?.availableActions).toEqual(candidate.availableActions);
    const prompts = [vi.mocked(callAi).mock.calls[0][0].systemPrompt, vi.mocked(callAiStream).mock.calls[0][0].systemPrompt];
    for (const prompt of prompts) {
      expect(prompt.match(/## 推荐行动（availableActions）/gu)).toHaveLength(1);
      expect(prompt).toContain('第一项是故事自然接续的一步');
      expect(prompt).toContain('其余选项提供当前情境中实质不同的尝试');
      expect(prompt).toContain('选项以玩家此刻可知的信息表述意图和行动');
      expect(prompt).toContain('戏剧功能：recognition');
      expect(prompt).toContain('核心秘密');
      expect(prompt).toContain('Write all player-facing generated text in English');
      expect(prompt).not.toContain('玩家连续调查：');
      expect(prompt).not.toContain('细节导向的行动放在第一个选项');
      expect(prompt).not.toContain('将 segments 扩展到 8-12 段');
      if (mode) expect(prompt).toContain(`## 生成方向：${mode}`);
      else expect(prompt).not.toContain('## 生成方向：');
    }
    expect(prompts[0]).toBe(prompts[1]);
    const section = (prompt: string) => prompt.split('## 推荐行动（availableActions）')[1].split('\n## ')[0];
    expect(section(prompts[0])).toBe(section(prompts[1]));
  });

  it('gives current world bases a consistent role without overriding the first action with a clock rule', () => {
    for (const base of [buildSystemPrompt('测试城', '已确立的世界'), AI_SYSTEM_PROMPT_BASE]) {
      expect(base).toContain('推荐选项');
      expect(base).not.toContain('不暗示「应该做什么」');
      expect(base).not.toContain('availableActions 首位');
    }
  });
});

it('includes saved player instructions once in both narrative paths and introspection, with a stable prefix and budget entry', async () => {
  const { world, snapshot } = buildRiftCityStartState();
  const clientSettings = { aliceUserPrompt: '让对白简练，保留环境里的声音。' };
  const options = { playerInput: '观察', world, snapshot, clientSettings };
  await processPlayerAction(options);
  await processPlayerActionStream({ ...options, callbacks: {} });
  for (const request of [vi.mocked(callAi).mock.calls[0][0], vi.mocked(callAiStream).mock.calls[0][0]]) {
    expect(request.promptSections!.stablePrefix).toContain(clientSettings.aliceUserPrompt);
    expect(request.systemPrompt.split(clientSettings.aliceUserPrompt)).toHaveLength(2);
    expect(request.promptSections!.components!.find(c => c.id === 'preferences')!.text).toContain(clientSettings.aliceUserPrompt);
  }
  await processPlayerAction({ ...options, introspection: true });
  expect(vi.mocked(callDeepSeek).mock.calls[0][0]).toContain(clientSettings.aliceUserPrompt);
});
