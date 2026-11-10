// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { rewindPolicy, rewindTargets, rewindAnchors, resolveGameRewindTarget, buildRewindMemory, rewindMemoryPrompt } from '@/lib/game/rewind';
import { applyGameRewindRequest } from '@/lib/game/game-rewind-request';
import { retrieveLongMemoryContext } from '@/lib/ai/long-memory-retrieval';
import { buildWorldContext } from '@/lib/ai/context-builder';
import { loadBlob } from '@/lib/game/cas-storage';
import * as storage from '@/lib/game/storage';
import * as cas from '@/lib/game/cas-storage';
import { snapshotForModel } from '@/lib/game/plugins/model-manifest';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import { evaluateGameplayEvents } from '@/lib/game/plugins/runtime';
import type { WorldLineNode, WorldSnapshot } from '@/lib/game/types';
let anchor: string;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameModeConfig: { rewind: { anchorLabels: ['醒来的房间'], requires: { abilityReady: true } } } }, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot(snapshot);
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  await step('醒来', '你在房间醒来。', '[LABEL:醒来的房间] 醒来');
  anchor = useGameStore.getState().currentNode!.id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function step(input: string, text: string, summary = text, impacts: string[] = []) {
  const s = useGameStore.getState(), time = { ...s.gameTime };
  const action = { id: crypto.randomUUID(), timestamp: Date.now(), playerInput: input, aiResponse: text, summary, sceneId: s.currentSceneId,
    sceneName: s.currentScene?.name ?? '广场', gameTime: time, timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: impacts, availableActions: [], snapshot: null };
  const node = await s.addActionNode(action, s.createSnapshot(), [{ type: 'narration', text }]);
  // This helper simulates a completed read; generation alone leaves player-visible text empty.
  useGameStore.getState().setNodeReadText(node.id, text);
  return node;
}
const game = (to = anchor) => useGameStore.getState().backtrackToNode(to, { sourceNodeId: useGameStore.getState().currentNode!.id, reason: '本轮已确认失败，能力发动' });

it.each(['第2步', '节点2', '2号节点', '第 2 个节点'])('restores %s by its step on the current path, preserving engine permission checks', async reference => {
  const target = await step('读信', '信上写着银月。');
  expect(target.stepNumber).toBe(2);
  await step('走开', '你走到门外。');
  const request = await step('回到第二步', '你尝试发动能力。', '回溯', [`[BACKTRACK:${reference}] 已满足作品能力条件`]);
  await expect(applyGameRewindRequest(useGameStore, request)).rejects.toThrow(/发动条件/);
  expect(useGameStore.getState().currentNode?.id).toBe(request.id);
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  expect(await applyGameRewindRequest(useGameStore, request)).toBe(true);
  expect(useGameStore.getState().currentNode?.parentId).toBe(target.id);
});

it('binds previous to the player-input origin rather than to the newly persisted request node', async () => {
  const target = await step('读信', '你看过了信。');
  const origin = await step('走开', '你走到门外。');
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const request = await step('回到上一节点', '你尝试发动能力。', '回溯', ['[BACKTRACK:上一节点] 已满足能力条件']);
  expect(request.parentId).toBe(origin.id);
  expect(await applyGameRewindRequest(useGameStore, request)).toBe(true);
  expect(useGameStore.getState().currentNode?.parentId).toBe(target.id);
  expect(useGameStore.getState().rewindMemory?.last.to).toBe(target.id);
});

it('does not select a same-number node from the abandoned future after a rewind', async () => {
  const old = await step('旧分支', '旧未来的信息。');
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  await game();
  const arrival = useGameStore.getState().currentNode!;
  expect(arrival.stepNumber).toBe(old.stepNumber);
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  await step('新的当前经历', '这一次没有重演旧事。');
  const request = await step('回到节点2', '尝试发动。', '回溯', ['[BACKTRACK:节点2] 条件成立']);
  await expect(game(old.id)).rejects.toThrow(/过去节点/);
  expect(useGameStore.getState().currentNode?.id).toBe(request.id);
  expect(await applyGameRewindRequest(useGameStore, request)).toBe(true);
  expect(useGameStore.getState().currentNode?.parentId).toBe(arrival.id);
  expect(useGameStore.getState().currentNode?.parentId).not.toBe(old.id);
});

