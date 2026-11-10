import { estimateTextTokens } from './prompt-budget';
import { renderDirectorCue, type DirectorCue } from '@/lib/game/director-cues';

export interface RecentActionContext { playerInput: string; summary: string; aiResponse?: string; directorCues?: DirectorCue[]; actionId?: string; sourceRevision?: string }
export interface CompressionPolicy { windowTokens?: number; baseTokens: number; outputTokens: number; lowerPercent: number; upperPercent: number }
export const historyText = (entry: RecentActionContext) => `${entry.directorCues?.map(renderDirectorCue).join('') ?? ''}- 玩家：${entry.playerInput} → ${entry.summary}${entry.aiResponse ? `\n该次已接受正文：\n${entry.aiResponse}` : ''}`;
export const historySummary = (entries: RecentActionContext[]) => entries.length ? `\n## 最近行动记录\n${entries.map(historyText).join('\n')}` : '';

/** Replaying token-sized batches preserves the gap between trigger and target without mutable cross-branch memory. */
export function selectContextHistory(input: RecentActionContext[], policy: CompressionPolicy) {
  const history = input.map(entry => ({ ...entry }));
  if (!policy.windowTokens) return result(history, 0, input.length, false);
  const allowance = (percent: number) => Math.max(0, Math.floor(policy.windowTokens! * percent / 100) - policy.baseTokens - policy.outputTokens - estimateTextTokens('\n## 最近行动记录\n'));
  const lower = allowance(Math.min(policy.lowerPercent, policy.upperPercent)), upper = allowance(policy.upperPercent);
  const weights = history.map(entry => estimateTextTokens(historyText(entry) + '\n'));
  let start = 0, nextFull = 0, tokens = 0, triggered = false;
  for (let end = 0; end < history.length; end++) {
    tokens += weights[end];
    if (tokens <= upper) continue;
    triggered = true;
    while (tokens > lower && nextFull <= end) {
      const index = nextFull++;
      if (index < start || !history[index].aiResponse || !history[index].summary.trim()) continue;
      delete history[index].aiResponse;
      const reduced = estimateTextTokens(historyText(history[index]) + '\n');
      tokens -= weights[index] - reduced; weights[index] = reduced;
    }
    // A missing summary is never fabricated. Discard only a whole transient record if it still cannot fit.
    while (tokens > lower && start <= end) tokens -= weights[start++];
  }
  return result(history.slice(start), start, input.length, triggered);
}
function result(history: RecentActionContext[], omitted: number, provided: number, triggered: boolean) {
  const full = history.filter(entry => Boolean(entry.aiResponse)).length;
  return { history, provided, retained: history.length, omitted, full, compressed: history.length - full, triggered };
}
