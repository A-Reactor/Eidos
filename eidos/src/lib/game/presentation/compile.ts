import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '../types';
import { parseTextEffects, textEffectRuns, type TextEffect } from '../text-effects';
import type { Presentation, PresentationCue, SegmentRange } from './types';
import { presentationRevision,presentationCues } from './runtime';
import { effectReference } from './references';
import { getPlayerVisibleText } from '../player-reading';

export function segmentRanges(segments: Pick<StorySegment, 'type' | 'text' | 'speaker'>[]): SegmentRange[] {
  let offset = 0;
  return segments.map(s => {
    const prefix = s.type === 'dialogue' ? '「' + (s.speaker ? s.speaker + '：' : '') : '';
    const range = { start: offset, textStart: offset + prefix.length, textEnd: offset + prefix.length + s.text.length,
      end: offset + prefix.length + s.text.length + Number(s.type === 'dialogue'), speakerStart: offset + 1, speakerEnd: offset + 1 + (s.speaker?.length ?? 0) };
    offset = range.end + 2; return range;
  });
}
export function compilePresentation(node: WorldLineNode, segments: StorySegment[], nodes: Record<string, WorldLineNode>, legacyTiming = false, atomic = true): Presentation {
  const p: Presentation = { version: 1, ranges: segmentRanges(segments), cues: [], errors: [], read: {}, fired: {}, armed: {} };
  if (!segments.some(s=>s.textEffects?.length)) return p;
  // Entry receipts already exist when the body starts. Model references must use
  // the same receipt IDs and revision both before and after accepting the reply.
  const contextNodes=node.entry ? {...nodes,[node.id]:{...node,presentation:undefined}} : nodes;
  const contextOrigin=node.entry ? node.id : node.parentId;
  const ancestors = new Set<string>(); let cursor = node.parentId;
  let historicalFailure=false;
  const historicalIds=new Set<string>();
  while (cursor && nodes[cursor] && !ancestors.has(cursor)) { ancestors.add(cursor); cursor = nodes[cursor].parentId; }
  segments.forEach((s, source) => (parseTextEffects(s.textEffects) ?? []).forEach((declaration, index) => {
    let effect:TextEffect,restored:PresentationCue | undefined;
    const declaredHistorical=Boolean(declaration.editRef || declaration.effectId || declaration.nodeId && !['current',node.id].includes(declaration.nodeId));
    const fail=(message:string,historical=declaredHistorical)=>{p.errors.push(`第${source+1}段：${message}`);historicalFailure ||= historical;};
    try {
      effect=effectReference(declaration);
      if(effect.kind==='restore') {
        const id=effect.effectId;
        restored=[...presentationCues(contextNodes,contextOrigin),...p.cues].find(c=>c.id===id);
        if(!restored) throw new Error('撤销目标不存在或不属于当前经历，请读取 view:both 返回的真实演出 ID');
        effect={...effect,nodeId:restored.targetNode,segment:restored.segment,target:restored.field,quote:restored.effect.quote,occurrence:restored.effect.occurrence};
      }
    } catch(error) {fail((error as Error).message);return;}
    const targetId = effect.nodeId === 'previous' ? node.parentId : !effect.nodeId || effect.nodeId === 'current' ? node.id : effect.nodeId;
    const target = targetId === node.id ? node : targetId ? nodes[targetId] : undefined;
    const segment = effect.segment ?? source, field = effect.target ?? 'text';
    const ranges = targetId === node.id ? p.ranges : target?.presentation?.ranges ?? (target ? segmentRanges([{ type: 'narration', text: target.aiResponse }]) : []);
    const range = ranges[segment];
    const historical=targetId!==node.id;
    if (!target || !range || historical && (!ancestors.has(target.id) || range.end > getPlayerVisibleText(target).length)) { fail('目标不存在、未读或不属于当前经历',historical); return; }
    const original = field === 'choice' ? effect.quote ?? '' : target.aiResponse.slice(field === 'speaker' ? range.speakerStart : range.textStart, field === 'speaker' ? range.speakerEnd : range.textEnd);
    if (effect.expectedText !== undefined && effect.expectedText !== original) { fail('目标原文版本已变化',historical); return; }
    if (effect.expectedRevision !== undefined && effect.expectedRevision !== presentationRevision(target,contextNodes,contextOrigin)) { fail('目标呈现版本已变化',historical); return; }
    const local = { ...effect, ...(!legacyTiming && effect.afterSegments===undefined ? {afterSegments:0} : {}) }; delete local.nodeId; delete local.segment; delete local.expectedText; delete local.expectedRevision;delete local.editRef;
    const base = field === 'speaker' ? range.speakerStart : range.textStart;
    const run = restored ? {start:restored.start-base,end:restored.end-base} : textEffectRuns(original, [local], field)[0];
    if (!run && effect.kind !== 'dim') { fail('找不到目标短语',historical); return; }
    if(historical) historicalIds.add(`${node.id}:${source}:${index}`);
    p.cues.push({ id: `${node.id}:${source}:${index}`, owner: node.id, source, targetNode: target.id, segment, field,
      start: field === 'choice' ? 0 : base + (run?.start ?? 0), end: field === 'choice' ? original.length : base + (run?.end ?? 0), effect: local });
  }));
  // Historical edits form one transaction. An unrelated local decoration may fail
  // independently; it must not cancel an otherwise valid restoration of the past.
  if (atomic && historicalFailure) p.cues=p.cues.filter(c=>!historicalIds.has(c.id));
  return p;
}
