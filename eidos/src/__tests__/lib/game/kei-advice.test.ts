// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { stageKeiAdvice, activateKeiAdvice, activateKeiPromptAdvice, submitKeiStateVerificationIfNeeded, noteKeiReviewApplied } from '@/lib/game/kei-advice';
import { isKeiReviewOnCurrentBranch } from '@/lib/game/stream-lifecycle';
import { callAi } from '@/lib/ai/client';
import { cancelKeiQueue, hasBlockingKeiReviews, keiQualityQueue } from '@/lib/ai/kei-review';
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
describe('future KEI advice', () => {
  it.each(['generation', 'acceptance'] as const)('lets quality review explicitly withdraw the old frame at the next %s boundary', boundary => {
    useGameStore.getState().setDirectorFrame(frame);
    expect(stageKeiAdvice(useGameStore, result(1, { directorFrame: null }))).toBe(true);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
    if (boundary === 'generation') expect(activateKeiPromptAdvice(useGameStore)).toBe(true);
    else { advance('b'); expect(activateKeiAdvice(useGameStore)).toBe(true); }
    expect(useGameStore.getState().createSnapshot().lastDirectorFrame).toBeNull();
    advance('c'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
  });
  it('retains the current frame when review omits guidance instead of withdrawing it', () => {
    useGameStore.getState().setDirectorFrame(frame);
    stageKeiAdvice(useGameStore, result(1, { directorFrame: undefined }));
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
  });
  it('keeps causal review from withdrawing quality guidance', () => {
    useGameStore.getState().setDirectorFrame(frame);
    stageKeiAdvice(useGameStore, result(1, { _reviewLevel: 'causal', directorFrame: null }));
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
  });
  it('leaves guidance active until model revision even when a legacy action span has elapsed', () => {
    const legacyFrame = { ...frame, narrativeFocus: [{ target: '守卫', instruction: '沿既有线索寻找司机', visibility: 'overt' as const, expiresInActions: 1 }] };
    stageKeiAdvice(useGameStore, result(1, { directorFrame: legacyFrame }));
    activateKeiPromptAdvice(useGameStore);
    for (const id of ['b', 'c', 'd', 'e']) { advance(id); activateKeiAdvice(useGameStore); }
    expect(useGameStore.getState().currentDirectorFrame).toEqual(legacyFrame);
  });
  it('loads ready prompt guidance before the next generation without accepting another action or changing facts', () => {
    stageKeiAdvice(useGameStore, result(1, { approved: false, correctedUpdates: { criticalFactsDiscovered: ['待核实事实'] },
      npcBehaviorUpdates: [{ npcName: '守卫', currentActivity: '回到岗位', currentMood: '平静', interactingWith: [] }] }));
    expect(activateKeiPromptAdvice(useGameStore)).toBe(true);
    expect(useGameStore.getState().createSnapshot().lastDirectorFrame).toEqual(frame);
    expect(useGameStore.getState().history).toHaveLength(1);
    expect(useGameStore.getState().criticalFacts).toEqual(initial.criticalFacts);
    expect(useGameStore.getState().npcBehaviors['守卫']).toBeUndefined();
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(true);
  });
  it('does not reload consumed prompt guidance when the next action is accepted', () => {
    stageKeiAdvice(useGameStore, result());
    expect(activateKeiPromptAdvice(useGameStore)).toBe(true);
    const followingFrame = { ...frame, beatFunction: 'payoff' as const };
    useGameStore.getState().setDirectorFrame(followingFrame);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(followingFrame);
  });
  it.each(['world', 'run', 'archive', 'scene', 'sibling', 'lag', 'disabled'] as const)('revalidates ready prompt guidance after %s changes', change => {
    stageKeiAdvice(useGameStore, result());
    if (change === 'world') useGameStore.setState({ currentWorld: { ...world, id: 'other' } });
    if (change === 'run') useGameStore.setState({ currentPlaythroughId: 'other' });
    if (change === 'archive') useGameStore.setState({ sandboxMode: true, sandboxDossierId: 'other' });
    if (change === 'scene') useGameStore.setState({ currentSceneId: 'other' });
    if (change === 'sibling') useGameStore.setState({ currentNode: node('sibling', 'root'), allNodes: { ...useGameStore.getState().allNodes, sibling: node('sibling', 'root') } });
    if (change === 'lag') { advance('b'); advance('c'); advance('d'); }
    if (change === 'disabled') saveSettings({ ...loadSettings(), enableContentReview: false });
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
  });
  it('keeps causal replies from replacing ready quality guidance', () => {
    stageKeiAdvice(useGameStore, result(1, { _reviewLevel: 'causal' }));
    expect(activateKeiPromptAdvice(useGameStore)).toBe(false);
    stageKeiAdvice(useGameStore, result());
    expect(activateKeiPromptAdvice(useGameStore)).toBe(true);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(frame);
  });
  it('stages same-branch late advice and enables it only when a new action is accepted', () => {
    advance('b');
    expect(isKeiReviewOnCurrentBranch(result()._reviewOrigin!, useGameStore.getState())).toBe(true);
    expect(stageKeiAdvice(useGameStore, result())).toBe(true);
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
    // Rereading the same node must not consume the pending frame.
    expect(activateKeiAdvice(useGameStore)).toBe(false);
    advance('c'); expect(activateKeiAdvice(useGameStore)).toBe(true);
    expect(useGameStore.getState().createSnapshot().lastDirectorFrame).toEqual(frame);
    expect(activateKeiAdvice(useGameStore)).toBe(false);
  });
  it.each(['world', 'run', 'archive', 'scene', 'sibling', 'lag'] as const)('rejects %s context changes', change => {
    const r = result();
    if (change === 'world') useGameStore.setState({ currentWorld: { ...world, id: 'other' } });
    if (change === 'run') useGameStore.setState({ currentPlaythroughId: 'other' });
    if (change === 'archive') useGameStore.setState({ sandboxMode: true, sandboxDossierId: 'other' });
    if (change === 'scene') useGameStore.setState({ currentSceneId: 'other' });
    if (change === 'sibling') useGameStore.setState({ currentNode: node('sibling', 'root'), allNodes: { ...useGameStore.getState().allNodes, sibling: node('sibling', 'root') } });
    if (change === 'lag') { advance('b'); advance('c'); advance('d'); }
    expect(stageKeiAdvice(useGameStore, r)).toBe(false);
    expect(useGameStore.getState().currentDirectorFrame).toBeNull();
  });
  it('revalidates staged advice after moving to another scene', () => {
    expect(stageKeiAdvice(useGameStore, result())).toBe(true);
    advance('b'); useGameStore.setState({ currentSceneId: 'other' });
    expect(activateKeiAdvice(useGameStore)).toBe(false);
  });
  it('keeps newer program sequences ahead of late quality and causal results', () => {
    const newer = { ...frame, beatFunction: 'recognition' as const };
    stageKeiAdvice(useGameStore, result(2, { directorFrame: newer }));
    expect(stageKeiAdvice(useGameStore, result(1))).toBe(false);
    stageKeiAdvice(useGameStore, result(2, { _reviewLevel: 'causal', directorFrame: frame }));
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().currentDirectorFrame).toEqual(newer);
    noteKeiReviewApplied(useGameStore, result(3, { _reviewMode: 'blocking' }));
    expect(stageKeiAdvice(useGameStore, result(2))).toBe(false);
  });
  it('rechecks old facts on the latest input boundary without immediately applying them', () => {
    stageKeiAdvice(useGameStore, result(1, { approved: false, correctedUpdates: { criticalFactsDiscovered: ['旧提案'] } }));
    expect(useGameStore.getState().criticalFacts.some(f => f.text === '旧提案')).toBe(false);
    advance('b'); useGameStore.getState().addCriticalFact('新行动已确认车主身份');
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(true);
    expect(hasBlockingKeiReviews()).toBe(true); expect(keiQualityQueue.actionCount).toBe(0);
    const request = vi.mocked(callAi).mock.calls[0];
    const material = JSON.parse(request[0].userMessage.slice(request[0].userMessage.indexOf('{')));
    expect(material.stateVerification.currentSnapshot.criticalFacts.some((f: { text: string }) => f.text === '新行动已确认车主身份')).toBe(true);
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(false);
  });
  it('does not turn an invented background ending into a blocking checkpoint', () => {
    stageKeiAdvice(useGameStore, result(1, { triggeredEnding: { id: 'invented_ending', narrative: '结局' } } as unknown as Partial<KeiReviewResult>));
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(false);
    expect(hasBlockingKeiReviews()).toBe(false); expect(callAi).not.toHaveBeenCalled();
  });
  it('ignores retired achievement-only corrections from an old in-flight review', () => {
    useGameStore.setState({ phase: 'playing' });
    const legacy = { approved: false, correctedUpdates: { achievementsSuggested: [{ id: 'legacy', title: '旧奖励', description: '过时字段' }] } } as unknown as Partial<KeiReviewResult>;
    stageKeiAdvice(useGameStore, result(1, legacy));
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(false);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState()).not.toHaveProperty('achievements');
    expect(callAi).not.toHaveBeenCalled();
  });
  it.each([false, true])('merges complementary state proposals regardless of order, causalFirst=%s', causalFirst => {
    const q = result(1, { approved: false, correctedUpdates: { criticalFactsDiscovered: ['事实修正'] } });
    const c = result(1, { _reviewLevel: 'causal', projectionVerifications: [{ rippleId: 'r', status: 'fulfilled', note: '已发生' }] });
    for (const r of causalFirst ? [c, q] : [q, c]) stageKeiAdvice(useGameStore, r);
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    submitKeiStateVerificationIfNeeded(useGameStore);
    const body = vi.mocked(callAi).mock.calls[0][0].userMessage; const proposal = JSON.parse(body.slice(body.indexOf('{'))).stateVerification.proposal;
    expect(proposal.correctedUpdates.criticalFactsDiscovered).toEqual(['事实修正']);
    expect(proposal.projectionVerifications[0].rippleId).toBe('r');
  });
  it('enables untouched NPC behavior at the next acceptance', () => {
    stageKeiAdvice(useGameStore, result(1, { npcBehaviorUpdates: [{ npcName: '守卫', currentActivity: '回到岗位', currentMood: '平静', interactingWith: [] }] }));
    expect(submitKeiStateVerificationIfNeeded(useGameStore)).toBe(false);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().npcBehaviors['守卫'].currentActivity).toBe('回到岗位');
  });
  it.each([false, true])('keeps complementary causal projections after unchanged blocking review, causalFirst=%s', causalFirst => {
    const c = result(1, { _reviewLevel: 'causal', causalProjections: [{ id: 'r', triggerAction: '阻止事故', projectedOutcome: '道路恢复通行', confidence: 0.8,
      estimatedTime: { day: 0, hour: 9, minute: 0 }, involvedNpcs: [], involvedScenes: [], status: 'pending', createdAt: 1, resolvedAt: null, resolutionNote: '' }] });
    const q = result(1, { _reviewMode: 'blocking' });
    if (causalFirst) stageKeiAdvice(useGameStore, c);
    noteKeiReviewApplied(useGameStore, q, false);
    if (!causalFirst) expect(stageKeiAdvice(useGameStore, c)).toBe(true);
    advance('b'); activateKeiAdvice(useGameStore);
    expect(useGameStore.getState().causalProjections.flatMap(p => p.rippleEffects).some(r => r.projectedOutcome === '道路恢复通行')).toBe(true);
  });
});

it('captures a late director note at the actual next input without altering an old node or adding an action', () => {
  advance('b'); advance('c');
  const old = JSON.stringify(useGameStore.getState().allNodes);
  expect(stageKeiAdvice(useGameStore, result())).toBe(true);
  activateKeiPromptAdvice(useGameStore);
  const snapshot = useGameStore.getState().createSnapshot();
  expect(snapshot.directorCueCandidate).toMatchObject({ afterNodeId:'c', origin:{ actionId:'a' }, frame });
  expect(JSON.stringify(useGameStore.getState().allNodes)).toBe(old);
  expect(useGameStore.getState().history).toHaveLength(3);
  expect(useGameStore.getState().createSnapshot().directorCueCandidate).toEqual(snapshot.directorCueCandidate);
  useGameStore.setState({ history:[...useGameStore.getState().history,{...history('d'),directorCues:[snapshot.directorCueCandidate!]}] });
  expect(useGameStore.getState().createSnapshot().directorCueCandidate).toBeNull();
});
