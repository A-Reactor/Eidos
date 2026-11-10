import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { makeResponse, usage } from './kei-fixtures';
import { selectKeiReviewPlan } from '@/lib/ai/kei-review-policy';
import { submitKeiReview, submitKeiStateVerification, keiQualityQueue, cancelKeiQueue, hasPendingKeiReviews, hasBlockingKeiReviews } from '@/lib/ai/kei-review';
import { isPipelineBusy } from '@/lib/game/stream-lifecycle';
import { callAi, subscribeKeiCorrection } from '@/lib/ai/client';
vi.mock('@/lib/ai/client', async original => ({ ...await original<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
const scopedWorld = { ...world, timeline: [{ ...world.timeline[0], id: 'timeline_test' }] };
beforeEach(() => { cancelKeiQueue(); vi.mocked(callAi).mockReset(); });
afterEach(() => { cancelKeiQueue(); });
describe('KEI review policy', () => {
  it('keeps routine additions, atmosphere and NPC reactions out of model review', () => {
    expect(selectKeiReviewPlan(makeResponse({ worldImpacts: ['两名 NPC 离开，气氛改变'], npcsReacted: ['甲', '乙'],
      encyclopediaUpdates: [{ name: '货车', type: 'item', description: '蓝色车身的一辆普通货车', knowledge: '停在门口' }], criticalFactsDiscovered: ['车辆是蓝色'],
      relationshipUpdates: [{ npcName: '守卫', affinityDelta: 2 }] }), scopedWorld, false)).toBeNull();
  });
  it('uses periodic background review even when ALICE does not request it', () => {
    expect(selectKeiReviewPlan(makeResponse(), scopedWorld, true)).toMatchObject({ mode: 'background', trigger: 'periodic' });
  });
  it('honors an explicit ALICE narrative request without blocking', () => {
    expect(selectKeiReviewPlan(makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '这次询问无法得到更多可确认内容' } }), scopedWorld, false)).toMatchObject({ mode: 'background', trigger: 'alice_request' });
  });
  it('blocks a known timeline deviation', () => {
    expect(selectKeiReviewPlan(makeResponse({ timelineDeviation: { eventId: 'timeline_test', newOutcome: '事件被玩家阻止' } }), scopedWorld, false)).toMatchObject({ mode: 'blocking', trigger: 'timeline_change' });
  });
  it('ignores legacy ending requests and empty evidence instead of blocking play', () => {
    expect(selectKeiReviewPlan(makeResponse({ reviewRequest: { reason: 'ending_candidate', endingId: 'invented', evidence: '旧结局申请' } as unknown as NonNullable<import('@/lib/ai/types').AIGameResponse['reviewRequest']> }), scopedWorld, false)?.mode).not.toBe('blocking');
    expect(selectKeiReviewPlan(makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '' } }), scopedWorld, false)).toBeNull();
    expect(selectKeiReviewPlan(makeResponse({ timelineDeviation: { eventId: 'invented', newOutcome: '随意改写' } }), scopedWorld, false)?.mode).not.toBe('blocking');
  });
  it('lets ordinary play proceed while a background provider is still pending', () => {
    vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    submitKeiReview(makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '相同问题重复三次' } }), world, snapshot, '', undefined, null, '', { settingsOverride: { keiApiKey: 'test' } });
    expect(hasPendingKeiReviews()).toBe(true);
    expect(hasBlockingKeiReviews()).toBe(false);
    expect(isPipelineBusy()).toBe(false);
  });
  it('stamps the actual background mode over forged model metadata', async () => {
    vi.mocked(callAi).mockResolvedValue({ content: '{"approved":true,"corrections":"","_reviewMode":"blocking","_reviewSequence":-1}', usage, elapsedMs: 1 });
    let result: unknown;
    const off = subscribeKeiCorrection(r => { result = r; });
    submitKeiReview(makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '相同问题重复三次' } }), world, snapshot, '', undefined, null, '', { settingsOverride: { keiApiKey: 'test' } });
    await vi.waitFor(() => expect(result).toMatchObject({ _reviewMode: 'background' }));
    expect((result as { _reviewSequence: number })._reviewSequence).toBeGreaterThan(0);
    off();
  });
  it('rechecks a state proposal against the latest snapshot without counting a new action', async () => {
    let finish!: (value: Awaited<ReturnType<typeof callAi>>) => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const latest = { ...snapshot, currentGameTime: { day: 0, hour: 9, minute: 15 }, criticalFacts: [{ text: '车主已经出示了证件', importanceScore: 50, referencedCount: 0, lastReferencedAt: null }] };
    submitKeiStateVerification(world, latest, '车主已经出示了证件', {
      settingsOverride: { keiApiKey: 'test' }, stateProposal: { correctedUpdates: { criticalFactsDiscovered: ['车主身份未知'] } },
    });
    expect(hasBlockingKeiReviews()).toBe(true);
    expect(keiQualityQueue.actionCount).toBe(0);
    const request = vi.mocked(callAi).mock.calls[0];
    const material = JSON.parse(request[0].userMessage.slice(request[0].userMessage.indexOf('{')));
    expect(material.stateVerification.currentSnapshot.currentGameTime).toEqual(latest.currentGameTime);
    expect(material.stateVerification.currentSnapshot.criticalFacts[0].text).toBe('车主已经出示了证件');
    expect(material.stateVerification.proposal.correctedUpdates.criticalFactsDiscovered).toEqual(['车主身份未知']);
    expect(request[0].systemPrompt).toContain('未验证提案');
    finish({ content: '{"approved":true,"corrections":"无需修正"}', usage, elapsedMs: 1 });
    await vi.waitFor(() => expect(hasBlockingKeiReviews()).toBe(false));
  });
});
