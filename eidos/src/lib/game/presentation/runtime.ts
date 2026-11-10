import type { WorldLineNode } from '../types';
import type { Presentation, PresentationCue, ResolvedCue } from './types';
import { DEFAULT_BRIGHTNESS_TRANSITION_MS, DIM_PULSE_MS } from './lighting';
import { actionEntryCues } from '../action-entry';
const cueCache = new WeakMap<Record<string,WorldLineNode>, Map<string,ResolvedCue[]>>();
const pathCache = new WeakMap<Record<string,WorldLineNode>, Map<string,WorldLineNode[]>>();
const pathIds = new WeakMap<WorldLineNode[],Set<string>>();
const targetCache = new WeakMap<ResolvedCue[],Map<string,ResolvedCue[]>>();

export function presentationPath(nodes: Record<string, WorldLineNode>, origin: string | null | undefined): WorldLineNode[] {
  const cache=pathCache.get(nodes) ?? new Map<string,WorldLineNode[]>(),key=origin ?? '';
  if (cache.has(key)) return cache.get(key)!;
  const path: WorldLineNode[] = [], seen = new Set<string>(); let id = origin;
  while (id && nodes[id] && !seen.has(id)) { seen.add(id); path.push(nodes[id]); id = nodes[id].parentId; }
  path.reverse();cache.set(key,path);pathCache.set(nodes,cache);return path;
}
export function cuesForTarget(nodes:Record<string,WorldLineNode>,origin:string | null | undefined,target:string):ResolvedCue[] {
  const path=presentationPath(nodes,origin),ids=pathIds.get(path) ?? new Set(path.map(n=>n.id));pathIds.set(path,ids);
  const cues=presentationCues(nodes,ids.has(target) ? origin : target);
  let index=targetCache.get(cues);
  if (!index) { index=new Map();for(const cue of cues) index.set(cue.targetNode,[...(index.get(cue.targetNode) ?? []),cue]);targetCache.set(cues,index); }
  return index.get(target) ?? [];
}
export function presentationCues(nodes: Record<string, WorldLineNode>, origin?: string | null): ResolvedCue[] {
  const key = origin ?? '', cache = cueCache.get(nodes) ?? new Map<string,ResolvedCue[]>();
  if (cache.has(key)) return cache.get(key)!;
  const path = presentationPath(nodes, origin), fired = Object.assign(Object.create(null), ...path.map(n => n.presentation?.fired ?? {}));
  const motion = Object.assign(Object.create(null),...path.map(n=>n.presentation?.motion ?? {}));
  const armed=Object.assign(Object.create(null),...path.map(n=>n.presentation?.armed ?? {}));
  const order=Object.assign(Object.create(null),...path.map(n=>n.presentation?.order ?? {}));
  const ids=new Set(path.map(n=>n.id));
  const declared = path.flatMap(n => [
    ...(n.entry ? actionEntryCues(n.entry,n.id).filter(c=>ids.has(c.targetNode)).map((c,i)=>({...c,clockArmed:false,remainingMs:0,active:false,cancelled:false,executed:true,order:n.entry!.presentationOrder+i})) : []),
    ...(n.presentation?.cues ?? []).map((c,i) => ({ ...c, clockArmed:armed[c.id]!==undefined,remainingMs: motion[c.id] ?? 0, active:false,cancelled:false,executed: Boolean(fired[c.id]) || c.effect.afterSegments === -1 && (c.targetNode === c.owner && c.segment === c.source || Boolean(n.presentation?.read[c.source])),order:order[c.id] ?? (n.entry ? n.entry.presentationOrder+n.entry.changes.length+i : undefined) })),
  ]).map((cue,index)=>({...cue,order:cue.order ?? index+1})).sort((a,b)=>a.order-b.order);
  const result=resolvePresentationCues(declared);
  cache.set(key,result); cueCache.set(nodes,cache); return result;
}
/** Reverse resolution lets an undo be undone without mutating either earlier event. */
export function resolvePresentationCues(cues:ResolvedCue[]):ResolvedCue[] {
  const disabled=new Set<string>(),result=cues.map(c=>({...c}));
  for(let i=result.length-1;i>=0;i--) {
    const cue=result[i];cue.cancelled=disabled.has(cue.id);cue.active=cue.executed && !cue.cancelled;
    if(cue.cancelled) {cue.clockArmed=false;cue.remainingMs=0;}
    if(cue.active && cue.effect.kind==='restore' && cue.effect.effectId) disabled.add(cue.effect.effectId);
  }
  return result;
}
export function presentationRevision(node: WorldLineNode,nodes: Record<string,WorldLineNode>,origin?: string | null): string {
  const text = JSON.stringify([node.segmentHash || node.aiResponse,presentationCues(nodes,origin ?? node.id).filter(c => c.active && c.targetNode === node.id).map(c => c.id)]);
  let hash = 2166136261; for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
  return (hash >>> 0).toString(36);
}
function ready(cue: PresentationCue, path: WorldLineNode[]): boolean {
  const ownerIndex = path.findIndex(n => n.id === cue.owner), owner = path[ownerIndex];
  const source = owner?.presentation?.read[cue.source];
  const after = cue.effect.afterSegments;
  if (after === -1) return Boolean(source);
  if (after && after > 0) {
    let count = 0;
    for (let i = ownerIndex; i < path.length; i++) for (const index of Object.keys(path[i].presentation?.replicaOf ? {} : path[i].presentation?.read ?? {}).map(Number).sort((a,b) => a-b)) {
      if (i === ownerIndex && index <= cue.source) continue;
      if (++count >= after) return true;
    }
    return false;
  }
  if (cue.effect.progress === 'typing') return Boolean(source);
  if (after === 0) return Boolean(source?.complete);
  // Existing packages trigger when their exact quote is revealed, rather than at segment end.
  if (cue.field === 'text' && cue.owner === cue.targetNode && cue.source === cue.segment) {
    const range = owner?.presentation?.ranges[cue.source];
    return Boolean(source && range && source.chars >= cue.end - range.textStart);
  }
  return Boolean(source?.complete);
}
export function advancePresentation<T extends Record<string, WorldLineNode>>(nodes: T, origin: string, segment: number, chars: number, complete: boolean, elapsedMs: number): T {
  const node = nodes[origin]; if (!node?.presentation) return nodes;
  const previous = node.presentation.read[segment];
  const read: Presentation['read'] = { ...node.presentation.read, [segment]: { chars: Math.max(previous?.chars ?? 0, chars), complete: complete || Boolean(previous?.complete) } };
  const next: Record<string,WorldLineNode> = { ...nodes, [origin]: { ...node, presentation: { ...node.presentation, read, fired: { ...node.presentation.fired }, armed: { ...node.presentation.armed },motion:{...node.presentation.motion},order:{...node.presentation.order} } } };
  const current = next[origin].presentation!, path = presentationPath(next, origin);
  const armedBefore = Object.assign(Object.create(null), ...path.map(n => n.presentation?.armed ?? {})) as Record<string, number>;
  const firedBefore = Object.assign(Object.create(null),...path.map(n=>n.presentation?.fired ?? {}));
  let cues=presentationCues(next,origin);
  let sequence=cues.reduce((max,cue)=>Math.max(max,cue.order),0)+1;
  // Finish old motion updates first: a later restore must be the final write for its target.
  for (const cue of cues) {
    if (cue.remainingMs>0 && elapsedMs>0) current.motion![cue.id]=Math.max(0,cue.remainingMs-elapsedMs);
  }
  let firstPass=true,settle=true;
  while(settle) {
    settle=false;
    for (const cue of cues) {
      if (cue.source===-1 || firedBefore[cue.id] || current.fired[cue.id] || cue.cancelled || !ready(cue, path)) continue;
      const delay = cue.effect.delayMs ?? 0;
      const elapsed=firstPass ? (armedBefore[cue.id] ?? 0)+Math.max(0,elapsedMs) : current.armed[cue.id] ?? armedBefore[cue.id] ?? 0;
      current.armed[cue.id] = elapsed;
      if (elapsed >= delay) {
        current.fired[cue.id] = true;
        current.order![cue.id]=sequence++;
        if(cue.effect.kind==='restore' && cue.effect.effectId) {current.motion![cue.effect.effectId]=0;settle=true;}
        if (cue.effect.kind==='fracture') current.motion![cue.id]=640;
        if (cue.effect.kind==='dim') current.motion![cue.id]=cue.effect.brightness===undefined ? DIM_PULSE_MS : cue.effect.afterSegments===-1 ? 0 : cue.effect.transitionMs ?? DEFAULT_BRIGHTNESS_TRANSITION_MS;
      }
    }
    // An undo can re-enable a due event. Settle it now without consuming another tick.
    if(settle) {cueCache.delete(next);cues=presentationCues(next,origin);}
    firstPass=false;
  }
  const changed = !previous || previous.chars !== read[segment].chars || previous.complete !== read[segment].complete || JSON.stringify(current.fired) !== JSON.stringify(node.presentation.fired) || JSON.stringify(current.armed) !== JSON.stringify(node.presentation.armed) || JSON.stringify(current.motion) !== JSON.stringify(node.presentation.motion ?? {});
  cueCache.delete(next);
  return (changed ? next : nodes) as T;
}
