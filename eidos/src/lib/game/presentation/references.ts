import type { StorySegment } from '@/lib/ai/types';
import type { TextEffect } from '../text-effects';

interface EditReference { nodeId:string; segment:number; expectedRevision:string }
/** A locator carries its original version without an extra mutable handle registry. */
export function presentationEditRef(ref:EditReference):string {
  return `ep1/${encodeURIComponent(ref.nodeId)}/${ref.segment}/${encodeURIComponent(ref.expectedRevision)}`;
}
export function parsePresentationEditRef(value:string):EditReference {
  const match=/^ep1\/([^/]+)\/(\d+)\/([^/]+)$/.exec(value);
  if(!match) throw new Error('编辑引用无效，请重新读取目标的 view:both');
  try {
    const nodeId=decodeURIComponent(match[1]),segment=Number(match[2]),expectedRevision=decodeURIComponent(match[3]);
    if(!nodeId || !Number.isSafeInteger(segment) || !expectedRevision) throw new Error();
    return {nodeId,segment,expectedRevision};
  } catch {throw new Error('编辑引用无效，请重新读取目标的 view:both');}
}
export function effectReference(effect:TextEffect):TextEffect {
  if(!effect.editRef) return effect;
  const ref=parsePresentationEditRef(effect.editRef);
  if(effect.nodeId!==undefined && effect.nodeId!==ref.nodeId || effect.segment!==undefined && effect.segment!==ref.segment || effect.expectedRevision!==undefined && effect.expectedRevision!==ref.expectedRevision) throw new Error('编辑引用与手动定位冲突，请只使用查询返回的 editRef');
  return {...effect,...ref};
}
export const presentationEffectOwner=(id:string)=>/^(.*):\d+:\d+$/.exec(id)?.[1];
/** CAS preparation and compilation must resolve the same references. */
export function presentationTargetNodes(segments:StorySegment[],parentId:string):string[] {
  return [...new Set(segments.flatMap(s=>(s.textEffects ?? []).flatMap(effect=>{
    let ref:TextEffect;try {ref=effectReference(effect);} catch {return [];}
    return [ref.nodeId && ref.nodeId!=='current' ? ref.nodeId==='previous' ? parentId : ref.nodeId : undefined,
      ref.effectId ? presentationEffectOwner(ref.effectId) : undefined].filter((id):id is string=>Boolean(id));
  })))];
}
