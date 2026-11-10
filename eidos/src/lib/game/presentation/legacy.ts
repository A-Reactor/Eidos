import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '../types';
import { loadBlob } from '../cas-storage';
import { compilePresentation } from './compile';
import { getPlayerVisibleText } from '../player-reading';

export function legacyPresentation(node:WorldLineNode,segments:StorySegment[],nodes:Record<string,WorldLineNode>) {
  const presentation=compilePresentation(node,segments,nodes,true);
  const end=getPlayerVisibleText(node).length;
  presentation.ranges.forEach((range,index)=>{
    if(range.start<end) presentation.read[index]={chars:Math.max(0,Math.min(range.textEnd,end)-range.textStart),complete:range.end<=end};
  });
  for(const cue of presentation.cues) if(cue.effect.afterSegments===undefined && (cue.field==='choice' ? end>=node.aiResponse.length : cue.end<=end)) presentation.fired[cue.id]=true;
  return presentation;
}
export async function indexLegacyPresentations(nodes:Record<string,WorldLineNode>,ids:string[]) {
  let next=nodes;
  for(const id of new Set(ids)) {
    const node=next[id];if(!node || node.presentation || !node.segmentHash) continue;
    const segments=await loadBlob(node.segmentHash) as StorySegment[] | null;
    if(!segments?.length) throw new Error('历史段落缺失，无法恢复文字演出');
    next={...next,[id]:{...node,presentation:legacyPresentation(node,segments,next)}};
  }
  return next;
}
