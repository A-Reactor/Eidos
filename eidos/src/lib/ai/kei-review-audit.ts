import type { KeiReviewOrigin } from './types';
import type { ReviewLevel } from './kei-review';
import type { KeiReviewMode } from './types';
import type { KeiReviewTrigger } from './kei-review-policy';
import { logGameRuntimeEvent } from '@/lib/game/runtime-log';

export interface KeiReviewAuditEntry {
  timestamp: number;
  origin: KeiReviewOrigin;
  phase: 'pending' | 'skipped' | 'queued' | 'started' | 'succeeded' | 'applied' | 'failed' | 'discarded' | 'staged' | 'activated';
  level?: ReviewLevel;
  mode?: KeiReviewMode;
  trigger?: KeiReviewTrigger;
  durationMs?: number;
  sequence?: number;
  reason?: 'no_changes_between_periodic_reviews' | 'missing_credentials' | 'duplicate_action' |
    'invalid_action' | 'stale_action' | 'queue_full' | 'queue_expired' | 'replaced' |
    'cancelled' | 'timeout' | 'provider_error' | 'application_error' | 'no_result' | 'newer_review' | 'context_changed' | 'state_recheck' | 'review_disabled';
}

const sessionStartedAt = Date.now();
const entries: KeiReviewAuditEntry[] = [];
let droppedEntries = 0;

export function appendKeiReviewAudit(entry: KeiReviewAuditEntry): void {
  // Whitelist fields so a settings object or model metadata cannot enter the export by accident.
  const o = entry.origin;
  entries.push({
    timestamp: entry.timestamp,
    origin: { worldId: o.worldId, playthroughId: o.playthroughId, worldLineId: o.worldLineId,
      archiveScope: o.archiveScope, parentNodeId: o.parentNodeId, actionId: o.actionId },
    phase: entry.phase, level: entry.level, mode: entry.mode, trigger: entry.trigger, reason: entry.reason,
    durationMs: entry.durationMs, sequence: entry.sequence,
  });
  logGameRuntimeEvent({ engine: 'KEI', mode: entry.mode ?? 'review', phase: entry.phase,
    timestamp: entry.timestamp, durationMs: entry.durationMs, level: entry.level, trigger: entry.trigger,
    reason: entry.reason, actionId: o.actionId, worldId: o.worldId ?? undefined, playthroughId: o.playthroughId,
    requestId: entry.sequence === undefined ? undefined : `review-${entry.sequence}` });
  if (entries.length > 200) { entries.shift(); droppedEntries++; }
}

export function getKeiReviewAuditSnapshot(scope: { worldId: string; playthroughId: string | null; archiveScope?: string }) {
  return {
    version: 'kei_review_audit_v1', sessionStartedAt, exportedAt: Date.now(),
    coverage: 'current_runtime_session', droppedEntries,
    entries: entries.filter(e => e.origin.worldId === scope.worldId && e.origin.playthroughId === scope.playthroughId &&
      (scope.archiveScope === undefined || e.origin.archiveScope === scope.archiveScope))
      .map(e => ({ ...e, origin: { ...e.origin } })),
  };
}
