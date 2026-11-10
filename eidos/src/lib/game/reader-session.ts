import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from './types';
import { getPlayerVisibleText,getReadingPath } from './player-reading';
import { recordPresentationText,segmentRanges,cuesForTarget,projectRanges } from './presentation';

export interface ReadingView { nodeId:string; originId:string; segmentIndex:number }
export interface ReadingReference { nodeId:string; originId:string; segmentIndex:number; sourceText:string; displayText:string }
type ReadingSource={readingView:ReadingView|null;readingSegments?:StorySegment[]|null;allNodes:Record<string,WorldLineNode>;currentNode:WorldLineNode|null};

export function parseReadingView(value:unknown):ReadingView|null {
 if(!value || typeof value!=='object') return null;
 const v=value as ReadingView;
 return typeof v.nodeId==='string' && typeof v.originId==='string' && Number.isSafeInteger(v.segmentIndex) && v.segmentIndex>=0
  ? {nodeId:v.nodeId,originId:v.originId,segmentIndex:v.segmentIndex} : null;
}
export function readSegments(node:WorldLineNode,segments:StorySegment[]):StorySegment[] {
 const end=getPlayerVisibleText(node).length,ranges=segmentRanges(segments);
 return segments.flatMap((segment,index)=>{
  const range=ranges[index];if(range.textStart>=end) return [];
  return [{...segment,text:segment.text.slice(0,Math.max(0,end-range.textStart))}];
 });
}
export function readingOrigin(source:ReadingSource):string|undefined {
 const view=source.readingView;if(!view) return source.currentNode?.id;
 const path=getReadingPath(source.allNodes,source.currentNode?.id ?? null);
 return path.some(n=>n.id===view.originId) && path.some(n=>n.id===view.nodeId) ? source.currentNode?.id : view.originId;
}
export function readingReference(source:ReadingSource):ReadingReference|undefined {
 const view=source.readingView,node=view && source.allNodes[view.nodeId],originId=readingOrigin(source);
 if(!view || !node || !originId || !getPlayerVisibleText(node)) return;
 const range=(node.presentation?.ranges ?? (source.readingSegments ? segmentRanges(source.readingSegments) : []))[view.segmentIndex];
 const sourceText=range ? getPlayerVisibleText(node).slice(range.textStart,range.textEnd) : getPlayerVisibleText(node);
 const displayText=range ? projectRanges(sourceText,cuesForTarget(source.allNodes,originId,node.id).filter(c=>c.active && c.field==='text' && c.segment===view.segmentIndex).map(c=>({start:c.start-range.textStart,end:c.end-range.textStart,effect:c.effect}))).map(r=>r.text).join('') : recordPresentationText(node,source.allNodes,originId);
 return {nodeId:node.id,originId,segmentIndex:view.segmentIndex,sourceText,displayText};
}
