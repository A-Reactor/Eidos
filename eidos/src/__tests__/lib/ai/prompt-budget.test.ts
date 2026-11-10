import { fitActionContext } from '@/lib/ai/action-context-diagnostics';
import { describe, expect, it } from 'vitest';
import { preparePromptBudget, ContextBudgetError, assertCardGrowthFits } from '@/lib/ai/prompt-budget';
import { resolveAiRoleConfig } from '@/lib/ai/providers/config';
import { DEFAULT_SETTINGS } from '@/lib/game/types';
import { composeSystemPrompt } from '@/lib/ai/prompt-layout';
const config = resolveAiRoleConfig('alice', DEFAULT_SETTINGS);
const request = (extra: object = {}) => ({ config, systemPrompt: '长期规则', userMessage: '检查灯', maxTokens: 8000, ...extra });
describe('whole request budget', () => {
  it('measures all text, including engine, world, cards, plugin rules, history and user input', () => {
    const sections = { stablePrefix: '引擎与世界与原卡', dynamicSuffix: '模组状态与历史', components: [{ id: 'cards', label: '原卡', text: '原卡' }, { id: 'history', label: '历史', text: '历史' }] };
    const budget = preparePromptBudget(request({ promptSections: sections, systemPrompt: composeSystemPrompt(sections) })).report;
    expect(budget.estimated).toBe(true); expect(budget.inputTokensEstimated).toBeGreaterThan(10);
    expect(budget.sections.map(s => s.id)).toEqual(expect.arrayContaining(['cards', 'history', 'user', 'other']));
    expect(budget.totalTokensEstimated).toBe(budget.inputTokensEstimated + budget.outputTokens);
    expect(budget.windowTokens).toBe(1_000_000);
  });
  it('uses actual DeepSeek reasoning output reservation and can reduce only the extra reserve', () => {
    const thinking = { ...config, enableReasoning: true, reserveReasoningBudget: true, contextWindowTokens: 20_000 };
    const result = preparePromptBudget(request({ config: thinking }));
    expect(result.report.requestedOutputTokens).toBe(65536);
    expect(result.generationMaxTokens).toBeLessThan(20_000);
    expect(result.generationMaxTokens).toBeGreaterThanOrEqual(8000);
    expect(result.report.outputAdjusted).toBe(true);
    expect(preparePromptBudget(request({ config: { ...thinking, reserveReasoningBudget: false } })).generationMaxTokens).toBe(8000);
  });
  it('refuses an overfull request before any network work and carries actionable diagnostics', () => {
    try { preparePromptBudget(request({ config: { ...config, contextWindowTokens: 1000 } })); throw new Error('expected budget error'); }
    catch (error) { expect(error).toBeInstanceOf(ContextBudgetError); expect((error as ContextBudgetError).report.status).toBe('over_budget'); }
  });
  it('does not invent a window for custom deployments, and accepts a user supplied window', () => {
    const custom = { ...config, baseUrl: 'http://127.0.0.1:4000', model: 'custom', providerId: 'custom-openai-compatible' };
    expect(preparePromptBudget(request({ config: custom })).report.status).toBe('unknown_window');
    expect(preparePromptBudget(request({ config: { ...custom, contextWindowTokens: 16000 } })).report.windowTokens).toBe(16000);
  });
  it('does not claim that media has been precisely tokenized', () => {
    const result = preparePromptBudget(request({ media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] }));
    expect(result.report.mediaUnestimated).toBe(true);
  });
});

it('fits a small window by removing whole oldest records, preserving core/card text and newer history', () => {
  const records = [{ playerInput: 'old-action', summary: 'a'.repeat(4000) }, { playerInput: 'new-action', summary: 'b'.repeat(4000) }];
  const original = '原卡必须完整' + 'C'.repeat(1000);
  const result = fitActionContext({ recentHistory: records, userMessage: '继续', maxTokens: 8000,
    settings: { aliceContextWindowTokens: 11000, contextCompressionLowerPercent: 100, contextCompressionUpperPercent: 100 } as unknown as Record<string, string>,
    build: dynamicSuffix => ({ stablePrefix: original, dynamicSuffix }) });
  expect(result.diagnostics.history).toEqual({ provided: 2, retained: 1, omitted: 1 });
  expect(result.promptSections.stablePrefix).toBe(original);
  expect(result.systemPrompt).toContain(records[1].summary); expect(result.systemPrompt).not.toContain('old-action');
  expect(records[0].summary).toHaveLength(4000);
});

it('rejects card growth that exhausts the whole window, allowing removable history to make room', () => {
  const before = { stablePrefix: '固定原卡', dynamicSuffix: '', selected: [], omitted: [] };
  const after = { ...before, dynamicSuffix: '长'.repeat(1000) };
  const budget = preparePromptBudget(request({ systemPrompt: before.stablePrefix, config: { ...config, contextWindowTokens: 9000 } })).report;
  expect(() => assertCardGrowthFits({ budget, before, after })).toThrow(/下一轮必需上下文/);
  const withHistory = { ...budget, inputTokensEstimated: budget.inputTokensEstimated + 2000, windowTokens: 11000, sections: [{ id: 'history', label: 'history', chars: 4000, estimatedTokens: 2000 }] };
  expect(() => assertCardGrowthFits({ budget: withHistory, before, after })).not.toThrow();
});
