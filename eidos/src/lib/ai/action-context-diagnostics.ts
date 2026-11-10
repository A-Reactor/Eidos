import { identifyHistory, selectHistoryEpoch, historyEpochPlanFor, type HistoryEpochPlan } from './history-epoch';
import type { CardActionContext } from '@/lib/game/cards/types';
import { composeSystemPrompt, type AiPromptSections } from './prompt-layout';
import { resolveAiRoleConfig } from './providers/config';
import { loadSettings, normalizeSettings } from '@/lib/game/settings';
import { ContextBudgetError, preparePromptBudget, estimateTextTokens, type PromptBudgetReport } from './prompt-budget';
import { getModelContextWindow } from './context-usage';
import { aliceUserInstructions } from './user-instructions';
import { historySummary, type RecentActionContext } from './history-context';
export type { RecentActionContext } from './history-context';
export interface ActionContextDiagnostics {
  historyEpoch?: { id: string; resetReason?: string };
  chapters?: { status: 'prepared' | 'reused' | 'invalid' | 'unavailable' | 'disabled' };
  cards?: CardActionContext; budget?: PromptBudgetReport;
  history?: { provided: number; retained: number; omitted: number };
  compression?: { compressed: number; full: number; lowerPercent: number; upperPercent: number };
}
export function contextCompressionPolicy(settings?: Record<string, unknown> | null, baseTokens = 0, outputTokens = 8000) {
  const current = normalizeSettings({ ...loadSettings(), ...settings });
  const config = resolveAiRoleConfig('alice', current);
  return { windowTokens: config.contextWindowTokens || getModelContextWindow(config), baseTokens, outputTokens,
    lowerPercent: current.contextCompressionLowerPercent, upperPercent: current.contextCompressionUpperPercent };
}
/** Preflight transport history by token size; the server rechecks the actual complete prompt. */
export function recentActionsForModel(history: Array<RecentActionContext & { id?: string; sourceResponse?: string }>, includeProse = true, previous?: HistoryEpochPlan | null): RecentActionContext[] {
  const entries = identifyHistory(history.map(h => ({ playerInput: h.playerInput, summary: h.summary,
    actionId: h.actionId ?? h.id, sourceRevision: h.sourceRevision,
    ...(h.directorCues ? { directorCues: h.directorCues } : {}),
    ...(includeProse && (h.sourceResponse ?? h.aiResponse) ? { aiResponse: h.sourceResponse ?? h.aiResponse } : {}) })));
  return selectHistoryEpoch({ entries, previous, scope: previous?.scope ?? { worldId: '', playthroughId: '', archiveScope: '' },
    policy: contextCompressionPolicy(null, estimateTextTokens(aliceUserInstructions())) }).history;
}
/** Side-channel evidence only: it is never appended to the model's prompt. */
export function inspectActionContext(input: {
  cards?: CardActionContext; systemPrompt: string; promptSections?: AiPromptSections;
  userMessage: string; maxTokens: number; settings?: Record<string, string> | null;
}): ActionContextDiagnostics {
  try {
    return { cards: input.cards, budget: preparePromptBudget({ ...input, config: resolveAiRoleConfig('alice', { ...loadSettings(), ...input.settings }, input.settings) }).report };
  } catch (error) {
    if (error instanceof ContextBudgetError) error.cards = input.cards;
    throw error;
  }
}
export function failedContextDiagnostics(error: unknown): ActionContextDiagnostics | undefined {
  return error instanceof ContextBudgetError ? { cards: error.cards, budget: error.report, history: error.history } : undefined;
}

/** Downgrade whole accepted prose to its existing summary; authoritative state and originals never change. */
export function fitActionContext(input: {
  cards?: CardActionContext; recentHistory: RecentActionContext[];
  historyEpoch?: HistoryEpochPlan | null; historyScope?: HistoryEpochPlan['scope'];
  build: (historySummary: string, history?: RecentActionContext[]) => AiPromptSections; userMessage: string; maxTokens: number; settings?: Record<string, string> | null;
}) {
  const provided = input.recentHistory;
  let base: ActionContextDiagnostics;
  try {
    const promptSections = input.build('');
    base = inspectActionContext({ ...input, promptSections, systemPrompt: composeSystemPrompt(promptSections) });
  } catch (error) {
    if (error instanceof ContextBudgetError) error.history = { provided: provided.length, retained: 0, omitted: provided.length };
    throw error;
  }
  const policy = contextCompressionPolicy(input.settings, base.budget!.inputTokensEstimated, input.maxTokens);
  const identified = identifyHistory(provided);
  const scope = input.historyScope ?? { worldId: '', playthroughId: '', archiveScope: '' };
  const selected = selectHistoryEpoch({ entries: identified, previous: input.historyEpoch, scope, policy }), history = selected.history;
  let resetReason = selected.resetReason;
  let target = policy.windowTokens ? Math.floor(policy.windowTokens * policy.upperPercent / 100) : Infinity;
  while (true) {
    const promptSections = input.build(historySummary(history), history), systemPrompt = composeSystemPrompt(promptSections);
    const counts = { provided: provided.length, retained: history.length, omitted: provided.length - history.length };
    try {
      const diagnostics = inspectActionContext({ ...input, systemPrompt, promptSections });
      if (history.length && diagnostics.budget!.inputTokensEstimated + input.maxTokens > target) {
        target = Math.floor(policy.windowTokens! * policy.lowerPercent / 100);
      } else {
        const full = history.filter(h => Boolean(h.aiResponse)).length;
        diagnostics.history = counts;
        diagnostics.compression = { full, compressed: history.length - full, lowerPercent: policy.lowerPercent, upperPercent: policy.upperPercent };
        const historyEpoch = historyEpochPlanFor(identified, history, scope, policy);
        diagnostics.historyEpoch = { id: historyEpoch.id, resetReason };
        return { promptSections, systemPrompt, diagnostics, historyEpoch };
      }
    } catch (error) {
      if (!(error instanceof ContextBudgetError)) throw error;
      error.history = counts;
      if (!history.length) throw error;
      target = policy.windowTokens! * policy.lowerPercent / 100;
    }
    const oldestFull = history.find(h => h.aiResponse && h.summary.trim());
    resetReason ??= 'budget';
    if (oldestFull) delete oldestFull.aiResponse;
    else history.shift();
  }
}
