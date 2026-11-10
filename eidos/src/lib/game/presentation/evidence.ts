import type { WorldLineNode } from '../types';
import type { ResolvedCue,PresentationEvidenceItem } from './types';
import { resolvePresentationCues } from './runtime';
import { projectRanges } from './projection';
import { DEFAULT_BRIGHTNESS_TRANSITION_MS } from './lighting';
import { getPlayerVisibleText } from '../player-reading';

function readableEvidence(cue:ResolvedCue,nodes:Record<string,WorldLineNode>) {
  const owner=nodes[cue.owner],source=owner?.presentation?.ranges[cue.source],target=nodes[cue.targetNode];
  if(cue.source===-1) {
    const range=target?.presentation?.ranges[cue.segment];
    return Boolean(owner && target && range && range.end<=getPlayerVisibleText(target).length);
  }
  if(!owner || !source || source.end>getPlayerVisibleText(owner).length || !target) return false;
  return cue.field!=='choice' || getPlayerVisibleText(target).length>=target.aiResponse.length;
}

function shownAt(cue:ResolvedCue,nodes:Record<string,WorldLineNode>,cues:ResolvedCue[]) {
  const node=nodes[cue.targetNode],range=node?.presentation?.ranges[cue.segment];
  if(!node || !range) return '';
  const base=cue.field==='speaker' ? range.speakerStart : range.textStart;
  const readEnd=getPlayerVisibleText(node).length;
  const raw=cue.field==='choice' ? cue.effect.quote ?? '' : node.aiResponse.slice(base,Math.min(readEnd,cue.field==='speaker' ? range.speakerEnd : range.textEnd));
  const active=resolvePresentationCues(cues).filter(c=>c.active && c.targetNode===node.id && c.segment===cue.segment && c.field===cue.field && (c.field!=='choice' || c.effect.quote===raw));
  return projectRanges(raw,active.map(c=>({start:c.field==='choice' ? 0 : c.start-base,end:c.field==='choice' ? raw.length : c.end-base,effect:c.effect}))).map(run=>run.text).join('');
}
/** Comparison text is derived on demand; immutable source and event IDs remain authoritative. */
export function presentationEvidence(node:WorldLineNode,nodes:Record<string,WorldLineNode>,cues:ResolvedCue[],offset=0) {
  const related=cues.filter(c=>(c.owner===node.id || c.targetNode===node.id) && readableEvidence(c,nodes)).toReversed();
  const end=Math.min(related.length,offset+8);
  const presentation=related.slice(offset,end).map<PresentationEvidenceItem>(cue=>{
    const before=cue.executed ? shownAt(cue,nodes,cues.filter(c=>c.order<cue.order)) : undefined;
    const after=cue.executed ? shownAt(cue,nodes,cues.filter(c=>c.order<=cue.order)) : undefined;
    return {id:cue.id,kind:cue.effect.kind,targetNode:cue.targetNode,segment:cue.segment,target:cue.field,
      ...(cue.effect.quote ? {quote:cue.effect.quote.slice(0,120),occurrence:cue.effect.occurrence ?? 1} : {wholeField:true}),
      ...(cue.effect.value===undefined ? {} : {value:cue.effect.value.slice(0,120)}),
      ...(cue.effect.brightness===undefined ? {} : {brightness:cue.effect.brightness,transitionMs:cue.effect.transitionMs ?? DEFAULT_BRIGHTNESS_TRANSITION_MS}),
      ...((cue.effect.quote?.length ?? 0)>120 || (cue.effect.value?.length ?? 0)>120 ? {detailsPartial:true} : {}),
      state:cue.cancelled ? 'cancelled' as const : cue.active ? 'applied' as const : 'pending' as const,
      ...(cue.effect.effectId ? {effectId:cue.effect.effectId} : {}),
      ...(before===undefined ? {} : {beforeText:before.slice(0,200),afterText:after!.slice(0,200),partial:before.length>200 || after!.length>200})};
  });
  return {presentation,presentationTotal:related.length,presentationNextOffset:end<related.length ? end : null};
}
