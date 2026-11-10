import { expect, it, vi } from 'vitest';
import { readHistory, parseHistoryReadRequest, type HistoryReadSource } from '@/lib/game/history-reader';
import { continueHistoryRead } from '@/lib/game/history-continuation';
import type { WorldLineNode } from '@/lib/game/types';
const node = (id: string, parentId: string | null, text: string): WorldLineNode => ({ id, parentId, childIds: [], stepNumber: 2, playerInput: '调查', aiResponse: text, playerVisibleText: text,
  summary: '', worldImpacts: [], gameTime: { day: 1, hour: 8, minute: 0 }, sceneId: 'room', sceneName: '房间', dayNumber: 1, createdAt: 1,
  timeSpent: { day: 0, hour: 0, minute: 1 }, snapshotHash: 'saved', segmentHash: '', generationComplete: true });
function source(): HistoryReadSource {
  const first = node('first', null, '开始。' + '无关细节。'.repeat(3000) + '窗外第三声钟响时，银钥匙掉进壁炉。');
  const current = node('current', 'first', '你离开了房间。');
  return { allNodes: { first, current }, currentNode: current };
}
function page(s: HistoryReadSource, nodeId: string, offset = 0) {
  const result = readHistory(s, { nodeId, offset });
  if (!('text' in result)) throw new Error(result.error);
  return result;
}
it('searches beyond automatic excerpts, returns real IDs and pages the exact original text without changing it', () => {
  const s = source(), original = structuredClone(s);
  const result = readHistory(s, { query: '银钥匙' });
  expect(result.matches?.[0]).toMatchObject({ nodeId: 'first', gameTime: { hour: 8 } });
  expect(result.matches?.[0].excerpt).toContain('第三声钟响');
  const first = page(s, 'first');
  expect(first.nextOffset).toBe(12000);
  const last = page(s, 'first', first.nextOffset!);
  expect(last.nextOffset).toBeNull();
  expect(first.text! + last.text!).toBe(s.allNodes.first.aiResponse);
  expect(s).toEqual(original);
});
it('exposes retained memories but not unrelated branches, reader-only secrets or unrevealed prose', () => {
  const s = source();
  s.allNodes.old = node('old', 'first', '上一轮船夫交出了蓝花。');
  s.allNodes.sibling = node('sibling', 'first', '未走道路的秘密。');
  s.allNodes.secret = { ...node('secret', 'first', '旁观密码。'), summary: '[旁观剧情，主角未知] 秘密' };
  s.allNodes.current = s.currentNode = { ...s.currentNode!, parentId: 'secret', aiResponse: '可见文字。尚未读到的秘密。', playerVisibleText: '可见文字。' };
  s.rewindMemory = { sourceNodeIds: ['old'] };
  expect(page(s, 'old').text).toContain('蓝花');
  for (const id of ['sibling', 'secret', 'missing']) expect(readHistory(s, { nodeId: id }).error).toBeTruthy();
  expect(readHistory(s, { query: '尚未读到' }).totalMatches).toBe(0);
  expect(page(s, 'current').text).toBe('可见文字。');
});
it.each([null, {}, { query: 42 }, { nodeId: 'a', query: 'b' }, { nodeId: 'a', offset: -1 }, { nodeId: 'a', offset: 1.5 }])('rejects malformed read request %j', value => {
  expect(() => parseHistoryReadRequest(value)).toThrow();
});
it('continues search and original-text reads before returning a single final action', async () => {
  const s = source(), onReadResponse = vi.fn();
  const search = { historyRequest: { query: '银钥匙' }, worldImpacts: ['不得执行的中间影响'] };
  const page = { historyRequest: { nodeId: 'first', offset: 12000 } };
  const final = { segments: [{ type: 'narration' as const, text: '能力在钟声之后发动。' }], worldImpacts: ['[BACKTRACK:first] 条件已满足'] };
  const invoke = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(final);
  expect(await continueHistoryRead({ response: search, source: s, isCurrent: () => true, onReadResponse, invoke })).toBe(final);
  expect(invoke.mock.calls[0][0]).toContain('第三声钟响');
  expect(invoke.mock.calls[1][0]).toContain('nextOffset');
  expect(invoke.mock.calls[1][0]).toContain('银钥匙掉进壁炉');
  expect(invoke.mock.calls[1][0]).not.toContain('不得执行的中间影响');
  expect(onReadResponse.mock.calls.map(c => c[0])).toEqual([search, page]);
});
it('returns an honest candidate after bounded duplicate reads and accounts for every response', async () => {
  const response = { historyRequest: { nodeId: 'first' } }, onReadResponse = vi.fn();
  const invoke = vi.fn().mockResolvedValue(response);
  const final = await continueHistoryRead({ response, source: source(), isCurrent: () => true, onReadResponse, invoke });
  expect(final.fileOutcome).toBe('failed');
  expect(invoke.mock.calls.length).toBeLessThanOrEqual(10); expect(onReadResponse.mock.calls.length).toBe(invoke.mock.calls.length + 1);
});
it('discards a late final response after progress changes, while accounting for its usage', async () => {
  let current = true;
  const response = { historyRequest: { query: '钟响' } }, final = { segments: [], _tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, model: 'alice' as const } };
  const onReadResponse = vi.fn();
  await expect(continueHistoryRead({ response, source: source(), isCurrent: () => current, onReadResponse,
    invoke: async () => { current = false; return final; } })).rejects.toThrow('进度已变化');
  expect(onReadResponse.mock.calls.map(c => c[0])).toEqual([response, final]);
});

