// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi } from '@/lib/ai/client';
import { cancelKeiQueue } from '@/lib/ai/kei-review';
import { loadSettings, saveSettings } from '@/lib/game/settings';
import type { KeiReviewResult, DirectorFrame } from '@/lib/ai/types';
import type { ActionRecord, WorldLineNode } from '@/lib/game/types';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const initial = useGameStore.getInitialState();
const { world, snapshot } = buildRiftCityStartState();
const frame: DirectorFrame = { beatFunction: 'relief', tensionTarget: 'lower', narrativeFocus: [], revealBudget: { allowNewSecret: false, maxFactsToReveal: 0, forbiddenFacts: [] }, successCriteria: ['结束无内容追问'] };
function node(id: string, parentId: string | null): WorldLineNode { return { id, parentId, actionId: id, stepNumber: 1, playerInput: '问', aiResponse: '答', summary: '', snapshotHash: '', segmentHash: '', childIds: [], createdAt: 1, gameTime: snapshot.currentGameTime, sceneId: snapshot.currentSceneId, sceneName: '', dayNumber: 0, timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [], generationComplete: true }; }
function history(id: string): ActionRecord { return { id, timestamp: 1, gameTime: snapshot.currentGameTime, sceneId: snapshot.currentSceneId, sceneName: '', playerInput: '问', aiResponse: '答', summary: '', timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [], snapshot }; }
function advance(id: string) {
  const s = useGameStore.getState(); const next = node(id, s.currentNode!.id);
  useGameStore.setState({ currentNode: next, allNodes: { ...s.allNodes, [id]: next }, history: [...s.history, history(id)] });
}
function result(sequence = 1, extra: Partial<KeiReviewResult> = {}): KeiReviewResult { return {
  approved: true, corrections: '', directorFrame: frame, _reviewMode: 'background', _reviewSequence: sequence, _reviewLevel: 'quality', _reviewSceneId: snapshot.currentSceneId,
  _reviewOrigin: { worldId: world.id, playthroughId: useGameStore.getState().currentPlaythroughId, worldLineId: 'line', archiveScope: 'ordinary', parentNodeId: 'root', actionId: 'a' }, ...extra,
}; }
beforeEach(() => {
  cancelKeiQueue(); vi.mocked(callAi).mockReset(); localStorage.clear(); saveSettings({ ...loadSettings(), keiApiKey: 'test' });
  useGameStore.setState({ ...initial, currentWorld: world, currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId,
    worldLine: { id: 'line', worldId: world.id, playthroughId: '', rootNodeId: 'root', currentNodeId: 'a', allNodeIds: ['root', 'a'], branchCount: 1, totalSteps: 1, createdAt: 1, updatedAt: 1 },
    currentNode: node('a', 'root'), allNodes: { root: node('root', null), a: node('a', 'root') }, history: [history('a')], currentDirectorFrame: null });
});
afterEach(() => cancelKeiQueue());

import { stageChapterReview } from '@/lib/game/chapters/review';
import { acceptChapterAction, chapterBasis, createChapterState } from '@/lib/game/chapters/state';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { speculationStateKey } from '@/lib/ai/speculation';
import { openChapter } from './chapter-fixtures';
import { selectKeiReviewPlan } from '@/lib/ai/kei-review-policy';
import { makeResponse } from '../ai/kei-fixtures';
function install() {
  const plugin = parseGameplayPlugins([{ format: 'eidos-gameplay-plugin', version: 1, id: 'chapter-narrative', name: '篇章叙事', description: '篇章测试', tags: [], rules: [], prompts: { creation: '', action: '', review: '' } }]);
  const empty = createChapterState(world.id);
  const state = acceptChapterAction({ worldId: world.id, state: empty, actionId: 'a', input: '询问挂钟', sceneId: snapshot.currentSceneId, summary: '接受归还委托', segments: [{ type: 'narration', text: '你接过挂钟。' }], preparation: { basis: chapterBasis(world.id, empty), decision: openChapter() } });
  useGameStore.setState({ currentWorld: { ...world, gameplayPlugins: plugin }, chapterState: state });
  return result(1, { chapterDecision: { ...openChapter(), move: 'complete', chapter: undefined, reason: '有收束迹象', evidence: [{ actionId: 'a', segment: 0 }] }, _chapterBasis: chapterBasis(world.id, state) });
}
describe('chapter review proposals', () => {
  it('requests semantic editorial review without a fixed chapter turn counter', () => {
    install(); const s = useGameStore.getState();
    const response = makeResponse({ chapterSignal: { reason: 'departure', note: '玩家准备离城', segments: [0] } });
    expect(selectKeiReviewPlan(response, s.currentWorld!, false, s.createSnapshot())).toMatchObject({ mode: 'background', trigger: 'chapter_change' });
    expect(selectKeiReviewPlan(response, world, false, s.createSnapshot())).toBeNull();
  });
  it.each(['background', 'blocking'] as const)('keeps %s review as an uncommitted proposal and preserves paid candidates', mode => {
    const r = install(), s = useGameStore.getState();
    const key = speculationStateKey(s.currentWorld, s.createSnapshot(), null);
    expect(stageChapterReview(useGameStore, { ...r, _reviewMode: mode })).toBe(true);
    const after = useGameStore.getState();
    expect(after.chapterState?.pending?.decision.move).toBe('complete');
    expect(after.chapterState?.chapters[0].status).toBe('active');
    expect(after.chapterState?.revision).toBe(1);
    expect(speculationStateKey(after.currentWorld, after.createSnapshot(), null)).toBe(key);
  });
  it('keeps same-branch cross-scene advice available for revalidation after newer prose', () => {
    const r = install(); advance('b');
    useGameStore.setState({ currentSceneId: 'kitchen', chapterState: acceptChapterAction({ worldId: world.id, state: useGameStore.getState().chapterState, actionId: 'b', input: '留下吃饭', sceneId: 'kitchen', summary: '尚未离开', segments: [{ type: 'narration', text: '你留下帮忙做饭。' }] }) });
    expect(stageChapterReview(useGameStore, r)).toBe(true);
    expect(useGameStore.getState().chapterState?.experiences.at(-1)?.input).toBe('留下吃饭');
    expect(useGameStore.getState().chapterState?.pending?.basis.lastActionId).toBe('a');
  });
  it.each(['revision', 'branch', 'evidence', 'origin'] as const)('rejects %s mismatch', reason => {
    const r = install();
    if (reason === 'revision') r._chapterBasis!.revision = 0;
    if (reason === 'branch') { const sibling = node('sibling', 'root'); useGameStore.setState({ currentNode: sibling, allNodes: { ...useGameStore.getState().allNodes, sibling } }); }
    if (reason === 'evidence') r.chapterDecision!.evidence = [{ actionId: 'future', segment: 0 }];
    if (reason === 'origin') r._chapterBasis!.lastActionId = 'other';
    expect(stageChapterReview(useGameStore, r)).toBe(false);
    expect(useGameStore.getState().chapterState?.pending).toBeUndefined();
  });
});