it('rejects a previous-node reference with no snapshot instead of skipping back to another ancestor', async () => {
  const target = await step('读信', '信的原文。');
  await step('走开', '到门口。');
  useGameStore.setState(s => ({ worldFlags: { abilityReady: true }, allNodes: { ...s.allNodes, [target.id]: { ...target, snapshotHash: '' } } }));
  const request = await step('回到上一节点', '尝试发动。', '回溯', ['[BACKTRACK:上一节点] 条件成立']);
  await expect(applyGameRewindRequest(useGameStore, request)).rejects.toThrow(/不存在|已保存/);
  expect(useGameStore.getState().currentNode?.id).toBe(request.id);
  expect(useGameStore.getState().rewindMemory).toBeNull();
});

it('returns candidate metadata for an ambiguous step without restoring either candidate', async () => {
  const first = await step('第一次调查', '第一次的正文。');
  const second = await step('再次调查', '第二次的正文。');
  useGameStore.setState(s => ({ worldFlags: { abilityReady: true }, allNodes: { ...s.allNodes, [second.id]: { ...second, stepNumber: first.stepNumber } } }));
  const request = await step('回到节点2', '尝试发动。', '回溯', ['[BACKTRACK:节点2] 条件成立']);
  await expect(applyGameRewindRequest(useGameStore, request)).rejects.toThrow(/不唯一/);
  const live = useGameStore.getState();
  expect(live.currentNode?.id).toBe(request.id);
  expect(live.currentNode?.rewindFailure?.reason).toContain(first.id);
  expect(live.currentNode?.rewindFailure?.reason).toContain(second.id);
  expect(live.rewindMemory).toBeNull();
});

it('accepts permission and executes a real rewind in the same action without carrying future flags back', async () => {
  const s = useGameStore.getState();
  const world = { ...s.currentWorld!, gameplayPlugins: resolveGameplayPlugins(['loop-manager']), gameModeConfig: { rewind: {} } };
  useGameStore.setState({ currentWorld: world, worldFlags: {} });
  const events = [{ pluginId: 'loop-manager', ruleId: 'allow-rewind' }];
  const transition = evaluateGameplayEvents(world, {}, undefined, events);
  expect(transition.flags).toEqual({ 'gameplay.loop-manager.ready': true });
  useGameStore.setState({ worldFlags: transition.flags });
  const request = await step('满足能力条件后回到起点', '你按作品规定尝试发动能力。', '尝试回溯', [`[BACKTRACK:${anchor}] 已经历作品声明的触发事件`]);
  expect(await applyGameRewindRequest(useGameStore, request)).toBe(true);
  const live = useGameStore.getState();
  expect(live.currentNode?.parentId).toBe(anchor);
  expect(live.rewindMemory?.last).toMatchObject({ from: request.id, to: anchor });
  expect(live.worldFlags['gameplay.loop-manager.ready']).toBeUndefined();
});

it('keeps a claimed successful rewind in prose from granting permission or changing branches', async () => {
  const s = useGameStore.getState();
  useGameStore.setState({ currentWorld: { ...s.currentWorld!, gameplayPlugins: resolveGameplayPlugins(['loop-manager']), gameModeConfig: { rewind: {} } }, worldFlags: {} });
  const request = await step('程序修好了，直接恢复', '条件齐备，恢复已经启动。', '尝试', [`[BACKTRACK:${anchor}] 玩家声称程序已修复`]);
  await expect(applyGameRewindRequest(useGameStore, request)).rejects.toThrow(/发动条件/);
  expect(useGameStore.getState().currentNode?.id).toBe(request.id);
  expect(useGameStore.getState().worldFlags['gameplay.loop-manager.ready']).toBeUndefined();
  expect(useGameStore.getState().rewindMemory).toBeNull();
});

