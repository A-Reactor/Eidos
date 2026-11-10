import { historySummary, selectContextHistory, type CompressionPolicy, type RecentActionContext } from './history-context';
import { estimateTextTokens } from './prompt-budget';
import { promptTextHash } from './prompt-blocks';
import { stableRecordJSON } from './prompt-layout';

export type IdentifiedHistoryEntry = RecentActionContext & { actionId: string; sourceRevision: string };
export interface HistoryEpochPlan {
  id: string; rendererVersion: number;
  scope: { worldId: string; playthroughId: string; archiveScope: string };
  retained: Array<{ actionId: string; sourceRevision: string; mode: 'full' | 'summary' }>;
  through?: { actionId: string; sourceRevision: string };
  policy?: string;
}
export function identifyHistory(entries: RecentActionContext[]): IdentifiedHistoryEntry[] {
  return entries.map((entry,i) => {
    const source = stableRecordJSON([entry.playerInput,entry.summary,entry.aiResponse,entry.directorCues]);
    return { ...entry, actionId: entry.actionId ?? `legacy_${i}`,
      sourceRevision: entry.sourceRevision ?? `${source.length}:${promptTextHash(source)}:${reverseHash(source)}` };
  });
}
function reverseHash(text: string): string {
  let value = 2166136261;
  for (let i=text.length-1;i>=0;i--) value = Math.imul(value ^ text.charCodeAt(i),16777619);
  return (value >>> 0).toString(16);
}
function validPlan(value: HistoryEpochPlan): boolean {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  return record(value) && value.rendererVersion === 1 && record(value.scope)
    && ['worldId','playthroughId','archiveScope'].every(key => typeof value.scope[key as keyof HistoryEpochPlan['scope']] === 'string')
    && Array.isArray(value.retained) && value.retained.every(r => record(r) && typeof r.actionId === 'string' && typeof r.sourceRevision === 'string' && ['full','summary'].includes(r.mode))
    && (!value.through || record(value.through) && typeof value.through.actionId === 'string' && typeof value.through.sourceRevision === 'string');
}
const policyKey = (p: CompressionPolicy) => stableRecordJSON([p.windowTokens,p.lowerPercent,p.upperPercent,p.outputTokens]);
export function historyEpochPlanFor(entries: IdentifiedHistoryEntry[], history: RecentActionContext[], scope: HistoryEpochPlan['scope'], policy: CompressionPolicy): HistoryEpochPlan {
  const retained = history.map(h => ({ actionId: h.actionId!, sourceRevision: h.sourceRevision!, mode: h.aiResponse ? 'full' as const : 'summary' as const }));
  const last = entries.at(-1);
  const value = { rendererVersion: 1, scope, retained, policy: policyKey(policy), ...(last ? { through: { actionId: last.actionId, sourceRevision: last.sourceRevision } } : {}) };
  return { id: `history_${promptTextHash(stableRecordJSON(value))}`, ...value };
}
/** A plan is a projection of this ancestor list, never permission to fetch another branch. */
export function selectHistoryEpoch(input: { entries: IdentifiedHistoryEntry[]; previous?: HistoryEpochPlan | null; policy: CompressionPolicy; scope: HistoryEpochPlan['scope'] }) {
  const { entries, policy, scope } = input;
  const previous = input.previous && validPlan(input.previous) ? input.previous : undefined;
  let resetReason: string | undefined = input.previous && !previous ? 'invalid_plan' : undefined;
  let history: RecentActionContext[] = entries.map(e => ({ ...e }));
  if (previous) {
    if (previous.rendererVersion !== 1 || !Array.isArray(previous.retained)) resetReason = 'invalid_plan';
    else if (stableRecordJSON(previous.scope) !== stableRecordJSON(scope)) resetReason = 'scope_changed';
    else if (previous.policy !== policyKey(policy)) resetReason = 'policy_changed';
    else {
      const through = previous.through ? entries.findIndex(e => e.actionId === previous.through!.actionId) : -1;
      let lastIndex = -1;
      for (const retained of previous.retained) {
        const index = entries.findIndex(e => e.actionId === retained.actionId);
        if (index < 0 || index <= lastIndex || !['full','summary'].includes(retained.mode)) { resetReason = 'branch_changed'; break; }
        if (entries[index].sourceRevision !== retained.sourceRevision) { resetReason = 'source_changed'; break; }
        lastIndex = index;
      }
      if (!resetReason && previous.through && through < 0) resetReason = 'branch_changed';
      if (!resetReason && through >= 0 && entries[through].sourceRevision !== previous.through?.sourceRevision) resetReason = 'source_changed';
      if (!resetReason) {
        const retained = new Map(previous.retained.map(r => [r.actionId,r.mode]));
        history = entries.filter((e,i) => retained.has(e.actionId) || i > through).map(e => {
          const result = { ...e };
          if (retained.get(e.actionId) === 'summary') delete result.aiResponse;
          return result;
        });
      }
    }
  }
  const tokens = estimateTextTokens(historySummary(history)) + policy.baseTokens + policy.outputTokens;
  if (!previous || resetReason || policy.windowTokens && tokens > policy.windowTokens * policy.upperPercent / 100) {
    const selected = selectContextHistory(history, policy);
    history = selected.history;
    if (previous && !resetReason && selected.triggered) resetReason = 'budget';
  }
  return { plan: historyEpochPlanFor(entries,history,scope,policy), history, resetReason };
}
