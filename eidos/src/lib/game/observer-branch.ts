import type { GameStore } from '@/store/game-store';
import type { StoreApi } from 'zustand';
import type { ActionRecord,WorldSnapshot } from './types';
import type { StorySegment } from '@/lib/ai/types';
import { loadBlob } from './cas-storage';
import { getPlayerVisibleText,getReadingPath } from './player-reading';
import { indexLegacyPresentations,compilePresentation,recordPresentationText,presentationContext } from './presentation';
import { captureObserverInterference,type ObserverInterference } from './presentation/observer';
import { archiveScopeSessionValue } from './archive-scope';
import { rewindPolicy } from './rewind';
import { overlayActionEntry,type ActionEntryDraft,type ActionNodeOptions } from './action-entry';
import { presentationCues } from './presentation';

export interface ObserverBranchPlan {state:GameStore;snapshot:WorldSnapshot;segments:StorySegment[];entry:ActionEntryDraft;expectedHeadId:string;scope:string;interference:ObserverInterference}
const identity=(s:GameStore)=>JSON.stringify([s.currentWorld?.id,s.currentPlaythroughId,s.worldLine?.id,archiveScopeSessionValue(s)]);
export async function prepareObserverBranch(state:GameStore,from:string,origin:string):Promise<ObserverBranchPlan> {
 const target=state.allNodes[from];
 if(rewindPolicy(state.currentWorld)) throw new Error('此世界的回溯由剧情能力发动');
 if(!state.currentNode || !state.worldLine || !target?.snapshotHash) throw new Error('目标没有可用的游戏快照');
 if(!target.generationComplete || getPlayerVisibleText(target).length<target.aiResponse.length) throw new Error('请先读完此处内容再另作选择');
 if(!getReadingPath(state.allNodes,origin).some(n=>n.id===from)) throw new Error('所查分支与目标不一致');
 const snapshot=await loadBlob(target.snapshotHash) as WorldSnapshot|null;
 const segments=target.segmentHash ? await loadBlob(target.segmentHash) as StorySegment[]|null : null;
 if(!snapshot || !segments?.length) throw new Error('历史场景内容缺失');
 let nodes=await indexLegacyPresentations(state.allNodes,[from]);
 if(!nodes[from].presentation) nodes={...nodes,[from]:{...nodes[from],presentation:compilePresentation(nodes[from],segments,nodes)}};
 const interference=captureObserverInterference(nodes,origin,from);
 const entry:ActionEntryDraft={version:1,id:`entry_${crypto.randomUUID()}`,sourceNodeId:from,originNodeId:origin,
  changes:interference.changes,presentationOrder:presentationCues(nodes,from).reduce((max,c)=>Math.max(max,c.order),0)+1,snapshot};
 nodes=overlayActionEntry(nodes,from,entry);
 const sceneNarrative=recordPresentationText(nodes[from],nodes,from);
 const prepared=state.prepareSnapshotRestore(snapshot);if(!prepared) throw new Error('目标快照不属于当前世界');
 const factual={...snapshot,sceneNarrative,presentationContext:presentationContext(nodes,from)};
 entry.snapshot=factual;
 const path=getReadingPath(nodes,from);
 const history=path.filter(n=>n.aiResponse).map(n=>({id:n.actionId ?? n.id,timestamp:n.createdAt,directorCues:n.directorCues,sourceResponse:n.aiResponse,playerInput:n.playerInput,aiResponse:recordPresentationText(n,nodes,from),summary:n.summary,gameTime:n.gameTime,sceneId:n.sceneId,sceneName:n.sceneName,timeSpent:n.timeSpent,worldImpacts:n.worldImpacts,snapshot:null,inputDocuments:n.inputDocuments,outputDocuments:n.outputDocuments} as ActionRecord));
 const branchState={...state,...prepared,allNodes:nodes,currentNode:nodes[from],worldLine:{...state.worldLine,currentNodeId:from},history,sceneNarrative,readingView:null,readingSegments:null,
  createSnapshot:()=>structuredClone(factual),getWorldLineSummary:()=>({currentNodeId:from,stepNumber:path.at(-1)!.stepNumber,depth:path.length-1,branchCount:state.worldLine!.branchCount+1,backtrackableNodes:[],siblingBranches:[]})} as GameStore;
 return {state:branchState,snapshot:factual,segments,entry,expectedHeadId:state.currentNode.id,scope:identity(state),interference};
}
/** Acceptance restores facts once; only the real action writer may advance the tree. */
export function acceptObserverBranch(store:StoreApi<GameStore>,plan:ObserverBranchPlan,isCurrent?:()=>boolean):ActionNodeOptions {
 const state=store.getState();
 if(identity(state)!==plan.scope || state.currentNode?.id!==plan.expectedHeadId || isCurrent?.()===false) throw new Error('当前进度或请求已变化，未接入旧节点分支');
 const restored=state.prepareSnapshotRestore(plan.snapshot);
 if(!restored) throw new Error('目标快照不属于当前世界');
 store.setState({...restored,history:plan.state.history});
 return {parentNodeId:plan.entry.sourceNodeId,expectedHeadId:plan.expectedHeadId,entry:plan.entry,reuseExisting:false};
}
