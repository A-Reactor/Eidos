'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameStore } from '@/store/game-store';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { advancePresentation, compilePresentation, presentationCues, stagePresentationDraft, adoptPresentationDraft, getPresentationDraft } from '@/lib/game/presentation';
import type { StorySegment } from '@/lib/ai/types';

type Playback = { nodeId: string | null; segments: StorySegment[]; index: number; chars: number; complete: boolean; showing: boolean; active: boolean; key?:string; accepted?:boolean };
/** A single cursor owns timing. All other renderers consume the resulting ledger. */
export function usePresentationPlayback(input: Playback) {
  const {nodeId,segments,index,chars,complete,showing,active,key,accepted}=input;
  const latest = useRef(input), save = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const native = useGameStore(s => s.currentWorld?.gameplayPlugins?.some(p => p.ui?.presentation === 'native-text' && isGameplayPluginActive(p,s.worldFlags,s.currentSceneId)));
  const tick = useRef((_elapsed: number) => {});
  // Returning to a saved cursor shows its final frame. Only motion started by
  // this visit may animate; node changes must not replay a paused old glitch.
  useLayoutEffect(()=>{
    if(!native) return;
    const state=useGameStore.getState(),node=state.currentNode;
    const motions=presentationCues(state.allNodes,node?.id).filter(c=>c.remainingMs>0);
    if(!node?.presentation || !motions.length) return;
    const next={...node,presentation:{...node.presentation,motion:{...node.presentation.motion,...Object.fromEntries(motions.map(c=>[c.id,0]))}}};
    useGameStore.setState({allNodes:{...state.allNodes,[node.id]:next},currentNode:next});
  },[native,nodeId]);
  useLayoutEffect(() => {
    latest.current = {nodeId,segments,index,chars,complete,showing,active,key,accepted};
    tick.current = (elapsed: number) => {
      const { nodeId, segments, index, chars, complete, showing, active, key, accepted } = latest.current;
      const state = useGameStore.getState(), node = nodeId ? state.allNodes[nodeId] : undefined;
      if (!native || !active || !segments.length || state.phase!=='playing') return;
      const legacy=state.currentWorld?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text' && /^0\.[0-3](\.|$)/.test(p.release ?? '')) ?? false;
      const saved=Boolean(node && node.aiResponse===segments.map(s => s.type === 'dialogue' ? '「'+(s.speaker ? s.speaker+'：' : '')+s.text+'」' : s.text).join('\n\n'));
      // Acceptance belongs to the originating action. A reopened saved record must
      // keep its ledger even while that action's transient flag is still stale.
      if (key && !saved && (accepted===false || !node || node.id!==state.currentNode?.id)) {stagePresentationDraft({key,segments,index,chars,complete,showing,elapsed,legacy});return;}
      if (!nodeId || !node || node.id!==state.currentNode?.id) return;
      // A stream can still be displaying a draft whose accepted node does not exist yet.
      if (!saved) return;
      let nodes = state.allNodes;
      if (!node.presentation) nodes = { ...nodes,[nodeId]: { ...node,presentation: compilePresentation(node,segments,nodes,legacy) } };
      if(key) {const presentation=adoptPresentationDraft(key,nodes[nodeId],nodes);if(presentation && presentation!==nodes[nodeId].presentation) nodes={...nodes,[nodeId]:{...nodes[nodeId],presentation}};}
      const end = showing ? index : segments.length-1;
      for (let i=0;i<=end && i<segments.length;i++) nodes = advancePresentation(nodes,nodeId,i,i<end || !showing ? segments[i].text.length : chars,i<end || !showing || complete,i===end ? elapsed : 0);
      if (nodes === state.allNodes) return;
      useGameStore.setState({ allNodes: nodes,currentNode: nodes[nodeId] });
      clearTimeout(save.current);
      save.current = setTimeout(() => { void useGameStore.getState().persistWorldLineData().catch(error => console.warn('[Presentation] save pending',error)); },180);
    };
    tick.current(0);
  }, [nodeId,segments,index,chars,complete,showing,active,key,accepted,native]);
  useEffect(() => {
    if (!input.active || !native) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), elapsed = Math.min(100,now-last); last=now;
      const current=latest.current,draft=getPresentationDraft(current.key);
      const staged=draft && !draft.acceptedId ? draft.node : undefined;
      const cues=presentationCues(staged ? {[staged.id]:staged} : useGameStore.getState().allNodes,staged?.id ?? current.nodeId);
      if (!document.hidden && cues.some(c=>c.remainingMs>0 || !c.active && c.clockArmed)) tick.current(elapsed);
    },50);
    return () => clearInterval(timer);
  }, [input.active,native]);
  useEffect(() => () => {
    if (save.current) { clearTimeout(save.current); void useGameStore.getState().persistWorldLineData().catch(error => console.warn('[Presentation] save pending',error)); }
  },[]);
}
