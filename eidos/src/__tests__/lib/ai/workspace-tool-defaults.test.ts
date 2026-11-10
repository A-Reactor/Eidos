import { expect, it } from 'vitest';
import { validateToolReply } from '@/lib/ai/workspace-tools';
import { salvagePartialGameResponse } from '@/lib/ai/salvage';

const tool = { method: 'files.list', params: {} };
it('accepts and strips harmless final-template defaults from a file tool envelope', () => {
  const reply: Record<string, unknown> = { workspaceRequest: tool, segments: [{ type: 'narration', text: '她展开纸张。' }],
    historyRequest: null, narrative: '', dialogue: null, timeSpent: { day: 0, hour: 0, minute: 0 }, timeAfter: null,
    itemsGained: [], itemsUsed: [], sceneChanges: [], worldImpacts: [], pluginEvents: [], documents: [], document: null, workspaceEffects: [], sandboxToolRequests: [] };
  expect(() => validateToolReply(reply)).not.toThrow();
  expect(reply.segments).toEqual([{ type: 'narration', text: '她展开纸张。' }]);
  for (const key of ['historyRequest', 'timeSpent', 'timeAfter', 'itemsGained', 'documents', 'narrative', 'dialogue', 'workspaceEffects']) expect(reply[key]).toBeUndefined();
});

it.each([
  ['timeSpent', { day: 0, hour: 0, minute: 1 }], ['timeSpent', { day: 0, hour: 0, minute: 0, extra: 1 }],
  ['itemsGained', [{ name: '真实物品' }]], ['documents', [{ key: 'report' }]], ['workspaceEffects', ['not-a-receipt']],
  ['narrative', '旧版正文不应被默默丢掉'], ['timeAfter', { day: 1, hour: 8, minute: 0 }],
])('names the nonempty conflicting %s field rather than silently discarding it', (key, value) => {
  expect(() => validateToolReply({ workspaceRequest: tool, [key]: value })).toThrow(String(key));
});

it('recovers a complete tool container without inventing a five-minute action settlement', () => {
  const partial = JSON.stringify({ segments: [{ type: 'narration', text: '她翻开目录。' }], workspaceRequest: tool }).slice(0, -1);
  const recovered = salvagePartialGameResponse(partial);
  expect(() => validateToolReply(recovered as unknown as Record<string, unknown>)).not.toThrow();
  expect(recovered.workspaceRequest).toEqual(tool);
  expect(recovered.timeSpent).toBeUndefined();
  expect(recovered.itemsGained).toBeUndefined();
});

it('never repairs and executes a file command truncated inside its text argument', () => {
  const partial = '{"workspaceRequest":{"method":"files.write","params":{"path":"drafts/turn/a.txt","expectedVersion":null,"text":"写到一半';
  expect(() => salvagePartialGameResponse(partial)).toThrow(/文件.*不完整/);
});

it('treats null tool placeholders as an ordinary final response, preserving its real settlement', () => {
  const reply: Record<string, unknown> = { workspaceRequest: null, historyRequest: null, segments: [{ type: 'narration', text: '她离开房间。' }], timeSpent: { day: 0, hour: 0, minute: 5 } };
  expect(() => validateToolReply(reply)).not.toThrow();
  expect(reply.workspaceRequest).toBeUndefined();
  expect(reply.historyRequest).toBeUndefined();
  expect(reply.timeSpent).toEqual({ day: 0, hour: 0, minute: 5 });
});

it('does not lose real state changes while recovering a complete trailing tool container', () => {
  const partial = JSON.stringify({ timeSpent: { day: 0, hour: 0, minute: 5 }, workspaceRequest: tool }).slice(0, -1);
  const recovered = salvagePartialGameResponse(partial);
  expect(recovered.workspaceRequest).toEqual(tool);
  expect(recovered.timeSpent).toEqual({ day: 0, hour: 0, minute: 5 });
  expect(() => validateToolReply(recovered as unknown as Record<string, unknown>)).toThrow('timeSpent');
});
