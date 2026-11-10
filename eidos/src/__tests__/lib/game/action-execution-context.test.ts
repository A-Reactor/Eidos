import { expect, it } from 'vitest';
import { appendExecutionRecord, renderExecutionContext } from '@/lib/game/action-execution-context';
import type { ActionExecutionContext } from '@/lib/game/action-execution-context';
import { validateWorkspaceContext, workspaceMaterials } from '@/lib/ai/workspace-tools';
const base: ActionExecutionContext = { epoch:0, records:[], current:{pendingWrites:[],remaining:{read:32,write:16,game:8,continuations:32}} };
it('appends observations without changing earlier text and renders mutable counters last', () => {
 const a=appendExecutionRecord(base,{kind:'operation',sequence:0,receipt:{method:'files.patch',status:'failed',error:'版本冲突'}});
 const b=appendExecutionRecord(a,{kind:'operation',sequence:1,receipt:{method:'files.patch',status:'staged',result:{afterVersion:'material_0000000000000001'}}});
 expect(b.records[0]).toEqual(a.records[0]); expect(base.records).toEqual([]);
 const aa=renderExecutionContext(a),bb=renderExecutionContext(b);
 expect(bb.indexOf('版本冲突')).toBeLessThan(bb.indexOf('afterVersion'));
 expect(bb.slice(0,bb.indexOf('afterVersion'))).toContain('版本冲突');
 expect(bb.indexOf('剩余额度')).toBeGreaterThan(bb.indexOf('afterVersion'));
 expect(aa).toContain('失败');
});
it('round-trips bounded typed records and rejects excessive bodies at the transport boundary', () => {
 const execution=appendExecutionRecord(base,{kind:'evidence',sequence:0,result:{method:'files.read',status:'committed',path:'drafts/a/中文.md',version:'material_0000000000000001',text:'原文',offset:0,totalChars:2,nextOffset:null}});
 const context={draftRoot:'drafts/a',mounts:[],results:[],nextOffset:null,execution};
 expect(workspaceMaterials(validateWorkspaceContext(context))).toContain('原文');
 expect(()=>validateWorkspaceContext({...context,execution:{...execution,records:[{kind:'evidence',sequence:0,result:{method:'files.read',status:'committed',text:'文'.repeat(12001)}}]}})).toThrow();
});
