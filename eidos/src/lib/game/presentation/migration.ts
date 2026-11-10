import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '../types';
import { inlineDocumentTokens } from '../documents/inline-links';
import { textEffectRuns } from '../text-effects';
import { segmentRanges } from './compile';
import type { Presentation } from './types';

export function arrivalPresentation(source:Presentation,from:string,to:string):Presentation {
  const local=source.cues.filter(c=>c.targetNode===from),ids=new Map(local.map(c=>[c.id,to+c.id.slice(from.length)]));
  const cues=local.map(c=>({...c,id:ids.get(c.id)!,owner:to,targetNode:to,
    effect:{...c.effect,...(c.effect.effectId && ids.has(c.effect.effectId) ? {effectId:ids.get(c.effect.effectId)!} : {})}}));
  const remap=<T>(values:Record<string,T>)=>Object.fromEntries(cues.flatMap(c=>{
    const key=from+c.id.slice(to.length);return values[key]===undefined ? [] : [[c.id,values[key]]];
  }));
  return {...source,replicaOf:from,cues,read:structuredClone(source.read),fired:remap(source.fired),armed:remap(source.armed),order:remap(source.order ?? {}),motion:{}};
}

/** Pinned document IDs can grow on import. They are markup, not newly read letters. */
function relocatedOffset(before:string,after:string,offset:number):number {
  const old=inlineDocumentTokens(before),next=inlineDocumentTokens(after);let delta=0;
  for(let i=0;i<old.length && i<next.length;i++) {
    if(offset<=old[i].start) break;
    if(offset<old[i].end) return next[i].start+Math.min(offset-old[i].start,next[i].label.length+1);
    delta+=(next[i].end-next[i].start)-(old[i].end-old[i].start);
  }
  return Math.min(after.length,offset+delta);
}
export function reindexPresentations(nodes:Record<string,WorldLineNode>,segments:Record<string,StorySegment[]>,before:Record<string,WorldLineNode>):Record<string,WorldLineNode> {
  const next={...nodes};
  for(const node of Object.values(nodes)) {
    if(!node.presentation) continue;
    const prose=segments[node.id];if(!prose) throw new Error('演出段落缺失，无法重建显示范围');
    const ranges=segmentRanges(prose),prior=before[node.id];
    const read=Object.fromEntries(Object.entries(node.presentation.read).map(([key,value])=>{
      const index=Number(key),old=prior?.presentation?.ranges[index],range=ranges[index];
      return [key,{...value,chars:!range ? 0 : value.complete ? range.textEnd-range.textStart : old ? relocatedOffset(prior.aiResponse.slice(old.textStart,old.textEnd),node.aiResponse.slice(range.textStart,range.textEnd),value.chars) : value.chars}];
    }));
    next[node.id]={...node,presentation:{...node.presentation,ranges,read},...(prior?.playerVisibleText===undefined ? {} : {playerVisibleText:node.aiResponse.slice(0,relocatedOffset(prior.aiResponse,node.aiResponse,prior.playerVisibleText.length))})};
  }
  for(const node of Object.values(next)) {
    const relocate=<T extends {targetNode:string;segment:number;field:import('../text-effects').TextEffectTarget;effect:import('../text-effects').TextEffect;start:number;end:number}>(cue:T):T=>{
      const target=next[cue.targetNode];
      const range=target?.presentation?.ranges[cue.segment] ?? (segments[cue.targetNode] ? segmentRanges(segments[cue.targetNode])[cue.segment] : undefined);
      if(!target || !range) throw new Error('演出目标缺失，无法恢复显示范围');
      if(cue.field==='choice') return {...cue,start:0,end:cue.effect.quote?.length ?? 0};
      const base=cue.field==='speaker' ? range.speakerStart : range.textStart;
      const text=target.aiResponse.slice(base,cue.field==='speaker' ? range.speakerEnd : range.textEnd);
      const run=textEffectRuns(text,[cue.effect],cue.field)[0];
      if(!run && cue.effect.kind!=='dim') throw new Error('演出原文不匹配，无法恢复显示范围');
      return {...cue,start:base+(run?.start ?? 0),end:base+(run?.end ?? text.length)};
    };
    if(node.presentation) node.presentation.cues=node.presentation.cues.map(relocate);
    // An independent subtree retains external provenance without executing it.
    if(node.entry) next[node.id]={...node,entry:{...node.entry,changes:node.entry.changes.map(cue=>next[cue.targetNode] ? relocate(cue) : cue)}};
  }
  return next;
}
