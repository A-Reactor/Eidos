import type { AiPromptSections } from './prompt-layout';
import type { AiRoleConfig } from './providers/types';
import { getModelContextWindow } from './context-usage';
import { cardContextText } from '@/lib/game/cards/types';
import { extraReasoningTokens } from './providers/request-options';
import { assemblePromptBlocks, promptTextHash, type PromptBlockSpan } from './prompt-blocks';

export interface PromptBudgetSection { id: string; label: string; chars: number; estimatedTokens: number }
export interface PromptBudgetReport {
  estimated: true; method: 'utf8_estimate'; status: 'within_budget' | 'unknown_window' | 'over_budget';
  modelId: string; providerId: string; windowTokens?: number; inputTokensEstimated: number;
  outputTokens: number; minimumOutputTokens: number; requestedOutputTokens: number; totalTokensEstimated: number;
  outputAdjusted: boolean; mediaUnestimated: boolean; stablePrefixChars: number; stablePrefixHash: string;
  sections: PromptBudgetSection[];
  layout?: { version: number; spans: PromptBlockSpan[] };
}
export interface BudgetRequest {
  config: AiRoleConfig; systemPrompt: string; userMessage: string; maxTokens: number;
  promptSections?: AiPromptSections; media?: unknown[]; generationMaxTokens?: number;
}
/** A local text estimate, never a tokenizer result or a claim about image/PDF token counts. */
export const estimateTextTokens = (value: string): number => Math.ceil(new TextEncoder().encode(value).length / 2);
export function requestedGenerationTokens(request: Pick<BudgetRequest, 'config' | 'maxTokens'>): number {
  const c = request.config;
  return c.protocol === 'deepseek-native' && c.enableReasoning && c.reserveReasoningBudget !== false
    ? Math.max(request.maxTokens, c.reasoningEffort === 'max' ? 131072 : 65536)
    : request.maxTokens + extraReasoningTokens(c);
}
export class ContextBudgetError extends Error {
  readonly code = 'context_budget_exceeded';
  cards?: import('@/lib/game/cards/types').CardActionContext;
  history?: { provided: number; retained: number; omitted: number };
  constructor(public readonly report: PromptBudgetReport) {
    super(`完整请求预计超过上下文窗口：输入约 ${report.inputTokensEstimated} + 正文预留 ${report.outputTokens} / ${report.windowTokens} token。请在作者工具查看组成，减少同时挂载的资料或自定义提示词，或确认模型窗口设置。`);
    this.name = 'ContextBudgetError';
  }
}
export function preparePromptBudget(request: BudgetRequest): { report: PromptBudgetReport; generationMaxTokens: number } {
  const windowTokens = request.config.contextWindowTokens || getModelContextWindow(request.config);
  const inputTokensEstimated = estimateTextTokens(request.systemPrompt + '\n' + request.userMessage) + 32;
  const requestedOutputTokens = requestedGenerationTokens(request);
  // Extra thinking reserve may contract; the caller's visible-output allocation is preserved.
  const outputTokens = windowTokens ? Math.max(request.maxTokens, Math.min(requestedOutputTokens, windowTokens - inputTokensEstimated)) : requestedOutputTokens;
  const components = request.promptSections?.components ?? [{ id: 'system', label: '系统与世界上下文', text: request.systemPrompt }];
  const covered = components.reduce((n, p) => n + p.text.length, 0);
  const parts = [...components, { id: 'user', label: '当前输入', text: request.userMessage }];
  const sections = parts.filter(p => p.text).map(p => ({ id: p.id, label: p.label, chars: Array.from(p.text).length, estimatedTokens: estimateTextTokens(p.text) }));
  if (inputTokensEstimated > sections.reduce((n, p) => n + p.estimatedTokens, 0)) sections.push({ id: 'other', label: '封装、分隔与其他协议', chars: Math.max(0, request.systemPrompt.length - covered), estimatedTokens: Math.max(0, inputTokensEstimated - sections.reduce((n, p) => n + p.estimatedTokens, 0)) });
  const stable = request.promptSections?.stablePrefix ?? '';
  const report: PromptBudgetReport = { estimated: true, method: 'utf8_estimate', modelId: request.config.model, providerId: request.config.providerId, windowTokens,
    status: !windowTokens ? 'unknown_window' : inputTokensEstimated + outputTokens <= windowTokens ? 'within_budget' : 'over_budget',
    inputTokensEstimated, outputTokens, minimumOutputTokens: request.maxTokens, requestedOutputTokens, totalTokensEstimated: inputTokensEstimated + outputTokens,
    outputAdjusted: outputTokens !== requestedOutputTokens, mediaUnestimated: Boolean(request.media?.length),
    stablePrefixChars: Array.from(stable).length, stablePrefixHash: promptTextHash(stable), sections };
  if (request.promptSections) {
    const p = request.promptSections;
    const physical = assemblePromptBlocks(p.blocks ?? [
      { id: 'stable', kind: 'rules', stability: 'edition', text: p.stablePrefix },
      { id: 'current', kind: 'current', stability: 'request', text: p.dynamicSuffix },
    ]);
    if (physical.systemPrompt !== request.systemPrompt) throw new Error('提示词块与实际 systemPrompt 不一致');
    report.layout = { version: 1, spans: physical.spans };
  }
  if (report.status === 'over_budget') throw new ContextBudgetError(report);
  return { report, generationMaxTokens: outputTokens };
}

/** A variable proposal must not make even a history-free next request unplayable. */
export function assertCardGrowthFits(input: {
  budget?: PromptBudgetReport; before?: import('@/lib/game/cards/types').CardActionContext; after?: import('@/lib/game/cards/types').CardActionContext;
}) {
  const { budget, before, after } = input;
  if (!budget?.windowTokens || !before || !after) return;
  const prior = estimateTextTokens(cardContextText(before));
  const next = estimateTextTokens(cardContextText(after));
  const transient = budget.sections.filter(s => s.id === 'history').reduce((sum, s) => sum + s.estimatedTokens, 0);
  const estimate = budget.inputTokensEstimated - transient - prior + next;
  if (estimate + budget.minimumOutputTokens > budget.windowTokens) throw new Error(`变量更新会使下一轮必需上下文预计超过窗口（输入约 ${estimate} + 正文预留 ${budget.minimumOutputTokens} / ${budget.windowTokens} token），本轮变量与模组规则未结算。`);
}