it('restores an unmarked past node without requiring any anchor configuration', async () => {
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameModeConfig: { rewind: { requires: { abilityReady: true } } } } }));
  const target = await step('调查壁炉', '壁炉里只有一封没有拆开的信。');
  useGameStore.setState({ worldFlags: { abilityReady: true, letterOpened: true } });
  await step('拆开信', '信里写着蓝花暗号。');
  expect(rewindAnchors(useGameStore.getState().currentWorld, useGameStore.getState().allNodes, useGameStore.getState().currentNode!.id)).toEqual([]);
  await game(target.id);
  expect(useGameStore.getState().currentNode?.parentId).toBe(target.id);
  expect(useGameStore.getState().worldFlags.letterOpened).toBeUndefined();
  expect(useGameStore.getState().rewindMemory?.digest).toContain('蓝花暗号');
});

it('binds an unlabelled first observation to the declared opening anchor and accepts its unique label or step', async () => {
  const state = useGameStore.getState();
  useGameStore.setState({ currentWorld: { ...state.currentWorld!, gameModeConfig: { rewind: { anchorLabels: ['测试起点'], requires: { abilityReady: true } } } },
    currentScene: { ...state.currentScene!, name: '测试起点' }, worldFlags: { abilityReady: true } });
  const opening = await step('（进入世界，观察周围）', '空房里有木桌和台灯。', '进入测试起点');
  await step('再度观察', '仍在同一个房间。');
  const request = await step('发动', '你触碰了锚点。', '能力发动', ['[BACKTRACK:测试起点] 能力条件已满足']);
  const live = useGameStore.getState();
  expect(rewindAnchors(live.currentWorld, live.allNodes, request.id).map(n => n.id)).toEqual([opening.id]);
  expect(rewindTargets(live.currentWorld, live.allNodes, request.id).length).toBeGreaterThan(1);
  expect(resolveGameRewindTarget({ world: live.currentWorld, nodes: live.allNodes, currentId: request.id, reference: String(opening.stepNumber) })).toBe(opening.id);
  expect(await applyGameRewindRequest(useGameStore, request)).toBe(true);
  expect(useGameStore.getState().currentNode?.parentId).toBe(opening.id);
  expect(useGameStore.getState().rewindMemory?.last.to).toBe(opening.id);
});

it('reports failed engine execution to later model context without inventing anchors or changing progress', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const request = await step('回到不存在的地方', '试图发动。', '请求', ['[BACKTRACK:不存在的地方] 发动']);
  await expect(applyGameRewindRequest(useGameStore, request)).rejects.toThrow(/不存在/);
  expect(useGameStore.getState().currentNode?.id).toBe(request.id);
  await step('诊断', '你仍在原处。');
  const state = useGameStore.getState();
  const prompt = buildWorldContext({ world: state.currentWorld!, snapshot: state.createSnapshot(), worldLineSummary: state.getWorldLineSummary() });
  expect(prompt).toContain('最近一次回溯未执行');
  expect(prompt).toContain('不是操作凭证');
  const exported = await state.exportWorldLine(state.worldLine!.rootNodeId);
  expect(exported.nodes.find(n => n.id === request.id)?.rewindFailure?.target).toBe('不存在的地方');
});

it('keeps marks as locating hints and rejects ambiguous labels', async () => {
  await step('另一个锚点', '另一个允许的时刻。', '[LABEL:醒来的房间] 锚点');
  await step('走开', '继续。');
  const state = useGameStore.getState();
  expect(() => resolveGameRewindTarget({ world: state.currentWorld, nodes: state.allNodes, currentId: state.currentNode!.id, reference: '醒来的房间' })).toThrow(/不唯一/);
  const targets = rewindAnchors(state.currentWorld, state.allNodes, state.currentNode!.id);
  expect(targets).toHaveLength(2);
  expect(resolveGameRewindTarget({ world: state.currentWorld, nodes: state.allNodes, currentId: state.currentNode!.id, reference: anchor })).toBe(anchor);
  useGameStore.setState({ worldFlags: { abilityReady: false } });
  await expect(game('醒来的房间')).rejects.toThrow();
});

