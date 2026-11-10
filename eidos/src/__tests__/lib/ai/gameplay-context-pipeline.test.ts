import { beforeEach, expect, it, vi } from 'vitest';
import { processPlayerAction } from '@/lib/ai/action-handler';
import { processPlayerActionStream } from '@/lib/ai/action-stream';
import { callAi, callAiStream } from '@/lib/ai/client';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { makeResponse, usage } from './kei-fixtures';
import type { AIGameResponse } from '@/lib/ai/types';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn(), callAiStream: vi.fn() }));
beforeEach(() => { vi.mocked(callAi).mockReset(); vi.mocked(callAiStream).mockReset(); });
const result = { pluginId: 'trial', revision: 1, facts: { broken: '第一句' }, result: { id: 'op-one', revision: 1, summary: '第一句已经被推翻', narration: 'pending' as const, createdAt: 1 } };
function input() {
  const { world, snapshot } = buildRiftCityStartState();
  return { world: { ...world, gameplayPlugins: parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'trial', name: '法庭', description: '测试法庭', tags: [], prompts: { creation: '', action: '集中展示证据推理，可以长篇旁白', review: '' }, rules: [] }]) },
    snapshot: { ...snapshot, gameplayContext: [result] }, recentHistory: [{ playerInput: '追问时间', summary: '证人补充', aiResponse: '关键原句：灯亮时我其实没有看钟。' }], playerInput: '承接第一句结果', narrativeRequest: { kind: 'result' as const, result: { pluginId: 'trial', id: 'op-one' } } };
}
it('builds a result-specific scene prompt and prevents a JSON response from replaying effects', async () => {
  vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify(makeResponse({ pluginEvents: [{ pluginId: 'trial', ruleId: 'spend' }], sceneChanges: ['fake'] })), usage, elapsedMs: 1 });
  const response = await processPlayerAction(input());
  const prompt = vi.mocked(callAi).mock.calls[0][0].systemPrompt;
  expect(prompt).toContain('第一句已经被推翻'); expect(prompt).toContain('集中展示证据推理');
  expect(prompt).toContain('关键原句：灯亮时我其实没有看钟。');
  expect(prompt).not.toContain('普通行动最多 1 个新事实'); expect(prompt).not.toContain('## 悲剧因果约束');
  expect(response._gameplayResult).toEqual({ pluginId: 'trial', id: 'op-one' });
  expect(response.sceneChanges).toEqual([]); expect(response.pluginEvents).toEqual([]);
});
it('applies the same confirmed-result protection to the actual streaming pipeline', async () => {
  vi.mocked(callAiStream).mockImplementation(async options => { options.onDone(JSON.stringify(makeResponse({ itemsUsed: ['证据'], sceneChanges: ['fake'] })), usage); });
  const responses: AIGameResponse[] = [];
  await processPlayerActionStream({ ...input(), callbacks: { onDone: response => responses.push(response), onError: error => { throw error; } } });
  expect(responses[0]._gameplayResult).toEqual({ pluginId: 'trial', id: 'op-one' });
  expect(responses[0].itemsUsed).toEqual([]); expect(responses[0].sceneChanges).toEqual([]);
});
