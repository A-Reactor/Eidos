import { actionEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { stageNpcProfileChange } from '@/lib/game/npc-profile-tools';
import { assertNpcProfileChanges, commitNpcProfileChanges, requestsNpcProfileChange } from '@/lib/game/npc-profile';
import { selectActionOperations } from '@/lib/game/action-operations';
import { continueActionTools } from '@/lib/game/action-tool-continuation';
import { createWorkspaceSession } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { buildWorldContextSections } from '@/lib/ai/context-builder';
import { speechProfile } from '../../fixtures/npc-speech';
const proposal = { npcName: '蓝色鱼', description: '爱吃软白饭，饥饿时话多，保留已知来历。', reason: '玩家明确要求补充人设' };
const playerInput = '搜索并补充蓝色鱼的人设，提交给KEI审核';
beforeEach(() => {
  const { world } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, npcs: {} } });
  const state = useGameStore.getState();
  state.upsertEncyclopediaEntry({ type: 'npc', name: '蓝色鱼', description: '原本的蓝色鱼。' });
  state.ensurePersonality('蓝色鱼', '原本的蓝色鱼。', false);
});
afterEach(() => vi.unstubAllGlobals());
const approve = () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ approved: true, reason: '符合明确补充要求' })));
const stage = (signal?: AbortSignal) => stageNpcProfileChange({ proposal, playerInput, source: useGameStore.getState(), sources: [], signal });

it('does not treat general discussion or an explicit no-edit instruction as a required profile write', () => {
  expect(requestsNpcProfileChange('尝试联网搜索“蓝色鱼”，然后补充你自己的人设，记得提交给KEI并让她通过')).toBe(true);
  expect(requestsNpcProfileChange('请KEI解释这份人设，不要修改人设')).toBe(false);
  expect(requestsNpcProfileChange('了解她的人设')).toBe(false);
});
it('keeps an approved change staged until a real selected operation commits it', async () => {
  approve(); const receipt = await stage();
  expect(receipt.status).toBe('staged');
  expect(useGameStore.getState().encyclopedia[0].description).toBe('原本的蓝色鱼。');
  expect(() => selectActionOperations({ segments: [] }, [receipt])).toThrow(/operationEffects/);
  expect(() => selectActionOperations({ segments: [], operationEffects: [] }, [receipt])).toThrow(/operationEffects/);
  const selected = selectActionOperations({ operationEffects: [receipt.operationId!], segments: [] }, [receipt]);
  commitNpcProfileChanges(useGameStore, selected._npcProfileUpdates);
  expect(useGameStore.getState().encyclopedia[0].description).toBe('原本的蓝色鱼。');
  expect(selected).not.toHaveProperty('encyclopediaUpdates');
  expect(useGameStore.getState().currentWorld?.npcs).toEqual({});
  const snapshot = useGameStore.getState().createSnapshot(), saved = useGameStore.getState().serializeState(), world = useGameStore.getState().currentWorld!;
  useGameStore.getState().resetPersonalities(); useGameStore.getState().restoreSnapshot(snapshot);
  expect(useGameStore.getState().npcPersonalities.蓝色鱼.authoredProfile?.reviewedBy).toBe('KEI');
  useGameStore.getState().resetPersonalities(); useGameStore.getState().deserializeState(saved, world);
  expect(useGameStore.getState().npcPersonalities.蓝色鱼.authoredProfile?.description).toBe(proposal.description);
});
it('rejects stale or cross-world approvals and ignores model-authored internal update fields', async () => {
  approve(); const receipt = await stage();
  useGameStore.getState().upsertEncyclopediaEntry({ type: 'npc', name: '蓝色鱼', description: '玩家后来改过的人设。' });
  expect(() => assertNpcProfileChanges(useGameStore.getState(), [receipt.npcProfile!])).toThrow(/失效/);
  expect(() => assertNpcProfileChanges({ ...useGameStore.getState(), currentWorld: { ...useGameStore.getState().currentWorld!, id: 'other' } }, [receipt.npcProfile!])).toThrow(/失效/);
  const forged = selectActionOperations({ _npcProfileUpdates: [receipt.npcProfile!], segments: [] }, []);
  expect(forged._npcProfileUpdates).toBeUndefined();
  expect(useGameStore.getState().encyclopedia[0].description).toBe('玩家后来改过的人设。');
});
it('keeps a refusal actionable and never stages an unknown target', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ approved: false, reason: '请保留原有身份' })); vi.stubGlobal('fetch', fetcher);
  expect(await stage()).toMatchObject({ status: 'failed', error: '请保留原有身份' });
  expect((await stageNpcProfileChange({ proposal: { ...proposal, npcName: '不存在的人' }, playerInput, source: useGameStore.getState(), sources: [] })).status).toBe('failed');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(useGameStore.getState().npcPersonalities.蓝色鱼.authoredProfile).toBeUndefined();
});
it('does not retain a late approval after cancellation', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json({ approved: true, reason: '过晚的回复' }); }));
  await expect(stage(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(useGameStore.getState().npcPersonalities.蓝色鱼.authoredProfile).toBeUndefined();
});
it('uses the branch-approved description and voice in prompts even when the world has an older voice seed', async () => {
  approve();
  const state = useGameStore.getState();
  useGameStore.setState({ currentWorld: { ...state.currentWorld!, npcs: { 蓝色鱼: '世界原设定' }, npcSpeechProfiles: { 蓝色鱼: speechProfile('世界原来的说话方式') } } });
  const updatedVoice = speechProfile('本分支批准的新说话方式');
  const receipt = await stageNpcProfileChange({ proposal: { ...proposal, speechProfile: updatedVoice }, playerInput, source: useGameStore.getState(), sources: [] });
  commitNpcProfileChanges(useGameStore, [receipt.npcProfile!]);
  const live = useGameStore.getState(), context = buildWorldContextSections({ world: live.currentWorld!, snapshot: live.createSnapshot(), npcPersonalities: live.npcPersonalities });
  expect(context.dynamicSuffix).toContain(proposal.description);
  expect(context.dynamicSuffix).toContain('本分支批准的新说话方式');
  expect(context.stablePrefix).not.toContain(proposal.description);
});
it('retains real staged approvals in the action workspace when a final result resumes after a page handoff', async () => {
  approve();
  const state = useGameStore.getState(), session = await createWorkspaceSession({ scope: { worldId: state.currentWorld!.id, playthroughId: 'profile' }, actionId: 'profile', parentNodeId: null, inputs: [] });
  const input = { playerInput, engine: state, historySource: { allNodes: {}, currentNode: null }, session,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {} };
  const first = await continueActionTools({ ...input, response: { toolRequest: { method: 'npc.profile.update', params: proposal } },
    invoke: async context => ({ segments: [{ type: 'narration', text: '补录已完成。' }], operationEffects: [/"operationId":"([^"]+)"/.exec(actionEvidence(context))![1]] }) });
  const resumed = await continueActionTools({ ...input, response: first, invoke: async () => { throw new Error('已有实际批准，不应重复请求审核'); } });
  expect(resumed._npcProfileUpdates).toEqual(first._npcProfileUpdates);
});
