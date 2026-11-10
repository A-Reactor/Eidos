'use client';

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { InlineDocumentText } from './InlineDocumentText';
import { inlineTextTokens } from '@/lib/game/web-citations';
import type { WebSource } from '@/lib/game/web-context';
import { useGameStore } from '@/store/game-store';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { parseTextEffects, textEffectRuns, type TextEffect, type TextEffectTarget } from '@/lib/game/text-effects';
import { getPresentationDraft, subscribePresentationDrafts, cuesForTarget, projectRanges, slicePresentationRuns, type ProjectedRun } from '@/lib/game/presentation';

export function EffectText({ runs, renderText = text => text, animate = false, documents = true, webSources = true, searchSources, sourceComplete = true }: { runs: ProjectedRun[]; renderText?(text: string): React.ReactNode; animate?: boolean; documents?:boolean; webSources?:boolean; searchSources?: WebSource[]; sourceComplete?: boolean }) {
  const all = runs.map(r=>r.text).join('');
  if (documents && (inlineTextTokens(all, webSources).length || webSources && searchSources?.length)) {
    const render=(text:string,offset:number)=><EffectText runs={slicePresentationRuns(runs,offset,offset+text.length)} renderText={renderText} animate={animate} documents={false} />;
    return <InlineDocumentText text={all} webSources={webSources} searchSources={searchSources} sourceComplete={sourceComplete} renderText={render} renderLabel={render} />;
  }
  return <>{runs.map((run, index) => {
    if (!run.effects.length) return <Fragment key={index}>{renderText(run.text)}</Fragment>;
    const byKind = new Map(run.effects.map(e => [e.kind, e]));
    const classes = [...byKind.values()].filter(e => !['replace', 'dim'].includes(e.kind)).map(e => e.kind === 'color' || e.kind === 'size' ? `is-${e.kind}-${e.value}` : `is-${e.kind}`);
    return <span key={index} className={`eidos-text-effect ${classes.join(' ')}`} data-static={!(animate && run.remainingMs) || undefined} style={run.remainingMs ? { animationDelay: `${run.remainingMs-640}ms`,animationPlayState:'paused' } : undefined}>
      <span className="eidos-text-effect__letters">{renderText(run.text)}</span>
      {byKind.get('aside') && <small className="eidos-text-effect__aside">{byKind.get('aside')!.value}</small>}
    </span>;
  })}</>;
}

