import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendKeiReviewAudit, getKeiReviewAuditSnapshot } from '@/lib/ai/kei-review-audit';
import { buildExportPackage, collectExportData } from '@/lib/game/export-records';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { storePendingKeiApplication, takePendingKeiApplication } from '@/lib/game/stream-lifecycle';
import { callAi } from '@/lib/ai/client';
import { cancelKeiQueue, hasPendingKeiReviews, submitKeiReview } from '@/lib/ai/kei-review';
import { makeResponse, usage } from './kei-fixtures';

vi.mock('@/lib/ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
function origin(run: string, actionId = 'action') { return { worldId: world.id, playthroughId: run, worldLineId: 'line', archiveScope: 'ordinary', parentNodeId: 'parent', actionId }; }
function submit(run: string, response = makeResponse()) {
  submitKeiReview(response, world, snapshot, '', undefined, null, '', { origin: origin(run), settingsOverride: { aliceApiKey: 'test', keiApiKey: 'test' } });
}
afterEach(() => { cancelKeiQueue(); takePendingKeiApplication(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('KEI dispatch audit', () => {
  it('records the pending application and why a no-change action was skipped', () => {
    const o = origin('skip_run');
    storePendingKeiApplication({ origin: o, aliceResponse: makeResponse(), world, snapshot, validationContext: '' });
    const pending = takePendingKeiApplication({ currentWorld: world, currentPlaythroughId: 'skip_run', worldLine: { id: 'line' }, currentNode: { id: 'parent' }, history: [{ id: 'action' }] });
    expect(pending).not.toBeNull(); submit('skip_run');
    expect(getKeiReviewAuditSnapshot({ worldId: world.id, playthroughId: 'skip_run' }).entries.map(e => [e.phase, e.reason])).toEqual([
      ['pending', undefined], ['skipped', 'no_changes_between_periodic_reviews'],
    ]);
  });
  it('records an executed review from queueing to success', async () => {
    vi.mocked(callAi).mockResolvedValue({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 });
    submit('success_run', makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '守卫出示重要证据' } }));
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(getKeiReviewAuditSnapshot({ worldId: world.id, playthroughId: 'success_run' }).entries.map(e => e.phase)).toEqual(['queued', 'started', 'succeeded']);
    expect(getKeiReviewAuditSnapshot({ worldId: world.id, playthroughId: 'success_run' }).entries.at(-1))
      .toMatchObject({ mode: 'background', level: 'quality', durationMs: expect.any(Number), sequence: expect.any(Number) });
  });
  it('records timeout termination even when the provider does not finish', async () => {
    vi.useFakeTimers(); vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    submit('timeout_run', makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '守卫出示重要证据' } }));
    await vi.advanceTimersByTimeAsync(25000);
    expect(getKeiReviewAuditSnapshot({ worldId: world.id, playthroughId: 'timeout_run' }).entries.at(-1))
      .toMatchObject({ phase: 'failed', reason: 'timeout', durationMs: 25000 });
  });
  it('exports only the requested world, playthrough and archive and strips unknown fields', () => {
    const o = origin('export_run');
    appendKeiReviewAudit({ timestamp: 10, origin: { ...o, apiKey: 'PRIVATE_KEY' }, phase: 'queued', settingsOverride: { keiApiKey: 'PRIVATE_KEY' } } as never);
    appendKeiReviewAudit({ timestamp: 11, origin: { ...o, worldId: 'other' }, phase: 'queued' });
    appendKeiReviewAudit({ timestamp: 12, origin: { ...o, playthroughId: 'other' }, phase: 'queued' });
    appendKeiReviewAudit({ timestamp: 13, origin: { ...o, archiveScope: 'sandbox:002' }, phase: 'queued' });
    const audit = getKeiReviewAuditSnapshot({ worldId: world.id, playthroughId: 'export_run', archiveScope: 'ordinary' });
    expect(audit.entries).toHaveLength(1);
    expect(audit.sessionStartedAt).toBeTypeOf('number');
    const pkg = buildExportPackage(collectExportData(world, '测试者', []), { keiReviewAuditJson: JSON.stringify(audit) });
    const file = pkg.files.find(f => f.path === 'audits/kei-review-audit.json');
    expect(JSON.parse(file!.content).entries).toHaveLength(1);
    expect(file!.content).not.toContain('PRIVATE_KEY');
  });
  it('bounds the session trace and returns snapshots that cannot mutate the audit', () => {
    for (let i = 0; i < 205; i++) appendKeiReviewAudit({ timestamp: i, origin: origin('bounded_run', `action_${i}`), phase: 'skipped', reason: 'no_changes_between_periodic_reviews' });
    const scope = { worldId: world.id, playthroughId: 'bounded_run' };
    const audit = getKeiReviewAuditSnapshot(scope);
    expect(audit.entries).toHaveLength(200);
    expect(audit.entries[0].origin.actionId).toBe('action_5');
    audit.entries[0].origin.actionId = 'mutated';
    expect(getKeiReviewAuditSnapshot(scope).entries[0].origin.actionId).toBe('action_5');
  });
});
