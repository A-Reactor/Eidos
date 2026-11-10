import { describe, expect, it } from 'vitest';
import { selectContextHistory, historySummary } from '@/lib/ai/history-context';
import { recentActionsForModel, fitActionContext } from '@/lib/ai/action-context-diagnostics';
import { estimateTextTokens } from '@/lib/ai/prompt-budget';
const entries = Array.from({ length: 30 }, (_, i) => ({ playerInput: `行动${i}`, summary: `已确认事实${i}`, aiResponse: '正文'.repeat(80) }));
const policy = { windowTokens: 2000, baseTokens: 100, outputTokens: 100, lowerPercent: 40, upperPercent: 75 };
describe('token-based history compression', () => {
  it('keeps more than ten complete nodes when they fit, without fixed node cutoffs', () => {
    expect(recentActionsForModel(entries)).toHaveLength(30);
    expect(recentActionsForModel(entries).every(e => e.aiResponse)).toBe(true);
    const result = fitActionContext({ recentHistory: entries, userMessage: '继续', maxTokens: 8000, build: dynamicSuffix => ({ stablePrefix: '世界规则', dynamicSuffix }) });
    expect(result.diagnostics.compression).toMatchObject({ full: 30, compressed: 0 });
  });
  it('compresses batches at the upper trigger and lets new complete prose grow before the next batch', () => {
    let length = 1;
    while (length < entries.length && !selectContextHistory(entries.slice(0, length), policy).compressed) length++;
    const first = selectContextHistory(entries.slice(0, length), policy);
    expect(first.compressed).toBeGreaterThan(0); expect(first.omitted).toBe(0);
    expect(estimateTextTokens(historySummary(first.history)) + policy.baseTokens + policy.outputTokens).toBeLessThanOrEqual(800);
    const next = selectContextHistory([...entries.slice(0, length), { playerInput: '下一步', summary: '新事实', aiResponse: '新的完整正文' }], policy);
    expect(next.compressed).toBe(first.compressed); expect(next.full).toBe(first.full + 1);
    expect(entries.every(e => e.aiResponse === '正文'.repeat(80))).toBe(true);
  });
  it('does not invent a model window or truncate a missing summary into a fabricated one', () => {
    expect(selectContextHistory(entries, { ...policy, windowTokens: undefined }).history).toEqual(entries);
    const unsummarized = { playerInput: '行动', summary: '', aiResponse: '原文'.repeat(2000) };
    const result = selectContextHistory([unsummarized], policy);
    expect(result.history).toEqual([]); expect(result.omitted).toBe(1);
    expect(unsummarized.aiResponse).toBe('原文'.repeat(2000));
  });
  it('uses the complete base prompt and output reserve, preserves originals, and rejects required context that cannot fit', () => {
    const result = fitActionContext({ recentHistory: entries, userMessage: '继续', maxTokens: 200,
      settings: { aliceContextWindowTokens: 2600, contextCompressionLowerPercent: 50, contextCompressionUpperPercent: 80 } as unknown as Record<string, string>,
      build: dynamicSuffix => ({ stablePrefix: '原卡与世界规则'.repeat(30), dynamicSuffix }) });
    expect(result.diagnostics.compression!.compressed).toBeGreaterThan(0);
    expect(result.diagnostics.budget!.inputTokensEstimated + 200).toBeLessThanOrEqual(2080);
    expect(result.systemPrompt).toContain('原卡与世界规则'.repeat(30));
    expect(() => fitActionContext({ recentHistory: entries, userMessage: '继续', maxTokens: 200, settings: { aliceContextWindowTokens: 500 } as unknown as Record<string, string>, build: dynamicSuffix => ({ stablePrefix: '原卡'.repeat(1000), dynamicSuffix }) })).toThrow(/超过上下文/);
  });
});
