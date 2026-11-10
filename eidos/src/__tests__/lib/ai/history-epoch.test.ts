import { expect, it } from 'vitest';
import { identifyHistory, selectHistoryEpoch } from '@/lib/ai/history-epoch';
const entries=identifyHistory(Array.from({length:8},(_,i)=>({actionId:`a${i}`,playerInput:`行动${i}`,summary:`摘要${i}`,aiResponse:'正文'.repeat(120)})));
const scope={worldId:'w',playthroughId:'p',archiveScope:'ordinary'};
const policy={windowTokens:4000,baseTokens:100,outputTokens:100,lowerPercent:30,upperPercent:65};
it('pins accepted full/summary choices when current material changes below the upper threshold',()=>{
 const a=selectHistoryEpoch({entries,policy,scope});
 expect(a.history.some(h=>!h.aiResponse)).toBe(true);
 const b=selectHistoryEpoch({entries:[...entries,...identifyHistory([{actionId:'next',playerInput:'继续',summary:'新摘要',aiResponse:'新正文'}])],previous:a.plan,policy:{...policy,baseTokens:90},scope});
 expect(b.plan.retained.slice(0,a.plan.retained.length)).toEqual(a.plan.retained);
 expect(b.resetReason).toBeUndefined();
 expect(entries.every(e=>e.aiResponse)).toBe(true);
});
it('rebuilds for source edits, a different branch or a different playthrough without borrowing another path',()=>{
 const a=selectHistoryEpoch({entries,policy,scope});
 const edited=identifyHistory(entries.map((e,i)=>i===7?{...e,sourceRevision:undefined,aiResponse:'改过的原文'}:e));
 expect(selectHistoryEpoch({entries:edited,previous:a.plan,policy,scope}).resetReason).toBe('source_changed');
 expect(selectHistoryEpoch({entries:entries.slice(0,3),previous:a.plan,policy,scope}).resetReason).toBe('branch_changed');
 expect(selectHistoryEpoch({entries,previous:a.plan,policy,scope:{...scope,playthroughId:'other'}}).resetReason).toBe('scope_changed');
});
it('ignores malformed optional epoch metadata rather than blocking a valid legacy game',()=>{
 const damaged={rendererVersion:1,scope,retained:[null],policy:'bad'};
 expect(()=>selectHistoryEpoch({entries,previous:damaged as never,policy,scope})).not.toThrow();
 expect(selectHistoryEpoch({entries,previous:damaged as never,policy,scope}).resetReason).toBe('invalid_plan');
});
