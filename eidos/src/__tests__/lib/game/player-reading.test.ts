import { describe, expect, it, vi } from 'vitest';
import { createWorldLineSlice } from '@/store/slices/worldline-slice';
import { getPresentedText, getPlayerVisibleText, getReadingPath, searchReadingPath } from '@/lib/game/player-reading';
import type { WorldLineNode } from '@/lib/game/types';

vi.mock('@/lib/game/storage', () => {
  const data = new Map();
  return { saveMeta: async (key: string, value: unknown) => data.set(key, structuredClone(value)), loadMeta: async (key: string) => data.get(key) ?? null };
});
export function node(id: string, parentId: string | null, extra: Partial<WorldLineNode> = {}): WorldLineNode {
  return { id, parentId, stepNumber: 1, playerInput: '询问船夫', aiResponse: '船夫说：明天见。\n\n隐藏结局', summary: '内部推断', snapshotHash: '', segmentHash: '', childIds: [], createdAt: 1, gameTime: { day: 1, hour: 8, minute: 0 }, sceneId: 'dock', sceneName: '渡口', dayNumber: 1, timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: ['秘密'], generationComplete: true, playerVisibleText: '船夫说：明天见。', ...extra };
}
const nodes = { root: node('root', null), a: node('a', 'root'), b: node('b', 'a'), sibling: node('sibling', 'root', { playerVisibleText: '另一分支的证词' }) };

describe('player reading boundary', () => {
  it('records the visible prefix in visual mode and the whole exposed paragraph in text mode', () => {
    const segments = [{ type: 'narration' as const, text: '风起。' }, { type: 'dialogue' as const, speaker: '船夫', text: '明天见，别迟到。' }];
    expect(getPresentedText(segments, 1, true, '明天', false)).toBe('风起。\n\n「船夫：明天');
    expect(getPresentedText(segments, 1, true, '明天', true)).toBe('风起。\n\n「船夫：明天见，别迟到。」');
    expect(getPresentedText(segments, 1, true, '上一段残留', false)).toBe('风起。');
  });
  it('searches only presented originals on the current ancestry, not predictions or sibling branches', () => {
    expect(getReadingPath(nodes, 'b').map(n => n.id)).toEqual(['root', 'a', 'b']);
    for (const query of ['隐藏结局', '秘密', '内部推断', '另一分支']) expect(searchReadingPath(nodes, 'b', query)).toEqual([]);
    expect(searchReadingPath(nodes, 'b', '渡口').map(n => n.id)).toEqual(['b', 'a', 'root']);
  });
  it('handles missing paths and cycles without exposing unrelated nodes', () => {
    expect(getReadingPath(nodes, 'missing')).toEqual([]);
    expect(getReadingPath({ a: node('a', 'b'), b: node('b', 'a') }, 'a')).toHaveLength(2);
  });
  it('fails closed for new unread nodes and interrupted legacy nodes while keeping complete old originals', () => {
    expect(getPlayerVisibleText(node('new', null, { playerVisibleText: '' }))).toBe('');
    expect(getPlayerVisibleText(node('old', null, { playerVisibleText: undefined }))).toBe('船夫说：明天见。\n\n隐藏结局');
    expect(getPlayerVisibleText(node('old', null, { playerVisibleText: undefined, generationComplete: false }))).toBe('');
  });
  it('persists source-bound excerpts without changing world text, and never shrinks previously read text', async () => {
    let state: any;
    const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = { ...createWorldLineSlice(set, () => state), allNodes: structuredClone(nodes), currentNode: nodes.b,
      worldLine: { id: 'wl_reader', worldId: 'world', playthroughId: 'pt', currentNodeId: 'b' } };
    state.setNodeReadText('b', '船夫说：明天见。\n\n隐藏结局');
    state.setNodeReadText('b', '船夫说：');
    expect(state.allNodes.b.playerVisibleText).toBe('船夫说：明天见。\n\n隐藏结局');
    state.addPlayerExcerpt('b', '伪造证据', '');
    expect(state.allNodes.b.playerExcerpts ?? []).toEqual([]);
    state.addPlayerExcerpt('b', '明天见。', '我还没有答应');
    const excerpt = state.allNodes.b.playerExcerpts[0];
    expect(excerpt.text).toBe('明天见。');
    expect(excerpt.note).toBe('我还没有答应');
    await state.persistWorldLineData();
    state.allNodes = {};
    await state.loadWorldLine('wl_reader');
    expect(state.allNodes.b.playerExcerpts[0]).toEqual(excerpt);
    state.removePlayerExcerpt('b', excerpt.id);
    expect(state.allNodes.b.playerExcerpts).toEqual([]);
    expect(state.allNodes.b.aiResponse).toBe('船夫说：明天见。\n\n隐藏结局');
  });
});
