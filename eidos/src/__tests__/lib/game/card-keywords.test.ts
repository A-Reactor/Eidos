import { describe, expect, it } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { cardCompatibility } from '@/lib/game/cards/entries';
import { selectCardContext } from '@/lib/game/cards/selection';
import type { CardAsset } from '@/lib/game/cards/types';

function asset(entries: Record<string, unknown>[], character = false): CardAsset {
  const document = character ? { spec: 'chara_card_v2', data: { name: '世界', description: '', character_book: { entries } } }
    : { name: '世界', entries: Object.fromEntries(entries.map((entry, index) => [String(index), entry])) };
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  return { ...parseCardBytes(bytes, 'source.json'), id: 'a'.repeat(64), filename: 'source.json', originalBytes: bytes, createdAt: 1 };
}
function select(card: CardAsset, query: string, maxChars?: number) {
  return selectCardContext({ assets: [card], bindings: [{ assetId: card.id, role: 'world', name: '世界', enabled: true }],
    query, sceneNpcs: [], playerName: '旅人', maxChars });
}
const entry = { keys: ['gate'], secondary_keys: ['key', 'lamp'], selective: true, content: '门的隐藏原文', enabled: true };

describe('original lorebook keyword rules', () => {
  it.each([
    [0, 'gate', false], [0, 'gate key', true], [0, 'gate lamp', true], [0, 'gate key lamp', true], [0, 'key lamp', false],
    [1, 'gate', true], [1, 'gate key', true], [1, 'gate lamp', true], [1, 'gate key lamp', false], [1, 'key lamp', false],
    [2, 'gate', true], [2, 'gate key', false], [2, 'gate lamp', false], [2, 'gate key lamp', false], [2, 'key lamp', false],
    [3, 'gate', false], [3, 'gate key', false], [3, 'gate lamp', false], [3, 'gate key lamp', true], [3, 'key lamp', false],
  ])('selective logic %i scans "%s" and activates=%s', (logic, query, want) => {
    const result = select(asset([{ ...entry, extensions: { selectiveLogic: logic } }], true), String(query));
    expect(result.dynamicSuffix.includes('门的隐藏原文')).toBe(want);
    if (!want) expect(result.omitted[0].reason).toMatch(/关键词/);
  });

  it('reads standalone key and keysecondary fields without converting their source', () => {
    const card = asset([{ key: ['gate'], keysecondary: ['key'], selective: true, selectiveLogic: 0, content: '独立书原文\n  \\n😀' }]);
    const original = Uint8Array.from(card.originalBytes), document = structuredClone(card.document);
    expect(select(card, 'gate').dynamicSuffix).not.toContain('独立书原文');
    expect(select(card, 'gate key').dynamicSuffix).toContain('独立书原文\n  \\n😀');
    expect(card.originalBytes).toEqual(original); expect(card.document).toEqual(document);
    expect(cardCompatibility(card).warnings.join(' ')).not.toContain('组合关键词');
  });

  it('ignores an empty secondary filter or a disabled selective flag', () => {
    expect(select(asset([{ ...entry, secondary_keys: [] }]), 'gate').dynamicSuffix).toContain('门的隐藏原文');
    expect(select(asset([{ ...entry, selective: false, selectiveLogic: 3 }]), 'gate').dynamicSuffix).toContain('门的隐藏原文');
  });

  it('keeps constant content active even when no primary or secondary keyword matches', () => {
    expect(select(asset([{ ...entry, constant: true, selectiveLogic: 3 }]), '').stablePrefix).toContain('门的隐藏原文');
  });

  it('applies whole-word boundaries and case sensitivity to both keyword lists', () => {
    const card = asset([{ ...entry, keys: ['US'], secondary_keys: ['key'], extensions: { match_whole_words: true, case_sensitive: true } }]);
    expect(select(card, 'US key!').dynamicSuffix).toContain('门的隐藏原文');
    for (const query of ['us key', 'RUS key', 'US keyboard', 'US_key', 'US key2']) {
      expect(select(card, query).dynamicSuffix).not.toContain('门的隐藏原文');
    }
  });

  it('matches punctuation literally and retains Tavern substring behavior for multiword keys', () => {
    const single = asset([{ keys: ['a+b'], content: '字面标点', extensions: { matchWholeWords: true } }]);
    expect(select(single, '(a+b)!').dynamicSuffix).toContain('字面标点');
    expect(select(single, 'aaab a+bc').dynamicSuffix).not.toContain('字面标点');
    const phrase = asset([{ key: ['red gate'], content: '多词短语', matchWholeWords: true }]);
    expect(select(phrase, 'tired gatekeeper').dynamicSuffix).toContain('多词短语');
  });

  it('keeps default Chinese substring matching and explicit ASCII boundary behavior', () => {
    expect(select(asset([{ keys: ['钟楼'], content: '钟楼原文' }]), '去旧钟楼看看').dynamicSuffix).toContain('钟楼原文');
    expect(select(asset([{ keys: ['钟楼'], content: '钟楼原文', match_whole_words: true }]), '去旧钟楼看看').dynamicSuffix).toContain('钟楼原文');
  });

  it('omits unknown selective logic and slash regex keywords with an explicit reason', () => {
    for (const unsupported of [
      { ...entry, selectiveLogic: 99 },
      { keys: ['/gate/i'], content: '门的隐藏原文' },
      { ...entry, secondary_keys: ['/key/'] },
    ]) {
      const card = asset([unsupported]), result = select(card, 'gate key /gate/i /key/');
      expect(result.dynamicSuffix).not.toContain('门的隐藏原文');
      expect(result.omitted[0].reason).toMatch(/逻辑|正则/);
      expect(cardCompatibility(card).warnings.join(' ')).toMatch(/逻辑|正则/);
    }
  });

  it.each([
    [true, 'gate'], [false, 'gate key'], [[], 'gate key'], [['3'], 'gate key lamp'], ['3', 'gate key lamp'],
    [{ toString: 'unknown', valueOf: 'unknown' }, 'gate key'],
  ])('reports malformed JSON logic %j without coercing it into a supported filter', (logic, query) => {
    const card = asset([{ ...entry, selectiveLogic: logic }]);
    expect(cardCompatibility(card).warnings.join(' ')).toContain('未知组合关键词逻辑');
    const result = select(card, String(query));
    expect(result.dynamicSuffix).not.toContain('门的隐藏原文');
    expect(result.omitted[0].reason).toContain('未知组合关键词逻辑');
  });

  it.each([{ selective: false }, { secondary_keys: [] }, { constant: true }])('ignores unused malformed logic for %j', override => {
    const card = asset([{ ...entry, ...override, selectiveLogic: { toString: 'unknown', valueOf: 'unknown' } }]);
    expect(cardCompatibility(card).warnings.join(' ')).not.toContain('未知组合关键词逻辑');
    const result = select(card, 'gate');
    expect(result.stablePrefix + result.dynamicSuffix).toContain('门的隐藏原文');
  });

  it('reserves optional budget for higher insertion order while preserving selected source order', () => {
    const card = asset([
      { keys: ['gate'], content: '低优先级😀' + 'L'.repeat(150), insertion_order: 10 },
      { keys: ['gate'], content: '高优先级😀' + 'H'.repeat(150), insertion_order: 100 },
    ]);
    const limited = select(card, 'gate', 450);
    expect(limited.dynamicSuffix).toContain('高优先级😀');
    expect(limited.dynamicSuffix).not.toContain('低优先级😀');
    expect(limited.omitted.find(e => e.pointer.endsWith('/0/content'))?.reason).toMatch(/预算/);
    const full = select(card, 'gate');
    expect(full.dynamicSuffix.indexOf('低优先级😀')).toBeLessThan(full.dynamicSuffix.indexOf('高优先级😀'));
  });

  it('keeps equal-priority selection deterministic across bindings at the exact Unicode boundary', () => {
    const first = asset([{ keys: ['gate'], content: '第一张😀原文' }]);
    const second = { ...asset([{ keys: ['gate'], content: '第二张😀原文' }]), id: 'b'.repeat(64) };
    const result = selectCardContext({ assets: [first, second], bindings: [
      { assetId: first.id, role: 'world', name: '世界', enabled: true }, { assetId: second.id, role: 'world', name: '世界', enabled: true },
    ], query: 'gate', sceneNpcs: [], playerName: '旅人', maxChars: Array.from(select(first, 'gate').stablePrefix + select(first, 'gate').dynamicSuffix).length });
    expect(result.dynamicSuffix).toContain('第一张😀原文'); expect(result.dynamicSuffix).not.toContain('第二张😀原文');
  });
});
