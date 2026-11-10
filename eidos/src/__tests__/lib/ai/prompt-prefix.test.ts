import { describe, expect, it } from 'vitest';
import { buildRiftCityMidGameState } from '@/lib/test/fixtures';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { buildActionPromptSections } from '@/lib/ai/prompt-templates';
import { composeSystemPrompt, stableRecordJSON } from '@/lib/ai/prompt-layout';
import { buildGameplayStaticPrompt, buildGameplayRuntimePrompt } from '@/lib/game/plugins/runtime';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import type { WorldSnapshot } from '@/lib/game/types';
const state = buildRiftCityMidGameState();
const world = { ...state.world, gameplayPlugins: resolveGameplayPlugins(['mystery']), gameModeConfig: { z: true, a: { y: 2, x: 1 } } };
function build(snapshot: WorldSnapshot, history = '历史甲\n历史乙', memory = '证据甲\n证据乙', language: 'zh-CN' | 'en' = 'zh-CN') {
  return buildActionPromptSections({ systemPromptBase: world.systemPromptBase, worldName: world.name,
    worldContext: buildWorldContextSections({ world, snapshot, inventory: snapshot.inventory, npcStates: snapshot.npcStates, historySummary: history, longMemoryContext: memory }),
    timeNote: `当前时间 ${snapshot.currentGameTime.hour}:${snapshot.currentGameTime.minute}`,
    pluginStatic: buildGameplayStaticPrompt(world, 'action'), pluginRuntime: buildGameplayRuntimePrompt(world, snapshot.worldFlags),
    literaryControl: { directorFrame: snapshot.lastDirectorFrame, uzqBrief: `UZQ ${snapshot.historyLength}` }, narrativeLanguage: language });
}
describe('ALICE reusable complete prefixes', () => {
  it('keeps all changing state after fixed rules, schema, language and world/plugin guides', () => {
    const first = build(state.snapshot);
    const changed = build({ ...state.snapshot, currentGameTime: { day: 2, hour: 14, minute: 15 }, historyLength: 9,
      inventory: state.snapshot.inventory.map(item => ({ ...item, quantity: 3 })), npcStates: { '观测员埃琳娜': '正在查看新证据' }, worldFlags: { 'gameplay.mystery.solved': true },
      lastDirectorFrame: { beatFunction: 'recognition', tensionTarget: 'hold', narrativeFocus: [], revealBudget: { allowNewSecret: false, maxFactsToReveal: 1, forbiddenFacts: ['不得揭示核心'] }, successCriteria: ['回答证据'] } }, '新历史甲\n新历史乙', '新证据甲\n新证据乙');
    expect(first.stablePrefix).toBe(changed.stablePrefix);
    for (const value of ['14:15', 'x3', '正在查看新证据', '"gameplay.mystery.solved":true', 'recognition', '不得揭示核心', '新历史甲', '新证据甲', 'UZQ 9']) expect(changed.dynamicSuffix).toContain(value);
    for (const value of ['## 输出格式', 'availableActions', '世界玩法插件', world.overview]) {
      expect(first.stablePrefix).toContain(value);
    }
    expect(composeSystemPrompt(first)).toContain('[test_item_001]');
    expect(first.dynamicSuffix.indexOf('证据甲')).toBeGreaterThan(first.dynamicSuffix.indexOf('历史甲'));
  });
  it('changes the prefix when language or world definitions change', () => {
    expect(build(state.snapshot, undefined, undefined, 'en').stablePrefix).not.toBe(build(state.snapshot).stablePrefix);
    const a = buildWorldContextSections({ world, snapshot: state.snapshot });
    const b = buildWorldContextSections({ world: { ...world, overview: '新世界定义' }, snapshot: state.snapshot });
    expect(a.stablePrefix).not.toBe(b.stablePrefix);
    expect(build({ ...state.snapshot, currentSceneId: 'north_market' }).stablePrefix).toBe(build(state.snapshot).stablePrefix);
  });
  it('sorts plain record keys while preserving arrays and instruction text', () => {
    expect(stableRecordJSON({ z: { b: 2, a: 1 }, a: ['乙', '甲'] })).toBe(stableRecordJSON({ a: ['乙', '甲'], z: { a: 1, b: 2 } }));
    expect(stableRecordJSON(['乙', '甲'])).not.toBe(stableRecordJSON(['甲', '乙']));
    const reversed = { ...world, gameModeConfig: { a: { x: 1, y: 2 }, z: true } };
    expect(buildGameplayStaticPrompt(world, 'action')).toBe(buildGameplayStaticPrompt(reversed, 'action'));
    const flags = { 'gameplay.mystery.a': true, 'gameplay.mystery.b': false };
    expect(buildGameplayRuntimePrompt(world, flags)).toBe(buildGameplayRuntimePrompt(world, { 'gameplay.mystery.b': false, 'gameplay.mystery.a': true }));
    expect(buildGameplayStaticPrompt(world, 'action')).toContain('插件不能授予文件、网络或沙箱工具权限');
  });
});
