import type { WorldLineNode } from '../types';
import { alteredText, type TextEffect } from '../text-effects';
import { cuesForTarget } from './runtime';
export interface ProjectedRun { text: string; effects: TextEffect[]; remainingMs?:number }
const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'});
const glyphs = (text:string) => Array.from(graphemes.segment(text),part=>part.segment);
/** All consumers, including search and clipboard, use actual replacement strings. */
export function projectRanges(text: string, ranges: Array<{ start: number; end: number; effect: TextEffect; remainingMs?:number }>): ProjectedRun[] {
  ranges=ranges.filter(range=>range.effect.kind!=='restore');
  const points = [...new Set([0, text.length, ...ranges.flatMap(r => [Math.max(0,r.start), Math.min(text.length,r.end)])])].filter(p => p >= 0 && p <= text.length).sort((a,b) => a-b);
  const output: ProjectedRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i+1], matching = ranges.filter(r => r.start <= start && r.end >= end);
    // Map replacement slices to the original reveal boundary. Emitting the complete value
    // here would leak unseen text in archives and bypass masks intersecting its later part.
    const replacement = matching.findLast(r => r.effect.kind === 'replace');
    const effects = matching.map(r => r.effect);
    const chunk = replacement ? glyphs(replacement.effect.value ?? '').slice(
      glyphs(text.slice(Math.max(0,replacement.start),start)).length,
      end >= replacement.end ? undefined : glyphs(text.slice(Math.max(0,replacement.start),end)).length,
    ).join('') : text.slice(start,end);
    output.push({ text: alteredText(chunk, effects.filter(e => e.kind !== 'replace')), effects, ...(matching.some(r=>r.remainingMs) ? {remainingMs:Math.max(...matching.map(r=>r.remainingMs ?? 0))} : {}) });
  }
  return output;
}
export function recordPresentationRuns(node: WorldLineNode, nodes: Record<string, WorldLineNode>, origin?: string | null): ProjectedRun[] {
  const raw = typeof node.playerVisibleText === 'string' ? node.playerVisibleText : node.generationComplete === false ? '' : node.aiResponse;
  return projectRanges(raw, cuesForTarget(nodes,origin,node.id).filter(c => c.active && c.field !== 'choice' && c.effect.kind !== 'dim').map(c => ({ start: c.start, end: c.end, effect: c.effect, remainingMs:c.remainingMs })));
}
export function recordPresentationText(node: WorldLineNode, nodes: Record<string, WorldLineNode>, origin?: string | null): string {
  return recordPresentationRuns(node,nodes,origin).map(r => r.text).join('');
}

export function presentationParagraphs(runs: ProjectedRun[]): Array<{ text: string; runs: ProjectedRun[] }> {
  const text = runs.map(r => r.text).join(''); let cursor = 0;
  return text.split(/\n\n+/).filter(Boolean).map(paragraph => {
    const start = text.indexOf(paragraph,cursor), end = start+paragraph.length; cursor = end;
    let offset = 0;
    const parts = runs.flatMap(run => {
      const left = Math.max(0,start-offset), right = Math.min(run.text.length,end-offset); offset += run.text.length;
      return right > left ? [{ ...run, text: run.text.slice(left,right) }] : [];
    });
    return { text: paragraph, runs: parts };
  });
}
export function slicePresentationRuns(runs:ProjectedRun[],start:number,end:number):ProjectedRun[] {
  let offset=0;
  return runs.flatMap(run=>{
    const left=Math.max(0,start-offset),right=Math.min(run.text.length,end-offset);offset+=run.text.length;
    return right>left ? [{...run,text:run.text.slice(left,right)}] : [];
  });
}
