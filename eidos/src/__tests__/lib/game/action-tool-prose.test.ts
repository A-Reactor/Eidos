// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import type { StorySegment } from '@/lib/ai/types';
import { validateToolReply } from '@/lib/ai/workspace-tools';
import { continueActionTools, type ActionToolResponse } from '@/lib/game/action-tool-continuation';
import { createWorkspaceSession } from '@/lib/game/workspace/session';
import { workspacePromptContext } from '@/lib/game/workspace/context';

const source = { allNodes: {}, currentNode: null };
const paragraph = (text: string): StorySegment => ({ type: 'narration', text });
const setup = () => createWorkspaceSession({ scope: { worldId: crypto.randomUUID(), playthroughId: 'prose' }, actionId: 'turn', parentNodeId: null, inputs: [] });

it('allows ordinary narrative beside a file command while refusing intermediate world settlement', () => {
  const reply = { segments: [paragraph('一。'), paragraph('二。'), paragraph('她继续查看[笔记](document:known)。')], workspaceRequest: { method: 'files.list', params: {} } };
  expect(() => validateToolReply(reply)).not.toThrow();
  expect(reply.segments).toHaveLength(3);
  expect(() => validateToolReply({ ...reply, timeSpent: { day: 1, hour: 0, minute: 0 } })).toThrow('工具');
  expect(() => validateToolReply({ ...reply, segments: [{ type: 'command', text: '隐藏命令' }] })).toThrow();
});

it('routes normal paragraphs around repeated file calls and keeps prior write effects on their paragraph', async () => {
  const session = await setup(), displayed: StorySegment[][] = [];
  const contexts: string[] = [];
  let round = 0, operation = '';
  const result = await continueActionTools({
    response: { segments: [paragraph('门外传来脚步声。')], workspaceRequest: { method: 'files.write', params: { path: 'drafts/turn/a.txt', text: '只在文件里的正文', expectedVersion: null } } },
    session, historySource: source, context: { longMemoryContext: '已有记忆', workspaceContext: workspacePromptContext(session) },
    isCurrent: () => true, onResponse() {}, onNarrative: (segments: StorySegment[]) => displayed.push(structuredClone(segments)),
    invoke: async context => {
      contexts.push(JSON.stringify(context.workspaceContext.narrative));
      if (++round === 1) {
        operation = session.receipts[0].operationId!;
        return { segments: [{ type: 'dialogue', speaker: '甲', text: '稿子收好了。', workspaceEffects: [operation] }], workspaceRequest: { method: 'files.read', params: { path: 'drafts/turn/a.txt' } } };
      }
      return { segments: [paragraph('脚步声停在门前。')], documents: [{ key: 'note', title: '另一页', format: 'text', content: '另页内容', segmentIndex: 0 }], timeSpent: { day: 0, hour: 0, minute: 1 } };
    },
  } as Parameters<typeof continueActionTools>[0]);
  expect(result.segments?.map(s => s.text)).toEqual(['门外传来脚步声。', '稿子收好了。', '脚步声停在门前。']);
  expect(result.segments?.[1].workspaceEffects).toEqual([operation]);
  expect(result.documents?.[0].segmentIndex).toBe(2);
  expect(displayed.map(s => s.length)).toEqual([1, 2]);
  expect(contexts[0]).toContain('门外传来脚步声。');
  expect(contexts[1]).toContain('稿子收好了。');
  expect(session.receipts.map(r => r.method)).toEqual(['files.write', 'files.read']);
  expect(JSON.stringify(result.segments)).not.toContain('只在文件里的正文');
});

it('can finish with metadata alone after normal narrative and does not require extra closing prose', async () => {
  const session = await setup();
  const result = await continueActionTools({ response: { segments: [paragraph('好。')], workspaceRequest: { method: 'files.list', params: {} } }, session,
    historySource: source, context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    invoke: async () => ({ segments: [], summary: '核对目录' }),
  });
  expect(result.segments).toEqual([paragraph('好。')]);
  expect(result.summary).toBe('核对目录');
});

it('refuses invented write receipts before showing tool-round prose or executing its command', async () => {
  const session = await setup(); let visible = false;
  const result = await continueActionTools({ response: { segments: [{ ...paragraph('假装完成'), workspaceEffects: ['invented'] }], workspaceRequest: { method: 'files.list', params: {} } }, session,
    historySource: source, context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {},
    onNarrative: () => { visible = true; }, invoke: async () => ({ segments: [] }),
  } as Parameters<typeof continueActionTools>[0]);
  expect(result.fileOutcome).toBe('failed');
  expect(result.segments?.some(s => s.text.includes('假装完成'))).toBe(false);
  expect(visible).toBe(false);
  expect(session.receipts).toHaveLength(0);
});

it('never executes a command if displaying its preceding prose cancels the action', async () => {
  const session = await setup(); let current = true;
  await expect(continueActionTools({ response: { segments: [paragraph('尚未结算。')], workspaceRequest: { method: 'files.list', params: {} } }, session,
    historySource: source, context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => current, onResponse() {},
    onNarrative: () => { current = false; }, invoke: async () => ({ segments: [] }),
  } as Parameters<typeof continueActionTools>[0])).rejects.toMatchObject({ name: 'AbortError' });
  expect(session.receipts).toHaveLength(0);
});

it('keeps repeated ordinary words from different speakers and preserves no-tool response identity', async () => {
  const session = await setup(), final: ActionToolResponse = { segments: [{ type: 'dialogue', speaker: '乙', text: '好。' }] };
  const run = (response: ActionToolResponse) => continueActionTools({ response, session, historySource: source,
    context: { longMemoryContext: '', workspaceContext: workspacePromptContext(session) }, isCurrent: () => true, onResponse() {}, invoke: async () => final });
  expect(await run(final)).toBe(final);
  expect((await run({ segments: [{ type: 'dialogue', speaker: '甲', text: '好。' }], workspaceRequest: { method: 'files.list', params: {} } })).segments).toHaveLength(2);
});