// Draft previews have no saved node yet. This small session cache prevents remounting a
// secondary view from revealing an already altered draft; accepted cues live on nodes.
const draftFired = new Map<string, Set<string>>();
function stableOccurrence(occurrence:string) {
  try { const parsed=JSON.parse(occurrence);if (Array.isArray(parsed) && parsed.length===3) return `${parsed[1]}:${parsed[2]}`; } catch { /* Non-JSON passage identities are already stable. */ }
  return occurrence;
}
function DraftText({ text, source, effects, target, identity, sourceComplete, settled=false, searchSources }: { text: string; source: string; effects: TextEffect[]; target: TextEffectTarget; identity: string; sourceComplete: boolean; settled?:boolean; searchSources?: WebSource[] }) {
  const [, refresh] = useState(0);
  const candidates = useMemo(() => textEffectRuns(source, effects.filter(e => !e.nodeId && e.segment === undefined && (sourceComplete || target !== 'text' || e.quote || (e.afterSegments===-1 || e.progress==='typing'))), target), [source, effects, target, sourceComplete]);
  const ids = candidates.flatMap(run => run.effects.map(effect => ({ run, effect, id: `${run.start}:${JSON.stringify(effect)}` })));
  const signature = JSON.stringify(ids.map(e => e.id));
  useEffect(() => {
    let fired = draftFired.get(identity);
    if (!fired) { fired = new Set(); draftFired.set(identity,fired); if (draftFired.size > 512) draftFired.delete(draftFired.keys().next().value!); }
    const timers = ids.filter(({ run,effect,id }) => !fired!.has(id) && (effect.afterSegments ?? 0) <= 0 && (effect.afterSegments === -1 || effect.progress === 'typing' || (effect.afterSegments!==0 || sourceComplete && text===source) && text.length >= run.end)).map(({ effect,id }) => setTimeout(() => { fired!.add(id); refresh(n => n+1); }, effect.delayMs ?? 0));
    return () => timers.forEach(clearTimeout);
    // Streaming appends do not restart an already armed exact-phrase timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, signature, sourceComplete, text===source, ids.every(({run}) => text.length >= run.end)]);
  const active = ids.filter(({ run,effect,id }) => settled || draftFired.get(identity)?.has(id) || (effect.afterSegments === -1 || effect.progress === 'typing') && text.length > run.start || (effect.delayMs ?? 0) === 0 && (effect.afterSegments ?? 0) <= 0 && (effect.afterSegments!==0 || sourceComplete && text===source) && text.length >= run.end);
  return <EffectText animate searchSources={searchSources} sourceComplete={sourceComplete && text.length >= source.length} webSources={target==='text'} runs={projectRanges(text, active.map(({run,effect}) => ({...run,effect:effect.kind==='replace' && text.length<run.end ? {...effect,value:effect.value?.slice(0,Math.max(0,text.length-run.start))} : effect})))} />;
}

/** Rendered content is a projection; transparent DOM text never contains the hidden original. */
export function NarrativeText({ text, source = text, effects, target = 'text', occurrence, sourceComplete = true, parseDocuments = true, nodeId, segmentIndex, playbackKey, animate = false, originId, searchSources }: {
  searchSources?: WebSource[]; parseDocuments?: boolean; text: string; source?: string; effects?: TextEffect[]; target?: TextEffectTarget; occurrence?: string; sourceComplete?: boolean; nodeId?: string | null; segmentIndex?: number; playbackKey?:string; animate?:boolean; originId?:string;
}) {
  const world = useGameStore(s => s.currentWorld), flags = useGameStore(s => s.worldFlags), sceneId = useGameStore(s => s.currentSceneId);
  const current = useGameStore(s => s.currentNode), nodes = useGameStore(s => s.allNodes), playthrough = useGameStore(s => s.currentPlaythroughId);
  const enabled = world?.gameplayPlugins?.some(p => p.ui?.presentation === 'native-text' && isGameplayPluginActive(p,flags,sceneId));
  const legacyTiming=world?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text' && /^0\.[0-3](\.|$)/.test(p.release ?? ''));
  const draft=useSyncExternalStore(subscribePresentationDrafts,()=>getPresentationDraft(playbackKey),()=>undefined);
  // A page handoff may retain the previous preview key for one render. An explicit
  // saved target always owns its projection; previews cannot replace its history.
  const staged=draft && !nodes[nodeId ?? ''] && (!draft.acceptedId || draft.acceptedId!==nodeId) ? draft.node : undefined;
  const id=staged?.id ?? (nodeId === undefined ? current?.id : nodeId ?? undefined), node=staged ?? (id ? nodes[id] : undefined);
  const viewNodes=staged ? {[staged.id]:staged} : nodes;
  const inferred = segmentIndex ?? node?.presentation?.ranges.findIndex(r => node.aiResponse.slice(target === 'speaker' ? r.speakerStart : r.textStart,target === 'speaker' ? r.speakerEnd : r.textEnd) === source);
  const identity=`${world?.id}:${playthrough}:${stableOccurrence(occurrence ?? source)}:${target}`;
  const cues=cuesForTarget(viewNodes,staged ? staged.id : originId ?? current?.id ?? id,id ?? '').filter(c=>c.field===target && (target==='choice' ? c.effect.quote===source : c.segment===inferred));
  let content: React.ReactNode = text;
  if (enabled && source.startsWith(text)) {
    if (node?.presentation && inferred !== undefined && inferred >= 0 && (target === 'choice' || node.aiResponse.slice(target === 'speaker' ? node.presentation.ranges[inferred]?.speakerStart : node.presentation.ranges[inferred]?.textStart, target === 'speaker' ? node.presentation.ranges[inferred]?.speakerEnd : node.presentation.ranges[inferred]?.textEnd).startsWith(source))) {
      const range = node.presentation.ranges[inferred];
      const base = target === 'speaker' ? range?.speakerStart : range?.textStart;
      const active = cues.filter(c=>c.active);
      content = <EffectText animate={animate} searchSources={searchSources} sourceComplete={sourceComplete && text.length >= source.length} webSources={target==='text'} runs={projectRanges(text, active.map(c => ({ start: target === 'choice' ? 0 : c.start-(base ?? 0), end: target === 'choice' ? source.length : c.end-(base ?? 0), effect:c.effect.kind==='replace' && text.length<c.end-(base ?? 0) ? {...c.effect,value:c.effect.value?.slice(0,Math.max(0,text.length-(c.start-(base ?? 0))))} : c.effect, remainingMs:c.remainingMs })))} renderText={chunk => parseDocuments && inlineTextTokens(chunk,target==='text').length ? <InlineDocumentText text={chunk} webSources={target==='text'} /> : chunk} />;
    } else if (playbackKey) {
      const legacyRead=Boolean(node?.segmentHash && !node.presentation && node.playerVisibleText?.includes(source));
      const immediate=(parseTextEffects(effects) ?? []).filter(e=>(legacyRead || e.afterSegments===-1) && !e.nodeId);
      content=<EffectText searchSources={searchSources} sourceComplete={sourceComplete && text.length >= source.length} webSources={target==='text'} runs={projectRanges(text,textEffectRuns(source,immediate,target).flatMap(r=>r.effects.map(effect=>({start:r.start,end:r.end,effect}))))} />;
    } else if (effects?.length) content = <DraftText searchSources={searchSources} text={text} source={source} effects={(parseTextEffects(effects) ?? []).map(e=>e.afterSegments===undefined && !legacyTiming ? {...e,afterSegments:0} : e)} target={target} sourceComplete={sourceComplete} identity={identity} settled={Boolean(node?.segmentHash && !node.presentation && node.generationComplete && node.aiResponse.includes(source))} />;
    else if (parseDocuments && (inlineTextTokens(source,target==='text').length || target==='text' && searchSources?.length)) content = <InlineDocumentText searchSources={searchSources} text={text} source={source} webSources={target==='text'} sourceComplete={sourceComplete} />;
  } else if (parseDocuments && (target === 'text' || target === 'choice') && (inlineTextTokens(source,target==='text').length || target==='text' && searchSources?.length)) content = <InlineDocumentText searchSources={searchSources} text={text} source={source} webSources={target==='text'} sourceComplete={sourceComplete} />;
  return <>{content}</>;
}
