import { describe, expect, it } from 'vitest';
import { buildUzqGameplayPrompt, parseUzqGameplayReview } from '@/lib/ai/uzq-gameplay';
import { hudWorld, resourceWorld } from '../game/gameplay-resource-fixtures';

const plugins = () => resourceWorld().gameplayPlugins;
const finding = { pluginId: 'supplies', ruleId: 'eat', severity: 'warning', message: '补给可能耗尽', suggestion: '提供获取补给的路径' };
describe('UZQ independent gameplay design protocol', () => {
  it('ignores HUD-only edits without changing rule analysis or its cached prefix', () => {
    const world = hudWorld();
    const before = JSON.stringify(world);
    const prompt = buildUzqGameplayPrompt(world.gameplayPlugins);
    expect(prompt).toEqual(buildUzqGameplayPrompt(plugins()));
    expect(prompt.stablePrefix).toContain('"stamina":-2');
    expect(JSON.stringify(world)).toBe(before);
  });
  it('accepts advisory output with references to selected rules', () => {
    expect(parseUzqGameplayReview(JSON.stringify({ summary: '有补给风险', findings: [finding] }), plugins())).toEqual({ summary: '有补给风险', findings: [finding] });
    expect(parseUzqGameplayReview({ summary: '没有发现明显风险', findings: [] }, plugins()).findings).toEqual([]);
  });
  it.each([
    'not json', { summary: '', findings: [] }, { summary: '检查', findings: 'wrong' },
    { summary: '检查', findings: [{ ...finding, pluginId: 'other' }] },
    { summary: '检查', findings: [{ ...finding, ruleId: 'unknown' }] },
    { summary: '检查', findings: [{ ...finding, severity: 'approved' }] },
    { summary: '检查', findings: [{ ...finding, message: 'x'.repeat(1001) }] },
    { summary: '检查', findings: [finding], resources: { stamina: 100 } },
    { summary: '检查', findings: [{ ...finding, execute: true }] },
    { summary: '检查', findings: Array.from({ length: 13 }, () => finding) },
  ])('rejects malformed, oversized or authority-bearing output %j', invalid => {
    expect(() => parseUzqGameplayReview(invalid, plugins())).toThrow();
  });
  it('keeps schema and selected declarations stable and does not include changing gameplay state', () => {
    const prompt = buildUzqGameplayPrompt(plugins());
    expect(prompt.stablePrefix).toContain('UZQ');
    expect(prompt.stablePrefix).toContain('建议');
    expect(prompt.stablePrefix).toContain('resourceChanges');
    expect(prompt.stablePrefix).toContain('不得修改');
    expect(prompt.dynamicSuffix).not.toContain('gameplay.supplies.stamina');
    expect(buildUzqGameplayPrompt(plugins()).stablePrefix).toBe(prompt.stablePrefix);
  });
});
