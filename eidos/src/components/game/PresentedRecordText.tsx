'use client';
import type { WorldLineNode } from '@/lib/game/types';
import { useGameStore } from '@/store/game-store';
import { recordPresentationRuns } from '@/lib/game/presentation';
import { usePresentationArchive } from './use-presentation-archive';
import { EffectText } from './NarrativeText';

/** All passive summaries wait for legacy effect metadata before exposing source text. */
export function PresentedRecordText({nodeId,node:reference}:{nodeId:string;node?:WorldLineNode}) {
  usePresentationArchive([nodeId]);
  const nodes=useGameStore(s=>s.allNodes),origin=useGameStore(s=>s.currentNode?.id);
  const native=useGameStore(s=>s.currentWorld?.gameplayPlugins?.some(p=>p.ui?.presentation==='native-text'));
  const stored=nodes[nodeId];
  const node=reference ? {...reference,presentation:stored?.presentation ?? reference.presentation} : stored;
  if(!node || native && node.segmentHash && !node.presentation) return null;
  return <EffectText runs={recordPresentationRuns(node,nodes,origin)} />;
}
