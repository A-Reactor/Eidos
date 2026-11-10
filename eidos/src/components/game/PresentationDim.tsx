'use client';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '@/store/game-store';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
import { presentationCues,presentationLighting,getPresentationDraft,subscribePresentationDrafts } from '@/lib/game/presentation';
/** The shared clock owns the shade too: rerendering never restarts its duration. */
export function PresentationDim({playbackKey,active=true}:{playbackKey?:string;active?:boolean}) {
  const nodes=useGameStore(s=>s.allNodes),origin=useGameStore(s=>s.currentNode?.id),phase=useGameStore(s=>s.phase);
  const native=useGameStore(s=>s.currentWorld?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text' && isGameplayPluginActive(p,s.worldFlags,s.currentSceneId)));
  const draft=useSyncExternalStore(subscribePresentationDrafts,()=>getPresentationDraft(playbackKey),()=>undefined);
  const staged=draft && (!draft.acceptedId || draft.acceptedId!==origin) ? draft.node : undefined;
  if (!native || !active || ['title','world_select','world_create','identity'].includes(phase) || typeof document==='undefined') return null;
  const inherited=presentationCues(nodes,origin);
  const cues=staged ? [...inherited.map(c=>({...c,remainingMs:0})),...presentationCues({[staged.id]:staged},staged.id)] : inherited;
  const {brightness,stillBrightness}=presentationLighting(cues);
  // Escape game containers so clipping, transforms and panel stacking cannot leave parts of the window lit.
  return brightness<1 ? createPortal(<div className="eidos-presentation-dim" style={{opacity:1-brightness,'--eidos-dim-still-opacity':1-stillBrightness} as React.CSSProperties} aria-hidden="true" />,document.body) : null;
}
