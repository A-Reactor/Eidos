import type { WorldLineNode,WorldSnapshot } from './types';
import type { ObserverChange } from './presentation/observer';
import type { PresentationCue } from './presentation/types';

/** State inherited before an action, separate from effects revealed by its prose. */
export interface ActionEntry {
 version:1;
 id:string;
 sourceNodeId:string;
 originNodeId:string;
 changes:ObserverChange[];
 presentationOrder:number;
 snapshotHash:string;
}
export interface ActionEntryDraft extends Omit<ActionEntry,'snapshotHash'> {snapshot:WorldSnapshot}
export interface ActionNodeOptions {
 reuseExisting?:boolean;
 parentNodeId?:string;
 expectedHeadId?:string;
 entry?:ActionEntryDraft;
 isCurrent?:()=>boolean;
}

export function actionEntryCues(entry:Omit<ActionEntry,'snapshotHash'>,owner:string):PresentationCue[] {
 const ids=new Map(entry.changes.map((c,i)=>[c.sourceEventId,`${entry.id}:${i}`]));
 return entry.changes.map((c,i)=>({...c,id:`${entry.id}:${i}`,owner,source:-1,
  effect:{...c.effect,afterSegments:-1,delayMs:0,...(c.effect.effectId && ids.has(c.effect.effectId) ? {effectId:ids.get(c.effect.effectId)} : {})}}));
}

/** A request-local view of the existing source; it never adds a story node. */
export function overlayActionEntry(nodes:Record<string,WorldLineNode>,target:string,entry:ActionEntryDraft):Record<string,WorldLineNode> {
 const node=nodes[target],p=node.presentation!;
 const cues=actionEntryCues(entry,target);
 return {...nodes,[target]:{...node,presentation:{...p,cues:[...p.cues,...cues],
  fired:{...p.fired,...Object.fromEntries(cues.map(c=>[c.id,true as const]))},
  order:{...p.order,...Object.fromEntries(cues.map((c,i)=>[c.id,entry.presentationOrder+i]))}}}};
}
