import { expect, it } from 'vitest';
import { buildGameplayStaticPrompt, buildGameplayPrompt } from '@/lib/game/plugins/runtime';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

const plugins = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'court', name: '法庭', description: '法庭机制', tags: [],
  activation: { requires: { hearing: true } }, prompts: { creation: '建立可进入法庭的条件', action: '逐句质询的完整指南', review: '核对质询' },
  data: { answer: '不应常驻的完整案件真相' }, rules: [{ id: 'enter', description: '玩家申请开庭', requires: { hearing: false }, sets: { hearing: true } }] }]);
it('omits dormant case instructions and data while keeping an explicit entry rule reachable', () => {
  const world = { gameplayPlugins: plugins };
  const dormant = buildGameplayStaticPrompt(world, 'action');
  expect(dormant).not.toContain('逐句质询的完整指南'); expect(dormant).not.toContain('不应常驻的完整案件真相');
  expect(dormant).toContain('玩家申请开庭');
  const active = buildGameplayPrompt(world, 'action', { 'gameplay.court.hearing': true });
  expect(active).toContain('逐句质询的完整指南'); expect(active).toContain('不应常驻的完整案件真相');
});
it('places an accepted gameplay fact view into the real world context without its presentation state', () => {
  const { world, snapshot } = buildRiftCityStartState();
  const result = buildWorldContextSections({ world, snapshot: { ...snapshot, gameplayContext: [{ pluginId: 'court', revision: 1, facts: { broken: '已推翻第一句' }, result: { id: 'one', revision: 1, summary: '已确认第一句矛盾', createdAt: 1, narration: 'pending' } }] } });
  expect(result.dynamicSuffix).toContain('已推翻第一句');
  expect(result.dynamicSuffix).toContain('已确认第一句矛盾');
  expect(result.stablePrefix).not.toContain('已推翻第一句');
});
