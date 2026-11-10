import { afterEach, expect, it } from 'vitest';
import { clearActionDiagnostics, getActionDiagnostics, recordActionDiagnostics, selectActionDiagnostics } from '@/lib/game/action-diagnostics';
import { createStreamRequestScope } from '@/lib/game/stream-lifecycle';
const scope = createStreamRequestScope({ currentWorld: { id: 'world' }, currentPlaythroughId: 'run', currentNode: { id: 'parent' } });
afterEach(clearActionDiagnostics);
it('records actual selection and accepted updates without putting diagnostics in gameplay state', () => {
  recordActionDiagnostics(scope, { input: '询问', status: 'accepted', context: { cards: { stablePrefix: '世界原文', dynamicSuffix: '本轮条件', selected: [{ assetId: 'a', pointer: '/description', chars: 4, reason: '核心' }], omitted: [{ assetId: 'a', pointer: '/entries/1', chars: 4, reason: '关键词未命中' }] } }, variableUpdates: [{ assetId: 'a', expectedRevision: 0, changes: [{ path: 'trust', oldValue: 20, newValue: 65 }] }] });
  const result = selectActionDiagnostics(getActionDiagnostics(), { currentWorld: { id: 'world' }, currentPlaythroughId: 'run' });
  expect(result[0].context?.cards?.dynamicSuffix).toBe('本轮条件');
  expect(result[0].status).toBe('accepted');
  expect(result[0].variableUpdates).toHaveLength(1);
  expect(selectActionDiagnostics(getActionDiagnostics(), { currentWorld: { id: 'world' }, currentPlaythroughId: 'other' })).toEqual([]);
  expect(selectActionDiagnostics(getActionDiagnostics(), { currentWorld: { id: 'world' }, currentPlaythroughId: 'run', sandboxMode: true })).toEqual([]);
});
it('updates a request record once and preserves acceptance when a duplicate receipt arrives', () => {
  recordActionDiagnostics(scope, { input: '继续', status: 'accepted' });
  recordActionDiagnostics(scope, { input: '继续', status: 'received' });
  expect(getActionDiagnostics()).toHaveLength(1);
  expect(getActionDiagnostics()[0].status).toBe('accepted');
});

it('preserves distinct rounds with identical usage and deduplicates the same round receipt', async () => {
  const { recordActionRound } = await import('@/lib/game/action-diagnostics');
  const usage = { model: 'alice' as const, promptTokens: 12, completionTokens: 3, totalTokens: 15 };
  for (const index of [0,1,1,2]) recordActionRound(scope, '继续', { index, callType: 'alice_action', usage });
  recordActionDiagnostics(scope, { input: '继续', status: 'accepted', publishedDocuments: ['new-document'] });
  const record = getActionDiagnostics()[0];
  expect(record.rounds).toHaveLength(3);
  expect(record.rounds?.map(r => r.index)).toEqual([0,1,2]);
  expect(record.publishedDocuments).toEqual(['new-document']);
});
it('identifies the first changed physical block without claiming a measured cache hit', async()=>{
 const {recordActionRound}=await import('@/lib/game/action-diagnostics');
 const {assemblePromptBlocks}=await import('@/lib/ai/prompt-blocks');
 const a=assemblePromptBlocks([{id:'rules',kind:'rules',stability:'edition',text:'规则'},{id:'state',kind:'current',stability:'request',text:'甲'}]);
 const b=assemblePromptBlocks([{id:'rules',kind:'rules',stability:'edition',text:'规则'},{id:'state',kind:'current',stability:'request',text:'乙'}]);
 for(const [index,p] of [a,b].entries())recordActionRound(scope,'继续',{index,callType:'alice_action',context:{budget:{layout:{version:1,spans:p.spans}} as never}});
 expect(getActionDiagnostics()[0].rounds?.[1].comparison).toMatchObject({firstChangedBlockId:'state',unchangedPrefixCharsLowerBound:2});
});
