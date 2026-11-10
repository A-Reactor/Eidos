import { expect, it } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { selectCardContext } from '@/lib/game/cards/selection';
import { mountCardWorld } from '@/lib/game/cards/binding';

function asset(description: string, entry: Record<string, unknown> = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: '卡', description, character_book: { entries: [{ content: '隐藏条目', keys: ['secret'], enabled: true, ...entry }] } }));
  return { ...parseCardBytes(bytes, 'card.json'), id: 'a'.repeat(64), filename: 'card.json', originalBytes: bytes, createdAt: 1 };
}
function select(card: ReturnType<typeof asset>, query: string) {
  return selectCardContext({ assets: [card], bindings: [{ assetId: card.id, role: 'world', name: '卡', enabled: true }], query, sceneNpcs: [], playerName: '玩家' });
}
it('blocks unsupported macros in required definitions instead of sending unresolved rules', () => {
  expect(() => select(asset('信任={{setvar::trust::1}}'), 'secret')).toThrow(/宏/);
  expect(() => select(asset('核心', { constant: true, content: '{{random::allow::deny}}' }), '')).toThrow(/宏/);
});
it('omits unsupported macros and source regex spellings in optional entries with a reason', () => {
  const macro = select(asset('核心', { content: '{{setvar::secret::1}}' }), 'secret');
  expect(macro.dynamicSuffix).not.toContain('getvar'); expect(macro.omitted[0].reason).toMatch(/宏/);
  const regex = select(asset('核心', { useRegex: true }), 'secret');
  expect(regex.dynamicSuffix).not.toContain('隐藏条目'); expect(regex.omitted[0].reason).toMatch(/正则/);
});
it('honors extension case sensitivity and whole-word matching', () => {
  const card = asset('核心', { keys: ['US'], extensions: { caseSensitive: true } });
  expect(select(card, 'us').dynamicSuffix).not.toContain('隐藏条目');
  expect(select(card, 'US').dynamicSuffix).toContain('隐藏条目');
  const words = select(asset('核心', { keys: ['secret'], extensions: { matchWholeWords: true } }), 'secretive');
  expect(words.dynamicSuffix).not.toContain('隐藏条目'); expect(words.omitted[0].reason).toMatch(/关键词/);
  expect(select(asset('核心', { keys: ['secret'], extensions: { matchWholeWords: true } }), 'a secret!').dynamicSuffix).toContain('隐藏条目');
});
it('rejects an over-limit world at mounting rather than creating an unplayable archive', () => {
  const card = asset('核心'); const world = mountCardWorld({ asset: card, role: 'world' });
  world.cardBindings = Array.from({ length: 16 }, (_, i) => ({ assetId: card.id, name: `卡${i}`, role: 'world', enabled: true }));
  expect(() => mountCardWorld({ asset: card, role: 'world', world })).toThrow(/16/);
  expect(world.cardBindings).toHaveLength(16);
});
