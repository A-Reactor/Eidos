import { expect, it } from 'vitest';
import { buildRiftCityMidGameState } from '@/lib/test/fixtures';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { buildActionPromptSections } from '@/lib/ai/prompt-templates';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
import { buildGameplayPromptSections } from '@/lib/game/plugins/runtime';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
const f = buildRiftCityMidGameState();
const history = '\n## 最近行动记录\n- 玩家：等候 → 雨一直下\n该次已接受正文：\n窗上的雨痕。';
function build(change: Partial<typeof f.snapshot> = {}, flexibleNarrative = false) {
  const snapshot = { ...f.snapshot, ...change };
  return buildActionPromptSections({ systemPromptBase: f.world.systemPromptBase, worldName: f.world.name, narrativeLanguage: 'zh-CN', flexibleNarrative,
    worldContext: buildWorldContextSections({ world: f.world, snapshot, historySummary: history, longMemoryContext: '本轮原文检索证据' }),
    timeNote: `当前 ${snapshot.currentGameTime.minute}`, pluginStatic: '', pluginRuntime: '' });
}
it('keeps accepted history before changing clock, scene, evidence and conditional rules', () => {
  const a = build(), b = build({ currentGameTime: { ...f.snapshot.currentGameTime, minute: 59 }, currentSceneId: 'north_market' },true);
  expect(a.stablePrefix).toBe(b.stablePrefix);
  const aa = composeSystemPrompt(a), bb = composeSystemPrompt(b);
  let i=0; while(aa[i] === bb[i] && i<Math.min(aa.length,bb.length)) i++;
  expect(i).toBeGreaterThan(aa.indexOf(history)+history.length);
  expect(bb.indexOf(history)).toBeLessThan(bb.indexOf('当前 59'));
  expect(bb.indexOf(history)).toBeLessThan(bb.indexOf('本轮原文检索证据'));
  expect(bb).toContain('north_market');
  expect(aa).toContain('## 悲剧因果约束'); expect(bb).not.toContain('## 悲剧因果约束');
});
it('keeps conditional plugin instructions out of the fixed edition', () => {
  const plugin = { ...resolveGameplayPlugins(['mystery'])[0], activation: { requires: { solved: true } } };
  const world = { ...f.world, gameplayPlugins: [plugin] };
  const a = buildGameplayPromptSections(world, 'action', { flags: {} });
  const b = buildGameplayPromptSections(world, 'action', { flags: { 'gameplay.mystery.solved': true } });
  expect(a.stablePrefix).toBe(b.stablePrefix);
  expect(a.dynamicSuffix).not.toBe(b.dynamicSuffix);
  expect(a.stablePrefix).not.toContain(plugin.prompts.action);
  expect(b.dynamicSuffix).toContain(plugin.prompts.action);
});