it('browses and pages the historical index without needing a guessed keyword', () => {
  const s = source();
  for (let i = 0; i < 20; i++) {
    const n = { ...node(`n${i}`, s.currentNode!.id, `内容${i}`), createdAt: i + 2 };
    s.allNodes[n.id] = n; s.currentNode = n;
  }
  const first = readHistory(s, parseHistoryReadRequest({ query: '' }));
  expect(first.matches).toHaveLength(8); expect(first.nextOffset).toBe(8);
  expect(first.matches?.[0]).toMatchObject({ nodeId: 'n19', parentId: 'n18' });
  const second = readHistory(s, { query: '', offset: first.nextOffset! });
  expect(second.matches?.[0].nodeId).not.toBe(first.matches?.[0].nodeId);
});

it.each(['第2步', '节点2', '2号节点', '第 2 个节点', '２'])('locates %s on the current path without searching for those words in prose', target => {
  const s = source();
  s.allNodes.first.stepNumber = 2;
  s.currentNode!.stepNumber = 3;
  s.allNodes.old = { ...node('old', 'first', '旧未来的同号内容'), stepNumber: 2 };
  s.rewindMemory = { sourceNodeIds: ['old'] };
  const original = structuredClone(s);
  const result = readHistory(s, parseHistoryReadRequest({ target }));
  expect(result).toMatchObject({ nodeId: 'first', stepNumber: 2, text: s.allNodes.first.aiResponse.slice(0, 12000), nextOffset: 12000 });
  expect(readHistory(s, parseHistoryReadRequest({ target, offset: 12000 }))).toMatchObject({ nodeId: 'first', nextOffset: null });
  expect(s).toEqual(original);
});

it('resolves the previous node from the current request origin and does not skip an unread parent', () => {
  const s = source();
  expect(readHistory(s, parseHistoryReadRequest({ target: '上一节点' }))).toMatchObject({ nodeId: 'first' });
  s.allNodes.first.playerVisibleText = '';
  expect(readHistory(s, parseHistoryReadRequest({ target: '上一节点' })).error).toMatch(/没有找到/);
});

it('returns bounded ambiguity candidates without choosing a node or exposing unread prose', () => {
  const s = source(); // Both nodes deliberately have stepNumber 2.
  const result = readHistory(s, parseHistoryReadRequest({ target: '节点2' }));
  expect(result).toMatchObject({ requiresChoice: true, totalMatches: 2 });
  expect(result.candidates?.map(n => n.nodeId)).toEqual(['first', 'current']);
  expect(result.text).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('银钥匙掉进壁炉');
});

it('does not use a retained or unvisited branch as a numbered target on the current path', () => {
  const s = source();
  s.allNodes.old = { ...node('old', 'first', '上一轮看到的数字'), stepNumber: 99 };
  s.allNodes.sibling = { ...node('sibling', 'first', '未走旁支的秘密'), stepNumber: 99 };
  s.rewindMemory = { sourceNodeIds: ['old'] };
  const result = readHistory(s, parseHistoryReadRequest({ target: '99号节点' }));
  expect(result.error).toMatch(/没有找到/);
  expect(result.nodeId).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('未走旁支');
  expect(readHistory(s, { nodeId: 'old' })).toMatchObject({ text: '上一轮看到的数字', onCurrentPath: false });
});

it('caps ambiguity results and can resume from a chosen real ID without committing an intermediate request', async () => {
  const s = source();
  for (let i = 0; i < 10; i++) {
    const next = node(`duplicate-${i}`, s.currentNode!.id, `正文${i}`);
    s.allNodes[next.id] = next; s.currentNode = next;
  }
  const result = readHistory(s, { target: '节点2' });
  expect(result.totalMatches).toBe(12);
  expect(result.candidates).toHaveLength(8);
  const original = structuredClone(s), final = { segments: [{ type: 'narration' as const, text: '尝试发动。' }], worldImpacts: ['[BACKTRACK:first] 能力条件成立'] };
  const invoke = vi.fn().mockResolvedValueOnce({ historyRequest: { nodeId: 'first' } }).mockResolvedValueOnce(final);
  expect(await continueHistoryRead({ response: { historyRequest: { target: '节点2' } }, source: s, isCurrent: () => true, onReadResponse: vi.fn(), invoke })).toBe(final);
  expect(invoke.mock.calls[0][0]).toContain('requiresChoice');
  expect(invoke.mock.calls[1][0]).toContain('nodeId');
  expect(s).toEqual(original);
});

it.each([{ target: '' }, { target: 2 }, { target: '节点2', query: '' }, { target: '节点2', nodeId: 'first' }, { target: '节点2', offset: -1 }])('rejects malformed target request %j', value => {
  expect(() => parseHistoryReadRequest(value)).toThrow();
});

it('can reread the original page after the tool context compacts it', async () => {
  const s = source();
  const original = '首段标记' + '正文'.repeat(45000);
  s.allNodes.first.aiResponse = s.allNodes.first.playerVisibleText = original;
  const read = (offset: number) => ({ historyRequest: { nodeId: 'first', offset } });
  const pending = [12000, 24000, 36000, 48000, 60000, 0];
  let feedback = '';
  const result = await continueHistoryRead({ response: read(0), source: s, isCurrent: () => true, onReadResponse() {},
    invoke: async context => {
      feedback = context;
      const offset = pending.shift();
      return offset === undefined ? { segments: [{ type: 'narration', text: '已读。' }] } : read(offset);
    } });
  expect(feedback.split('首段标记')).toHaveLength(2);
  expect(feedback).not.toContain('重复相同工具请求');
  expect(result.segments?.[0].text).toBe('已读。');
});
