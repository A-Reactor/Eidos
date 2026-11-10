import { describe, expect, it } from 'vitest';
import { documentResponse, readModelDocument } from '@/lib/ai/document-response';
import { salvagePartialGameResponse } from '@/lib/ai/salvage';

describe('model documents and lossless recovery', () => {
  it('keeps long prose and its raw output when recovering a non-JSON reply', () => {
    const text = '# 分析\n' + '完整内容。'.repeat(400) + '最后一行';
    const recovered = salvagePartialGameResponse(text);
    expect(recovered.document?.content).toBe(text);
    expect(recovered.document?.rawOutput).toBe(text);
    expect(recovered.timeSpent).toEqual({ day: 0, hour: 0, minute: 0 });
    expect(recovered.availableActions).toEqual([]);
  });
  it('preserves text recovered from an incomplete segment object', () => {
    const text = '很长的叙事。'.repeat(200) + '结尾';
    const recovered = salvagePartialGameResponse('{broken "text":' + JSON.stringify(text));
    expect(recovered.segments.map(s => s.text).join('')).toBe(text);
  });
  it('keeps braces and JSON examples inside a plain document', () => {
    const text = '# 协议分析\n示例：\n```json\n{"text":"示例字段"}\n```\n' + '后续内容。'.repeat(100) + '最终结论';
    expect(salvagePartialGameResponse(text).document?.content).toBe(text);
  });
  it('accepts only explicit valid documents and discards game effects', () => {
    const doc = readModelDocument({ type: 'document', title: '报告', format: 'markdown', content: '正文', itemsGained: [{ id: 'fake' }] }, 'raw');
    const result = documentResponse(doc!);
    expect(result.document?.content).toBe('正文');
    expect(result.itemsGained).toEqual([]);
    expect(result.sceneChanges).toEqual([]);
    expect(result.sandboxToolRequests).toBeUndefined();
    expect(result.timeSpent).toEqual({ day: 0, hour: 0, minute: 0 });
    expect(readModelDocument({ segments: [] })).toBeNull();
    expect(() => readModelDocument({ type: 'document', title: '报告', content: '' })).toThrow();
  });
});
