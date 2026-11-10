import type { WorldLineNode } from '../types';
import type { TextEffect } from '../text-effects';
import { presentationCues,presentationPath,cuesForTarget } from './runtime';
import type { Presentation,PresentationCue } from './types';

export interface ObserverChange {sourceEventId:string;targetNode:string;segment:number;field:PresentationCue['field'];start:number;end:number;effect:TextEffect}
export interface ObserverInterference {originNodeId:string;targetNodeId:string;changes:ObserverChange[]}

/** Only completed, still-visible changes to this past are carried across the fork. */
export function captureObserverInterference(nodes:Record<string,WorldLineNode>,origin:string,target:string):ObserverInterference {
 const past=new Set(presentationPath(nodes,target).map(n=>n.id)),base=new Set(presentationCues(nodes,target).map(c=>c.id));
 const candidates=presentationCues(nodes,origin).filter(c=>c.active && !past.has(c.owner) && past.has(c.targetNode));
 const selected=new Set(candidates.filter(c=>c.effect.kind!=='restore').map(c=>c.id));
 return {originNodeId:origin,targetNodeId:target,changes:candidates.filter(c=>c.effect.kind!=='restore' || base.has(c.effect.effectId ?? '') || selected.has(c.effect.effectId ?? '')).map(c=>({sourceEventId:c.id,targetNode:c.targetNode,segment:c.segment,field:c.field,start:c.start,end:c.end,effect:{...c.effect}}))};
}

export function observerPresentation(nodes:Record<string,WorldLineNode>,target:WorldLineNode,id:string,bundle:ObserverInterference):Presentation {
 const original=target.presentation!;
 const p:Presentation={version:1,replicaOf:target.id,ranges:structuredClone(original.ranges),cues:[],errors:[],read:structuredClone(original.read),fired:{},armed:{},motion:{},order:{}};
 let sequence=presentationCues(nodes,target.id).reduce((max,c)=>Math.max(max,c.order),0)+1;
 const ids=new Map(bundle.changes.map((c,i)=>[c.sourceEventId,`${id}:0:${i}`]));
 const add=(cue:Omit<PresentationCue,'id'|'owner'|'source'>,cueId:string,sourceEventId:string)=>{
  p.cues.push({...cue,id:cueId,owner:id,source:0,sourceEventId,effect:{...cue.effect,afterSegments:-1,delayMs:0}});
  p.fired[cueId]=true;p.motion![cueId]=0;p.order![cueId]=sequence++;
 };
 // These events affect the shared old record only within the new branch.
 for(const change of bundle.changes) add({...change,effect:{...change.effect,...(change.effect.effectId && ids.has(change.effect.effectId) ? {effectId:ids.get(change.effect.effectId)} : {})}},ids.get(change.sourceEventId)!,change.sourceEventId);
 // The arrival is a new view of the old scene. Its own copy starts in the observed
 // final state, so opening it neither replays old effects nor leaks the old words.
 for(const cue of cuesForTarget(nodes,bundle.originNodeId,target.id).filter(c=>c.active && c.effect.kind!=='restore')) {
  add({...cue,targetNode:id},`${id}:0:${p.cues.length}`,cue.id);
 }
 return p;
}
