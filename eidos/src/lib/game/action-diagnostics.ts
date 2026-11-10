import type { ActionContextDiagnostics } from '@/lib/ai/action-context-diagnostics';
import type { TokenUsage } from '@/lib/ai/types';
import type { CardVariableUpdate } from './cards/variable-updates';
import { archiveScopeSessionValue } from './archive-scope';
import type { StreamRequestScope, StreamScopeSource } from './stream-lifecycle';
export interface ActionDiagnostic {
  id: string; scope: StreamRequestScope; timestamp: number; input: string;
  status: 'received' | 'accepted' | 'rejected' | 'failed' | 'discarded'; reason?: string;
  fileOutcome?: 'failed' | 'completed'; operationOutcome?: 'failed' | 'completed'; selectedFileEffects?: string[];
  operations?: import('./action-operations').ActionOperationReceipt[];
  rounds?: ActionDiagnosticRound[];
  publishedDocuments?: string[];
  context?: ActionContextDiagnostics; usage?: TokenUsage; variableUpdates?: CardVariableUpdate[]; pluginEvents?: unknown;
}
export interface ActionDiagnosticRound {
  index: number; callType: string; elapsedMs?: number; firstSegmentMs?: number;
  completed?: boolean; usage?: TokenUsage; context?: ActionContextDiagnostics;
  comparison?: { previousRequestId: string; previousRound: number; firstChangedBlockId?: string; unchangedPrefixCharsLowerBound: number };
}
/** The identity is the request's round, not its token totals: equal totals can be two paid calls. */
export function recordActionRound(scope: StreamRequestScope, input: string, round: ActionDiagnosticRound) {
  const previous = records.find(r => r.id === scope.requestId);
  const updated = { ...previous?.rounds?.find(r => r.index === round.index), ...Object.fromEntries(Object.entries(round).filter(([,value]) => value !== undefined)) } as ActionDiagnosticRound;
  const budget = updated.context?.budget ?? updated.usage?.promptBudget;
  if (updated.context || budget) {
    const { cards: _cards, ...context } = updated.context ?? {};
    updated.context = { ...context, ...(budget ? { budget } : {}) };
  }
  if (updated.usage) { const { promptBudget: _budget, ...usage } = updated.usage; updated.usage = usage; }
  const earlier = [...(previous?.rounds ?? [])].reverse().find(r => r.index < updated.index && r.context?.budget?.layout);
  const priorAction = earlier ? previous : [...records].reverse().find(r => r.id !== scope.requestId && r.scope.worldId === scope.worldId && r.scope.playthroughId === scope.playthroughId && r.scope.archiveScope === scope.archiveScope && r.scope.worldLineId === scope.worldLineId && r.rounds?.some(round => round.context?.budget?.layout));
  const prior = earlier ?? priorAction?.rounds?.at(-1);
  const spans = budget?.layout?.spans, priorSpans = prior?.context?.budget?.layout?.spans;
  if (spans && priorSpans && priorAction && prior) {
    let unchangedPrefixCharsLowerBound = 0, firstChangedBlockId: string | undefined;
    for (let i=0;i<spans.length;i++) {
      const a=spans[i], b=priorSpans[i];
      if (!b || a.id !== b.id || a.hash !== b.hash || a.start !== b.start) { firstChangedBlockId=a.id; break; }
      unchangedPrefixCharsLowerBound=a.end;
    }
    updated.comparison = { previousRequestId: priorAction.id, previousRound: prior.index, firstChangedBlockId, unchangedPrefixCharsLowerBound };
  }
  const rounds = [...(previous?.rounds ?? []).filter(r => r.index !== round.index), updated].sort((a,b) => a.index - b.index);
  recordActionDiagnostics(scope, { input, status: previous?.status ?? 'received', rounds });
}
let records: ActionDiagnostic[] = [];
const listeners = new Set<() => void>();
export const getActionDiagnostics = () => records;
export const subscribeActionDiagnostics = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish() { for (const fn of listeners) fn(); }
export function clearActionDiagnostics() { records = []; publish(); }
/** Session-only records: author secrets are neither auto-saved nor sent to another model. */
export function recordActionDiagnostics(scope: StreamRequestScope, detail: Omit<ActionDiagnostic, 'id' | 'scope' | 'timestamp'>) {
  const previous = records.find(r => r.id === scope.requestId);
  if (previous?.status === 'accepted' && detail.status === 'received') return;
  records = [...records.filter(r => r.id !== scope.requestId), { ...previous, ...detail, context: detail.context ?? previous?.context, usage: detail.usage ?? previous?.usage, id: scope.requestId, scope, timestamp: Date.now() }].slice(-8);
  publish();
}
export function selectActionDiagnostics(all: ActionDiagnostic[], source: StreamScopeSource): ActionDiagnostic[] {
  return all.filter(r => r.scope.worldId === source.currentWorld?.id && r.scope.playthroughId === (source.currentPlaythroughId ?? null)
    && r.scope.archiveScope === archiveScopeSessionValue(source) && r.scope.worldLineId === (source.worldLine?.id ?? null)).reverse();
}
