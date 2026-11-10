import type { GameStore } from '@/store/game-store';
import type { StorySegment } from '@/lib/ai/types';
import type { ActionRecord,WorldLineMeta,WorldLineNode,WorldSnapshot } from './types';
import type { ActionNodeOptions } from './action-entry';
import { archiveScopeSessionValue,scopeStorageKey } from './archive-scope';
import { hashAndStore } from './cas-storage';
import { loadMeta,saveMeta,updateMeta } from './storage';
import { withWorldLineWrite } from './worldline-persistence';
import { compilePresentation,indexLegacyPresentations,presentationContext,presentationTargetNodes } from './presentation';

interface ActionWrite {
 get:()=>GameStore;
 set:(partial:Partial<GameStore>)=>void;
 action:ActionRecord;
 snapshot:WorldSnapshot;
 segments:StorySegment[];
 options?:ActionNodeOptions;
}

/** One writer for ordinary actions and forks; no node is published before I/O succeeds. */
export async function writeActionNode({get,set,action,snapshot,segments,options}:ActionWrite):Promise<WorldLineNode> {
 const state=get(),wl=state.worldLine;
 if(!wl) throw new Error('世界线未初始化');
 const parentId=options?.parentNodeId ?? state.currentNode?.id;
 const parent=parentId ? state.allNodes[parentId] : null;
 if(!parent) throw new Error('源节点不存在');
 const expectedHeadId=options?.expectedHeadId ?? state.currentNode?.id;
 const archive=archiveScopeSessionValue(state);
 const sameWorld=()=>{const s=get();return s.currentWorld?.id===state.currentWorld?.id && s.currentPlaythroughId===state.currentPlaythroughId && s.worldLine?.id===wl.id && archiveScopeSessionValue(s)===archive;};
 const assertCurrent=()=>{if(!sameWorld() || get().currentNode?.id!==expectedHeadId || options?.isCurrent?.()===false) throw new Error('当前进度或请求已变化，行动未提交');};
 assertCurrent();
 const node=makeActionNode(action,parent),id=node.id;
 if(options?.entry) {
  if(options.entry.sourceNodeId!==parent.id) throw new Error('行动起点与入场信息不一致');
  const {snapshot:before,...entry}=options.entry;
  const snapshotHash=await hashAndStore('snapshot',before);assertCurrent();
  node.entry={...structuredClone(entry),snapshotHash};
 }
 node.segmentHash=segments.length ? await hashAndStore('segments',segments) : '';assertCurrent();
 const targets=presentationTargetNodes(segments,parent.id);
 const indexed=targets.length ? await indexLegacyPresentations(state.allNodes,targets) : state.allNodes;
 assertCurrent();
 const native=state.currentWorld?.gameplayPlugins?.filter(p=>p.ui?.presentation==='native-text') ?? [];
 if(native.length) node.presentation=compilePresentation(node,segments,indexed,native.some(p=>/^0\.[0-3](\.|$)/.test(p.release ?? '')));
 // Preserve read progress and notes updated while CAS/indexing yielded.
 const candidate=()=>{
  const nodes={...get().allNodes};
  for(const [key,value] of Object.entries(indexed)) if(!nodes[key]?.presentation && value.presentation) nodes[key]={...nodes[key],presentation:value.presentation};
  nodes[parent.id]={...nodes[parent.id],childIds:[...nodes[parent.id].childIds,id]};nodes[id]=node;
  return nodes;
 };
 const nodes=candidate();
 const result=Object.keys(snapshot).length ? {...snapshot,presentationContext:presentationContext(nodes,id)} : snapshot;
 node.snapshotHash=Object.keys(result).length ? await hashAndStore('snapshot',result) : '';assertCurrent();
 const meta:WorldLineMeta={...wl,allNodeIds:[...wl.allNodeIds,id],currentNodeId:id,totalSteps:wl.totalSteps+1,
  branchCount:wl.branchCount+(parent.childIds.length ? 1 : 0),updatedAt:node.createdAt};
 await publishActionNode({state,get,set,node,meta,candidate,assertCurrent,sameWorld});
 return node;
}

function makeActionNode(action:ActionRecord,parent:WorldLineNode):WorldLineNode {
 const id=`wl_${crypto.randomUUID()}`,now=Date.now(),details=action as ActionRecord & Partial<WorldLineNode>;
 return {
  id,parentId:parent.id,stepNumber:parent.stepNumber+1,actionId:action.id,
  directorCues:action.directorCues ? structuredClone(action.directorCues) : undefined,
  inputDocuments:action.inputDocuments,outputDocuments:action.outputDocuments,workspaceBranch:action.workspaceBranch,inputIdentity:action.inputIdentity,
  workspaceEffects:action.workspaceEffects?.map(effect=>({...effect,nodeId:id,actionId:action.id})),
  playerVisibleText:'',playerExcerpts:[],playerInput:action.playerInput,aiResponse:action.aiResponse,summary:action.summary,
  label:action.summary.match(/\[LABEL:([^\]]{1,160})\]/)?.[1].trim(),snapshotHash:'',segmentHash:'',childIds:[],createdAt:now,
  gameTime:{...action.gameTime},sceneId:action.sceneId,sceneName:action.sceneName,dayNumber:action.gameTime.day,
  timeSpent:{...action.timeSpent},worldImpacts:[...action.worldImpacts],availableActions:action.availableActions ? [...action.availableActions] : undefined,
  generationComplete:details.generationComplete ?? true,interruptedAtSegment:details.interruptedAtSegment,totalSegmentsGenerated:details.totalSegmentsGenerated,
 };
}

type Publication=Pick<ActionWrite,'get'|'set'> & {
 state:GameStore;node:WorldLineNode;meta:WorldLineMeta;
 candidate:()=>Record<string,WorldLineNode>;assertCurrent:()=>void;sameWorld:()=>boolean;
};
async function publishActionNode({state,get,set,node,meta,candidate,assertCurrent,sameWorld}:Publication):Promise<void> {
 const dataKey=scopeStorageKey(state,`worldline_data_${meta.id}`),indexKey=scopeStorageKey(state,`worldline_index_${meta.worldId}`);
 let wrote=false;
 await withWorldLineWrite(dataKey,async()=>{
 try {
  assertCurrent();wrote=true;
  await saveMeta(dataKey,{meta,nodes:candidate()});assertCurrent();
  const index=await loadMeta<WorldLineMeta[]>(indexKey) ?? [];assertCurrent();
  const updated=index.some(m=>m.id===meta.id) ? index.map(m=>m.id===meta.id ? meta : m) : [...index,meta];
  await saveMeta(indexKey,updated);assertCurrent();
  set({worldLine:meta,allNodes:candidate(),currentNode:node});
 } catch(error) {
  if(wrote) {
   // Only compensate our own head; a newer successful save owns its metadata.
   const previous=()=>sameWorld() ? get() : state;
   await updateMeta<{meta:WorldLineMeta;nodes:Record<string,WorldLineNode>}>(dataKey,current=>current?.meta.currentNodeId===node.id ? {meta:previous().worldLine!,nodes:previous().allNodes} : current);
   await updateMeta<WorldLineMeta[]>(indexKey,index=>index?.map(m=>m.id===meta.id && m.currentNodeId===node.id ? previous().worldLine! : m) ?? null);
  }
  throw error;
 }
 });
}