it('keeps recall read-only, rejects manual restore and checks the game condition and real past target', async () => {
  const failed = await step('摸索', '你发现了铜钥匙。');
  await expect(useGameStore.getState().backtrackToNode(anchor)).rejects.toThrow(/游戏判断/);
  await expect(game()).rejects.toThrow(/发动条件/);
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  await expect(game(failed.id)).rejects.toThrow(/过去节点/);
  await expect(game('missing')).rejects.toThrow(/不存在/);
  expect(useGameStore.getState().currentNode?.id).toBe(failed.id);
});
it('creates a saved arrival with old-future memory, restores NPC/resources and leaves both originals intact', async () => {
  const past = useGameStore.getState().allNodes[anchor];
  useGameStore.setState({ worldFlags: { abilityReady: true, doorOpen: true }, npcStates: { 船夫: '已离开' } });
  const failed = await step('问清暗号', '船夫低声说：暗号是银月，北岸的桥将在黎明坍塌。');
  await game();
  const live = useGameStore.getState(), arrival = live.currentNode!;
  expect(arrival.id).not.toBe(anchor); expect(arrival.parentId).toBe(anchor);
  expect(live.worldFlags.doorOpen).toBeUndefined(); expect(live.npcStates.船夫).toBeUndefined();
  expect(live.rewindMemory?.digest).toContain('银月'); expect(live.rewindMemory?.sourceNodeIds).toContain(failed.id);
  expect(live.rewindMemory?.count).toBe(1);
  expect(live.allNodes[anchor].snapshotHash).toBe(past.snapshotHash);
  expect(live.allNodes[failed.id].aiResponse).toContain('银月');
  expect((await loadBlob(arrival.snapshotHash) as WorldSnapshot).rewindMemory).toEqual(live.rewindMemory);
  expect(live.serializeState().rewindMemory).toEqual(live.rewindMemory);
  const exported = await live.exportWorldLine(useGameStore.getState().worldLine!.rootNodeId);
  expect(exported.snapshots[arrival.snapshotHash].rewindMemory?.digest).toContain('银月');
  const save = live.serializeState(), memory = live.rewindMemory;
  useGameStore.setState({ rewindMemory: null });
  useGameStore.getState().deserializeState(save, live.currentWorld!);
  expect(useGameStore.getState().rewindMemory).toEqual(memory);
  expect(snapshotForModel(live.createSnapshot()).rewindMemory?.sourceNodeIds).toEqual([]);
});
it('accumulates a second loop and retrieves an exact detail from remembered branches only', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const first = await step('询问银月', '船夫低声说：银月暗号对应北岸仓库。'); await game();
  const remembered = useGameStore.getState().rewindMemory!;
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  await step('读信', '信里写着：明日带红伞。'); await game();
  const s = useGameStore.getState();
  expect(s.rewindMemory?.count).toBe(2); expect(s.rewindMemory?.digest).toContain('银月'); expect(s.rewindMemory?.digest).toContain('红伞');
  const without = retrieveLongMemoryContext({ playerInput: '回忆上次银月暗号内容是什么', allNodes: s.allNodes, currentNodeId: s.currentNode!.id });
  const withMemory = retrieveLongMemoryContext({ playerInput: '回忆上次银月暗号内容是什么', allNodes: s.allNodes, currentNodeId: s.currentNode!.id, rememberedNodeIds: remembered.sourceNodeIds });
  expect(without.entries).toEqual([]); expect(withMemory.entries.some(e => e.nodeId === first.id && e.excerpt.includes('北岸仓库'))).toBe(true);
  await expect(game(first.id)).rejects.toThrow(/发动条件|过去节点/);
});
it('rejects a delayed old request and a failed disk write leaves the live source unchanged', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const first = await step('失败', '门在你身后关闭。');
  await step('继续', '你仍在门外。');
  await expect(useGameStore.getState().backtrackToNode(anchor, { sourceNodeId: first.id, reason: '迟到的请求' })).rejects.toThrow(/过期/);
  const current = useGameStore.getState().currentNode;
  vi.spyOn(storage, 'saveMeta').mockRejectedValueOnce(new Error('disk full'));
  await expect(game()).rejects.toThrow('disk full');
  expect(useGameStore.getState().currentNode).toBe(current); expect(useGameStore.getState().rewindMemory).toBeNull();
});
it('only executes accepted current game requests with a reason, not a cutaway or stale node', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const cutaway = await step('旁观', '另一个房间的密码是蓝花。', '[旁观剧情，主角未知] 蓝花秘密', [`[BACKTRACK:${anchor}] 死亡`]);
  expect(await applyGameRewindRequest(useGameStore, cutaway)).toBe(false);
  const current = await step('失败', '你落入陷阱。', '陷阱', [`[BACKTRACK:${anchor}] 能力在失败时发动`]);
  expect(await applyGameRewindRequest(useGameStore, cutaway)).toBe(false);
  expect(await applyGameRewindRequest(useGameStore, current)).toBe(true);
  expect(useGameStore.getState().rewindMemory?.digest).not.toContain('蓝花');
  expect(useGameStore.getState().rewindMemory?.sourceNodeIds).not.toContain(cutaway.id);
});
it('blocks cached branch restoration and history deletion in ability worlds', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } });
  const child = await step('旧路', '旧路的内容'); await game();
  expect(await useGameStore.getState().tryMatchChildNode('旧路')).toBeNull();
  await expect(useGameStore.getState().deleteSubtree(child.id)).rejects.toThrow(/完整经历/);
});
it('compresses the entire interval, bounds the digest and never supplies unrelated sibling futures', () => {
  const base = useGameStore.getState().currentNode!, nodes: Record<string, WorldLineNode> = { [anchor]: base };
  let previous = anchor;
  for (let i = 0; i < 40; i++) { const id = `m${i}`; nodes[id] = { ...base, id, parentId: previous, stepNumber: i + 2, summary: `第${i}次走访`, playerInput: `调查${i}`, aiResponse: `开头${i}。${'行走的细节。'.repeat(30)}结尾${i}。` }; previous = id; }
  const memory = buildRewindMemory({ nodes, from: previous, to: anchor, reason: '失败', policy: { ...rewindPolicy(useGameStore.getState().currentWorld)!, maxChars: 2000 } });
  expect(memory.sourceNodeIds).toHaveLength(40); expect(memory.digest.length).toBeLessThanOrEqual(2000);
  expect(memory.digest).toContain('调查0'); expect(memory.digest).toContain('调查39');
  const prompt = buildWorldContext({ world: useGameStore.getState().currentWorld!, snapshot: { ...useGameStore.getState().createSnapshot(), rewindMemory: memory } });
  expect(prompt).toContain('旧未来'); expect(prompt).toContain('BACKTRACK');
  expect(rewindMemoryPrompt(memory)).toContain('其他人物');
});
it('keeps ordinary world backtracking compatible and restores old saves without memory', async () => {
  const source = await step('普通行动', '普通正文');
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameModeConfig: undefined }, rewindMemory: null }));
  await useGameStore.getState().backtrackToNode(anchor);
  expect(useGameStore.getState().currentNode?.id).toBe(anchor);
  await useGameStore.getState().backtrackToNode(source.id);
  expect(useGameStore.getState().rewindMemory).toBeNull();
});

it('rechecks same-node permission changes after asynchronous snapshot reads', async () => {
  useGameStore.setState({ worldFlags: { abilityReady: true } }); await step('失败', '能力尚在窗口内。');
  let finish!: (value: unknown) => void;
  const snapshot = await cas.loadBlob(useGameStore.getState().allNodes[anchor].snapshotHash), current = useGameStore.getState().currentNode;
  vi.spyOn(cas, 'loadBlob').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = game();
  useGameStore.setState({ worldFlags: { abilityReady: false } }); finish(snapshot);
  await expect(pending).rejects.toThrow(/发动条件/);
  expect(useGameStore.getState().currentNode).toBe(current);
  expect(useGameStore.getState().rewindMemory).toBeNull();
});
it.each([{ enabled: false }, { requires: { abilityReady: 'yes' } }])('does not weaken restrictions for disabled or malformed config %j', async config => {
  await step('失败', '这是一次失败。');
  useGameStore.setState(s => ({ currentWorld: { ...s.currentWorld!, gameModeConfig: { rewind: { anchorLabels: ['醒来的房间'], ...config } } }, worldFlags: { abilityReady: true } }));
  await expect(game()).rejects.toThrow(/关闭|无效/);
});
