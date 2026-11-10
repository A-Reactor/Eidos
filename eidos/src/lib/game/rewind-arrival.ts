import type { StorySegment } from '@/lib/ai/types';
import type { WorldDefinition, WorldSnapshot, WorldLineNode } from './types';
import { hashAndStore } from './cas-storage';
import { buildRewindMemory, type RewindPolicy } from './rewind';
import { recordPresentationText,presentationContext } from './presentation';
import { captureObserverInterference,observerPresentation } from './presentation/observer';

/** A new arrival preserves both the original target and the abandoned future. */
export async function prepareRewindArrival(input: {
  world: WorldDefinition; nodes: Record<string, WorldLineNode>; source: WorldLineNode; target: WorldLineNode;
  current: WorldSnapshot; snapshot: WorldSnapshot; segments: StorySegment[]; policy: RewindPolicy; reason: string;
}) {
  const rewindMemory = buildRewindMemory({ previous: input.current.rewindMemory, nodes: input.nodes,
    from: input.source.id, to: input.target.id, policy: input.policy, reason: input.reason });
  const snapshot: WorldSnapshot = { ...input.snapshot, rewindMemory };
  const node: WorldLineNode = { ...input.target, id: `rewind_${crypto.randomUUID()}`, actionId: crypto.randomUUID(), parentId: input.target.id,
    childIds: [], stepNumber: input.target.stepNumber + 1, createdAt: Date.now(), snapshotHash:'', segmentHash:'',
    playerInput: '发动回溯', summary: `回到${input.target.label || input.target.sceneName}：${input.reason}`,
    label: undefined, rewindFailure: undefined, playerVisibleText: '', playerExcerpts: [], playerNpcNotes: undefined,
    workspaceBranch:undefined,workspaceEffects:undefined,inputIdentity:undefined,
    timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], generationComplete: true };
  if(input.target.presentation) {
    const interference=captureObserverInterference(input.nodes,input.source.id,input.target.id);
    node.observerInterference=interference;
    node.presentation=observerPresentation(input.nodes,input.target,node.id,interference);
    const nodes={...input.nodes,[node.id]:node};
    snapshot.sceneNarrative=recordPresentationText({...node,playerVisibleText:input.target.playerVisibleText ?? input.target.aiResponse},nodes,node.id);
    snapshot.presentationContext=presentationContext(nodes,node.id);
  }
  const [snapshotHash,segmentHash]=await Promise.all([hashAndStore('snapshot',snapshot),input.segments.length ? hashAndStore('segments',input.segments) : Promise.resolve('')]);
  node.snapshotHash=snapshotHash;node.segmentHash=segmentHash;
  return { node, snapshot };
}
