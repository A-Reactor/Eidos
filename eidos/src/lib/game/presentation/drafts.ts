import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '../types';
import { compilePresentation } from './compile';
import { advancePresentation,presentationCues } from './runtime';
import type { Presentation } from './types';

export interface PresentationDraft { node:WorldLineNode; acceptedId?:string; segments?:StorySegment[] }
const drafts=new Map<string,PresentationDraft>();
const listeners=new Set<()=>void>();
export const subscribePresentationDrafts=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getPresentationDraft=(key?:string)=>key ? drafts.get(key) : undefined;
function publish(key:string,value:PresentationDraft) {
  drafts.set(key,value);
  while(drafts.size>8) drafts.delete(drafts.keys().next().value!);
  listeners.forEach(listener=>listener());
}
export function stagePresentationDraft(input:{key:string;segments:StorySegment[];index:number;chars:number;complete:boolean;showing:boolean;elapsed:number;legacy:boolean}) {
  const {key,segments,index,chars,complete,showing,elapsed,legacy}=input;
  const old=drafts.get(key);
  if(old?.acceptedId) return;
  const text=old?.segments===segments ? old.node.aiResponse : segments.map(s=>s.type==='dialogue' ? '「'+(s.speaker ? s.speaker+'：' : '')+s.text+'」' : s.text).join('\n\n');
  const node=old?.segments===segments ? old.node : {id:key,parentId:null,aiResponse:text,playerVisibleText:text} as WorldLineNode;
  if(old?.segments!==segments) {
    const local=segments.map(s=>({...s,textEffects:s.textEffects?.filter(e=>!e.editRef && !e.effectId && (!e.nodeId || e.nodeId==='current')).map(e=>{const next={...e};delete next.nodeId;return next;})}));
    node.presentation=compilePresentation(node,local,{},legacy,false);
    if(old?.node.presentation) Object.assign(node.presentation,{read:old.node.presentation.read,fired:old.node.presentation.fired,armed:old.node.presentation.armed,motion:old.node.presentation.motion,order:old.node.presentation.order});
  }
  let nodes:{[key:string]:WorldLineNode}={[key]:node};
  const end=showing ? index : segments.length-1;
  for(let i=0;i<=end && i<segments.length;i++) nodes=advancePresentation(nodes,key,i,i<end || !showing ? segments[i].text.length : chars,i<end || !showing || complete,i===end ? elapsed : 0);
  if(old?.node.aiResponse===text && JSON.stringify(old.node.presentation)===JSON.stringify(nodes[key].presentation)) return;
  publish(key,{node:nodes[key],segments});
}
/** Only the authoritative cursor transfers a preview, never a secondary renderer. */
export function adoptPresentationDraft(key:string,node:WorldLineNode,nodes:Record<string,WorldLineNode>):Presentation | undefined {
  const draft=drafts.get(key),prior=draft?.node.presentation,current=node.presentation;
  if(!draft || !prior || !current || draft.acceptedId) return current;
  const next={...current,read:{...prior.read,...current.read},fired:{...current.fired},armed:{...current.armed},motion:{...current.motion},order:{...current.order}};
  const orderBase=Math.max(presentationCues(nodes,node.parentId).reduce((max,cue)=>Math.max(max,cue.order),0),node.entry ? node.entry.presentationOrder+node.entry.changes.length-1 : 0);
  for(const cue of current.cues) {
    const previous=prior.cues.find(c=>c.id.slice(c.owner.length)===cue.id.slice(cue.owner.length) && JSON.stringify(c.effect)===JSON.stringify(cue.effect));
    if(!previous) continue;
    if(prior.fired[previous.id]) next.fired[cue.id]=true;
    if(prior.armed[previous.id]!==undefined) next.armed[cue.id]=prior.armed[previous.id];
    if(prior.motion?.[previous.id]!==undefined) next.motion[cue.id]=prior.motion[previous.id];
    if(prior.order?.[previous.id]!==undefined) next.order[cue.id]=orderBase+prior.order[previous.id];
  }
  publish(key,{...draft,acceptedId:node.id});
  return next;
}
