import { describe, expect, it } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { selectCardContext } from '@/lib/game/cards/selection';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { crc32 } from '@/lib/game/zip-writer';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const original = '甲\n  乙\\n{{char}}与{{user}}😀';
const source = () => ({ spec: 'chara_card_v2', spec_version: '2.0', data: {
  name: '林', description: original, personality: '谨慎', scenario: '门厅', first_mes: '<div>开场</div>',
  extensions: { author_extra: { untouched: 'e\u0301' } }, character_book: { entries: [
    { id: 0, keys: [], content: '世界规则\n  保留缩进', constant: true, enabled: true, insertion_order: 0 },
    { id: 1, keys: ['金箔'], content: '金箔的隐藏来历', enabled: true, insertion_order: 1 },
    { id: 2, keys: ['金箔'], content: '禁用资料', enabled: false },
  ] },
} });
const asset = () => ({ ...parseCardBytes(encode(source()), 'card.json'), id: 'a'.repeat(64), originalBytes: encode(source()), filename: 'card.json', createdAt: 1 });
const binding = { assetId: 'a'.repeat(64), role: 'world' as const, name: '林', enabled: true };

function png(documents: Record<string, unknown>) {
  const chunks = Object.entries(documents).map(([key, doc]) => {
    const payload = new TextEncoder().encode(`${key}\0${Buffer.from(JSON.stringify(doc)).toString('base64')}`);
    const body = new Uint8Array(4 + payload.length); body.set(new TextEncoder().encode('tEXt')); body.set(payload, 4);
    const chunk = new Uint8Array(payload.length + 12); const view = new DataView(chunk.buffer);
    view.setUint32(0, payload.length); chunk.set(body, 4); view.setUint32(chunk.length - 4, crc32(body)); return chunk;
  });
  const end = new Uint8Array(12); end.set(new TextEncoder().encode('IEND'), 4); new DataView(end.buffer).setUint32(8, crc32(end.slice(4, 8)));
  const bytes = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0) + 12);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); let offset = 8;
  for (const c of [...chunks, end]) { bytes.set(c, offset); offset += c.length; } return bytes;
}

describe('verbatim community cards', () => {
  it('preserves string formatting and unknown author fields', () => {
    const parsed = parseCardBytes(encode(source()), 'card.json');
    expect(parsed.document).toEqual(source());
    expect(parsed.data.description).toBe(original);
    expect(parsed.data.extensions).toEqual({ author_extra: { untouched: 'e\u0301' } });
  });
  it('prefers V3 PNG metadata and rejects corrupted CRC instead of falling back', () => {
    const v3 = { ...source(), spec: 'chara_card_v3', data: { ...source().data, name: '新名' } };
    const bytes = png({ chara: source(), ccv3: v3 });
    expect(parseCardBytes(bytes, 'card.png').name).toBe('新名');
    bytes[22] ^= 1;
    expect(() => parseCardBytes(bytes, 'card.png')).toThrow(/CRC/);
  });
  it('reads standalone world info without converting its entries object', () => {
    const document = { entries: { '7': { uid: 7, key: ['门'], content: '门的原文', disable: false, constant: true } }, extra: '保留' };
    const parsed = parseCardBytes(encode(document), '世界.json');
    expect(parsed.kind).toBe('worldbook'); expect(parsed.document).toEqual(document);
  });
  it('rejects ordinary world JSON masquerading as a card', () => {
    expect(() => parseCardBytes(encode({ name: '城', regions: {}, npcs: {} }), 'world.json')).toThrow(/卡片|世界书/);
  });
  it('selects constant and matching originals, preserving macros source', () => {
    const card = asset(); const result = selectCardContext({ assets: [card], bindings: [binding], query: '检查金箔', sceneNpcs: [], playerName: '我', initial: false });
    expect(result.stablePrefix).toContain('甲\n  乙\\n林与我😀');
    expect(result.stablePrefix).toContain('世界规则\n  保留缩进');
    expect(result.dynamicSuffix).toContain('金箔的隐藏来历');
    expect(result.dynamicSuffix).not.toContain('禁用资料');
    expect(result.dynamicSuffix).not.toContain('<div>开场</div>');
    expect(card.data.description).toBe(original);
    expect(result.selected.some(item => item.pointer.endsWith('/entries/1/content'))).toBe(true);
  });
  it('omits off-scene character core unless explicitly targeted', () => {
    const result = selectCardContext({ assets: [asset()], bindings: [{ ...binding, role: 'character' }], query: '开门', sceneNpcs: [], playerName: '我' });
    expect(result.stablePrefix + result.dynamicSuffix).not.toContain('保留缩进');
    const recent = selectCardContext({ assets: [asset()], bindings: [{ ...binding, role: 'character' }], query: '上一轮向林问话', targetInput: '开门', sceneNpcs: [], playerName: '我' });
    expect(recent.stablePrefix + recent.dynamicSuffix).not.toContain('保留缩进');
  });
  it('fails before generation if required originals exceed the budget', () => {
    expect(() => selectCardContext({ assets: [asset()], bindings: [binding], query: '', sceneNpcs: [], playerName: '我', maxChars: 5 })).toThrow(/预算/);
  });
  it('keeps a matching original whole at the Unicode budget boundary or omits it with a reason', () => {
    const input = { assets: [asset()], bindings: [binding], query: '金箔', sceneNpcs: [], playerName: '我' };
    const full = selectCardContext(input);
    const maxChars = Array.from(full.stablePrefix + '\n' + full.dynamicSuffix).length;
    expect(selectCardContext({ ...input, maxChars }).dynamicSuffix).toContain('金箔的隐藏来历');
    const limited = selectCardContext({ ...input, maxChars: maxChars - 1 });
    expect(limited.dynamicSuffix).not.toContain('金箔');
    expect(limited.stablePrefix).toContain('林与我😀');
    expect(limited.omitted.find(item => item.pointer.endsWith('/entries/1/content'))?.reason).toMatch(/整条省略/);
  });
  it('blocks template-dependent cards and missing assets instead of losing rules', () => {
    const card = asset(); card.data.description = '<% if (level > 70) { %>秘密<% } %>';
    expect(() => selectCardContext({ assets: [card], bindings: [binding], query: '', sceneNpcs: [], playerName: '我' })).toThrow(/模板/);
    expect(() => selectCardContext({ assets: [], bindings: [binding], query: '', sceneNpcs: [], playerName: '我' })).toThrow(/资源/);
  });
  it('creates a thin world referencing the asset without flattening the character', () => {
    const world = mountCardWorld({ asset: asset(), role: 'character' });
    expect(world.cardBindings?.[0].assetId).toBe('a'.repeat(64));
    expect(world.npcs['林']).not.toContain(original);
    expect(Object.values(world.regions)[0].scenes.card_start.npcs).toEqual(['林']);
  });
});
