import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '../types';
import { parseTextEffects,textEffectRuns } from '../text-effects';
import { cuesForTarget } from './runtime';
import { projectRanges } from './projection';
import { getPresentationDraft } from './drafts';

export function presentedSpeech(segment:StorySegment,nodes:Record<string,WorldLineNode>,origin?:string | null,nodeId?:string,index?:number,draftKey?:string):StorySegment {
  const draft=getPresentationDraft(draftKey),staged=draft && !nodes[nodeId ?? ''] && (!draft.acceptedId || draft.acceptedId!==nodeId) ? draft.node : undefined;
  const target=staged ?? nodes[nodeId ?? origin ?? ''];
  const candidates=target?.presentation?.ranges ?? [];
  const matches=(i:number)=>candidates[i] && target.aiResponse.slice(candidates[i].textStart,candidates[i].textEnd)===segment.text;
  const found=index!==undefined && matches(index) ? index : candidates.findIndex((_,i)=>matches(i));
  const range=candidates[found];
  const active=range ? cuesForTarget(staged ? {[staged.id]:staged} : nodes,staged?.id ?? origin,target.id).filter(c=>c.active && c.field==='text' && c.segment===found).map(c=>({start:c.start-range.textStart,end:c.end-range.textStart,effect:c.effect}))
    : textEffectRuns(segment.text,(parseTextEffects(segment.textEffects) ?? []).filter(e=>e.afterSegments===-1 && !e.nodeId),'text').flatMap(r=>r.effects.map(effect=>({start:r.start,end:r.end,effect})));
  const text=projectRanges(segment.text,active).map(run=>run.effects.some(e=>['mask','erase','garble'].includes(e.kind)) ? '' : run.text).join('');
  return {...segment,text};
}
