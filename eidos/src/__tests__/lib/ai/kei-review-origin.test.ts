import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi, subscribeKeiCorrection } from '@/lib/ai/client';
import { cancelKeiQueue, hasPendingKeiReviews, submitKeiReview } from '@/lib/ai/kei-review';
import type { KeiReviewResult } from '@/lib/ai/types';
import { makeResponse, usage } from './kei-fixtures';
import { processPlayerAction, setCurrentDirectorFrame } from '@/lib/ai/action-handler';

vi.mock('@/lib/ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
const origin = { worldId: world.id, playthroughId: 'run', worldLineId: 'line', archiveScope: 'ordinary', parentNodeId: 'parent', actionId: 'action' };
const settings = { aliceApiKey: 'alice-test', keiApiKey: 'kei-test' };
const response = makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '守卫不知道驾驶者是谁' } });
let received: KeiReviewResult[];
let unsubscribe: () => void;
beforeEach(() => {
  cancelKeiQueue(); vi.mocked(callAi).mockReset(); received = [];
  unsubscribe = subscribeKeiCorrection(result => received.push(result));
});
afterEach(() => { unsubscribe(); cancelKeiQueue(); setCurrentDirectorFrame(null); });
describe('KEI review provenance', () => {
  it('uses the snapshot frame rather than a module frame from another world', async () => {
    setCurrentDirectorFrame({ beatFunction: 'delay', tensionTarget: 'hold', narrativeFocus: [{ target: 'other_world', instruction: 'UNRELATED_WORLD_FRAME', visibility: 'overt', expiresInActions: 2 }], revealBudget: { allowNewSecret: false, maxFactsToReveal: 0, forbiddenFacts: [] }, successCriteria: [] });
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify(makeResponse()), usage, elapsedMs: 1 });
    await processPlayerAction({ playerInput: '观察', snapshot: { ...snapshot, lastDirectorFrame: null }, world, clientSettings: settings });
    expect(vi.mocked(callAi).mock.calls[0][0].systemPrompt).not.toContain('UNRELATED_WORLD_FRAME');
  });
  it('uses request provenance and explicit settings rather than model supplied provenance', async () => {
    vi.mocked(callAi).mockResolvedValue({ content: JSON.stringify({ approved: true, corrections: '', _reviewOrigin: { ...origin, worldId: 'forged' } }), usage, elapsedMs: 1 });
    submitKeiReview(response, world, snapshot, '', undefined, null, '', { origin, settingsOverride: settings });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]._reviewOrigin).toEqual(origin);
    expect(vi.mocked(callAi).mock.calls[0][0].settingsOverride).toMatchObject(settings);
  });
  it('discards a late review after its action stops being current', async () => {
    let finish!: (value: Awaited<ReturnType<typeof callAi>>) => void;
    let current = true;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    submitKeiReview(response, world, snapshot, '', undefined, null, '', { origin, settingsOverride: settings, isCurrent: () => current });
    current = false;
    finish({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 });
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(received).toEqual([]);
  });
});
