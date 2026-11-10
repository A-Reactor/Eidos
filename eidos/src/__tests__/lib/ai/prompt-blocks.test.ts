import { expect, it } from 'vitest';
import { assemblePromptBlocks, describePromptDifference } from '@/lib/ai/prompt-blocks';
import { composeSystemPrompt, stableRecordJSON } from '@/lib/ai/prompt-layout';
it('reports exact UTF-16 spans without adding diagnostic labels to model text', () => {
  const blocks = [
    { id: 'a', kind: 'rules', stability: 'edition', text: '相同标题🙂' },
    { id: 'b', kind: 'edition', stability: 'edition', text: '' },
    { id: 'c', kind: 'record', stability: 'record', text: '相同标题🙂\n历史原文' },
    { id: 'd', kind: 'current', stability: 'request', text: '\n现在甲' },
  ] as const;
  const a = assemblePromptBlocks(blocks);
  expect(composeSystemPrompt(a.sections)).toBe(a.systemPrompt);
  a.spans.forEach((span, i) => expect(a.systemPrompt.slice(span.start, span.end)).toBe(blocks[i].text));
  expect(a.spans.every((s,i) => i === 0 || s.start >= a.spans[i-1].end)).toBe(true);
  const b = assemblePromptBlocks([...blocks.slice(0,3), { ...blocks[3], text: '\n现在乙' }]);
  expect(describePromptDifference(a.systemPrompt, b.systemPrompt, b.spans)).toMatchObject({ blockId: 'd' });
  expect(b.spans.slice(0,3)).toEqual(a.spans.slice(0,3));
  expect(a.systemPrompt).not.toContain('stability');
});
it('normalizes record keys while retaining text and semantic array order', () => {
  expect(stableRecordJSON({ z: ['乙','甲'], a: { b: '中文 e\u0301' } })).toBe(stableRecordJSON({ a: { b: '中文 e\u0301' }, z: ['乙','甲'] }));
  expect(stableRecordJSON(['乙','甲'])).not.toBe(stableRecordJSON(['甲','乙']));
});
