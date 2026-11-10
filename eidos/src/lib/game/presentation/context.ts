import type { WorldLineNode } from '../types';
import { presentationCues, presentationPath, presentationRevision } from './runtime';
import { DEFAULT_BRIGHTNESS_TRANSITION_MS, presentationLighting } from './lighting';
export function presentationContext(nodes: Record<string,WorldLineNode>,origin?: string | null) {
  const cues = presentationCues(nodes,origin);
  const sceneBrightness = presentationLighting(cues).brightness;
  return presentationPath(nodes,origin).filter(n => n.entry?.changes.length || n.presentation && (n.presentation.cues.length || n.presentation.errors.length)).slice(-8).map(n => ({
    nodeId:n.id,revision:presentationRevision(n,nodes,origin),errors:n.presentation?.errors ?? [],sceneBrightness,
    cues:cues.filter(c => c.owner===n.id).map(c => ({ id:c.id,targetNode:c.targetNode,segment:c.segment,kind:c.effect.kind,state:c.cancelled ? 'cancelled' : c.active ? 'applied' : 'pending',
      ...(c.effect.effectId ? {effectId:c.effect.effectId} : {}),
      ...(c.effect.brightness===undefined ? {} : {brightness:c.effect.brightness,transitionMs:c.effect.transitionMs ?? DEFAULT_BRIGHTNESS_TRANSITION_MS}) })),
  }));
}
