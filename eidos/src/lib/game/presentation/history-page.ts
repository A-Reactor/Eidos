import type { WorldLineNode } from '../types';
import type { HistoryReadRequest,HistoryReadResult } from '../history-reader';
import { recordPresentationText,projectRanges } from './projection';
import { cuesForTarget,presentationCues,presentationRevision } from './runtime';
import { presentationEditRef } from './references';
import { presentationEvidence } from './evidence';
import { getPlayerVisibleText } from '../player-reading';
const PAGE=12000;
export function presentationHistoryPage(node:WorldLineNode,nodes:Record<string,WorldLineNode>,origin:string | undefined,request:HistoryReadRequest,original:HistoryReadResult):HistoryReadResult {
  if(!request.view || request.view==='source') return original;
  const display=recordPresentationText(node,nodes,origin),offset=request.offset ?? 0,end=Math.min(display.length,offset+PAGE);
  if(request.view==='both' && original.error) return original;
  if(request.view==='display' && offset>=display.length) return {...original,error:'偏移已超出当前显示文本长度',totalChars:display.length};
  const targetCues=cuesForTarget(nodes,origin,node.id),all=presentationCues(nodes,origin),revision=presentationRevision(node,nodes,origin);
  let displayBudget=PAGE;
  const segments=request.view==='both' ? node.presentation?.ranges.flatMap((range,index)=>{
    const readEnd=getPlayerVisibleText(node).length;
    if(range.start>=readEnd || range.textEnd<offset || range.textStart>=offset+PAGE) return [];
    const left=Math.max(range.textStart,offset),right=Math.min(range.textEnd,readEnd,offset+PAGE);
    const raw=node.aiResponse.slice(range.textStart,Math.min(range.textEnd,readEnd));
    const shown=projectRanges(raw,targetCues.filter(c=>c.active && c.segment===index && c.field==='text').map(c=>({start:c.start-range.textStart,end:c.end-range.textStart,effect:c.effect}))).map(run=>run.text).join('');
    const excerpt=shown.slice(0,displayBudget);displayBudget-=excerpt.length;
    return [{index,text:node.aiResponse.slice(left,right),display:excerpt,speaker:node.aiResponse.slice(range.speakerStart,Math.min(range.speakerEnd,readEnd)),partial:left!==range.textStart || right!==range.textEnd || excerpt.length!==shown.length,
      ...(range.end<=readEnd && original.onCurrentPath!==false ? {editRef:presentationEditRef({nodeId:node.id,segment:index,expectedRevision:revision}),editTarget:{nodeId:node.id,segment:index,expectedRevision:revision}} : {})}];
  }) : undefined;
  const {error:_sourceError,...base}=original;
  return {...base,...(request.view==='display' ? {text:display.slice(offset,end),offset,totalChars:display.length,nextOffset:end<display.length ? end : null} : {}),
    displayText:display.slice(offset,end),displayTotalChars:display.length,displayNextOffset:end<display.length ? end : null,
    presentationRevision:revision,presentationErrors:node.presentation?.errors,segments,
    ...presentationEvidence(node,nodes,all,request.presentationOffset),
  };
}
