import { expect, it } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { selectCardContext } from '@/lib/game/cards/selection';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
import { validateCardContext } from '@/lib/game/cards/validation';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

it('keeps source instruction and post-history semantics separate from lore and unplayed examples', () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: '档案员', description: '角色核心原文', system_prompt: '角色行为前置原文', post_history_instructions: '角色行为后置原文', mes_example: '这是一段语气范例，不是发生过的对话', first_mes: '尚未发生的开场' }));
  const asset = { ...parseCardBytes(bytes, 'character.json'), id: 'b'.repeat(64), filename: 'character.json', originalBytes: bytes, createdAt: 1 };
  const { world: base, snapshot } = buildRiftCityStartState(), world = mountCardWorld({ asset, world: base, role: 'world' });
  const cards = selectCardContext({ assets: [asset], bindings: world.cardBindings!, query: '档案', sceneNpcs: [], playerName: '玩家', initial: false });
  const sections = buildWorldContextSections({ world, snapshot, cardContext: cards, historySummary: '\n## 最近行动记录\n唯一实际历史' });
  const prompt = composeSystemPrompt(sections);
  expect(prompt.indexOf('角色行为前置原文')).toBeLessThan(prompt.indexOf('唯一实际历史'));
  expect(prompt.indexOf('角色行为后置原文')).toBeGreaterThan(prompt.indexOf('唯一实际历史'));
  expect(prompt).toContain('语气与表现范例'); expect(prompt).toContain('这是一段语气范例，不是发生过的对话');
  expect(prompt).not.toContain('尚未发生的开场');
  expect(asset.originalBytes).toEqual(bytes);
  expect(() => validateCardContext(cards, world.cardBindings, 10)).toThrow(/预算/);
});
