import { expect,it } from 'vitest';
import { compilePresentation,advancePresentation,recordPresentationText,presentationCues,presentationRevision,reindexPresentations,stagePresentationDraft,adoptPresentationDraft,presentationLighting } from '@/lib/game/presentation';
import type { WorldLineNode } from '@/lib/game/types';

function fixture() {
 const past={id:'past',parentId:null,aiResponse:'左门',playerVisibleText:'左门',segmentHash:'raw',childIds:[],stepNumber:1} as unknown as WorldLineNode;
 past.presentation=compilePresentation(past,[{type:'narration',text:'左门'}],{});
 const entry={version:1,id:'entry-fixed',sourceNodeId:'past',originNodeId:'future',presentationOrder:10,snapshotHash:'before',changes:[{sourceEventId:'future:0:0',targetNode:'past',segment:0,field:'text',start:0,end:2,effect:{kind:'replace',quote:'左门',value:'右门'}}]};
 const action={id:'action',parentId:'past',aiResponse:'开门',playerVisibleText:'',segmentHash:'body',childIds:[],stepNumber:2,entry} as unknown as WorldLineNode;
 return {past,action};
}
it('applies entry changes immediately without advancing the action body',()=>{
 const {past,action}=fixture();action.presentation=compilePresentation(action,[{type:'narration',text:'开门',textEffects:[{kind:'replace',nodeId:'past',segment:0,quote:'左门',value:'后门'}]}],{past});
 const nodes={past,action};
 expect(recordPresentationText(past,nodes,'action')).toBe('右门');
 expect(presentationCues(nodes,'action').map(c=>[c.id,c.active])).toEqual([['entry-fixed:0',true],['action:0:0',false]]);
 const played=advancePresentation(nodes,'action',0,2,true,0);
 expect(recordPresentationText(past,played,'action')).toBe('后门');
 expect(Object.keys(played.action.presentation!.read)).toEqual(['0']);
 expect(played.action.presentation!.fired['entry-fixed:0']).toBeUndefined();
});
it('accepts a body restore that refers to the stable entry receipt and revision',()=>{
 const {past,action}=fixture();
 const prepared={past:{...past,entry:action.entry}};
 const revision=presentationRevision(past,prepared,'past');
 action.presentation=compilePresentation(action,[{type:'narration',text:'开门',textEffects:[{kind:'restore',effectId:'entry-fixed:0',expectedRevision:revision}]}],{past});
 expect(action.presentation.errors).toEqual([]);
 const nodes={past,action};expect(presentationRevision(past,nodes,'action')).toBe(revision);
 expect(recordPresentationText(past,nodes,'action')).toBe('右门');
 const played=advancePresentation(nodes,'action',0,2,true,0);
 expect(recordPresentationText(past,played,'action')).toBe('左门');
});
it('relocates entry ranges after document markup is remapped without changing receipt identity',()=>{
 const {past,action}=fixture();
 past.aiResponse='[文件](document:old) 左门';past.playerVisibleText=past.aiResponse;
 past.presentation=compilePresentation(past,[{type:'narration',text:past.aiResponse}],{});
 action.entry!.changes[0]={...action.entry!.changes[0],start:past.aiResponse.indexOf('左门'),end:past.aiResponse.length};
 const remapped={...past,aiResponse:'[文件](document:much-longer-id) 左门'};
 const nodes=reindexPresentations({past:remapped,action},{past:[{type:'narration',text:remapped.aiResponse}],action:[{type:'narration',text:action.aiResponse}]},{past,action});
 expect(nodes.action.entry?.changes[0].start).toBe(remapped.aiResponse.indexOf('左门'));
 expect(recordPresentationText(nodes.past,nodes,'action')).toBe('[文件](document:much-longer-id) 右门');
 expect(presentationCues(nodes,'action')[0].id).toBe('entry-fixed:0');
});
it('places already-played stream effects after every inherited entry receipt',()=>{
 const {past,action}=fixture();action.entry!.presentationOrder=1;
 action.entry!.changes=[0.2,0.4].map((brightness,index)=>({sourceEventId:`future:${index}`,targetNode:'past',segment:0,field:'text',start:0,end:2,effect:{kind:'dim',brightness,transitionMs:0}}));
 const segments=[{type:'narration' as const,text:action.aiResponse,textEffects:[{kind:'dim' as const,brightness:1,transitionMs:0}]}];
 stagePresentationDraft({key:'entry-stream-order',segments,index:0,chars:2,complete:true,showing:true,elapsed:0,legacy:false});
 action.presentation=compilePresentation(action,segments,{past});
 action.presentation=adoptPresentationDraft('entry-stream-order',action,{past,action});
 const cues=presentationCues({past,action},action.id);
 expect(cues.find(c=>c.id==='action:0:0')!.order).toBeGreaterThan(2);
 expect(presentationLighting(cues).brightness).toBe(1);
});
