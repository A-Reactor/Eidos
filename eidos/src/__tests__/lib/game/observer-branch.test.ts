// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { prepareObserverBranch,acceptObserverBranch } from '@/lib/game/observer-branch';
import { compilePresentation,advancePresentation,recordPresentationText } from '@/lib/game/presentation';
import * as cas from '@/lib/game/cas-storage';
import { saveAcceptedActionNode,retryAcceptedActionNode,getPendingActionNodeSave } from '@/lib/game/action-node-commit';
import { hashAndStore,loadBlob } from '@/lib/game/cas-storage';
import { prepareRewindArrival } from '@/lib/game/rewind-arrival';
import { importWorldLineExport } from '@/lib/game/worldline-export';
import * as storage from '@/lib/game/storage';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '@/lib/game/types';
import { readHistory } from '@/lib/game/history-reader';
import { resolveGameRewindTarget } from '@/lib/game/rewind';
import { retrieveLongMemoryContext } from '@/lib/ai/long-memory-retrieval';
beforeEach(async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const {world,snapshot}=buildRiftCityStartState();
 const lines:StorySegment[]=[{type:'narration',text:'信上写着去左门。'}];
 const past={id:'past',parentId:null,stepNumber:3,playerInput:'看信',aiResponse:lines[0].text,playerVisibleText:lines[0].text,summary:'看信',childIds:['later'],snapshotHash:await hashAndStore('snapshot',snapshot),segmentHash:await hashAndStore('segments',lines),gameTime:snapshot.currentGameTime,sceneId:snapshot.currentSceneId,sceneName:'房间',timeSpent:{day:0,hour:0,minute:0},worldImpacts:[],generationComplete:true,createdAt:0,dayNumber:0} as WorldLineNode;
 past.presentation=compilePresentation(past,lines,{});
 const future:StorySegment[]=[{type:'narration',text:'遥远的后来。',textEffects:[{kind:'replace',nodeId:'past',segment:0,quote:'左门',value:'右门',afterSegments:-1}]}];
 const later={...past,id:'later',parentId:'past',stepNumber:6,childIds:[],aiResponse:future[0].text,playerVisibleText:future[0].text,segmentHash:await hashAndStore('segments',future)};
 later.presentation=compilePresentation(later,future,{past});
 const nodes=advancePresentation({past,later},'later',0,6,true,0);
 useGameStore.setState({...useGameStore.getInitialState(),currentWorld:world,currentPlaythroughId:'observer',phase:'playing',allNodes:nodes,currentNode:nodes.later,worldLine:{id:'observer-line',playthroughId:'observer',worldId:world.id,rootNodeId:'past',currentNodeId:'later',allNodeIds:['past','later'],totalSteps:6,branchCount:0,createdAt:0,updatedAt:0}});
 useGameStore.getState().restoreSnapshot(snapshot);
 useGameStore.setState({worldFlags:{futureOnly:true}});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

async function act(input='照信行事',id=crypto.randomUUID()) {
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later');
 const options=acceptObserverBranch(useGameStore,plan);
 const record={...plan.state.history[0],id,playerInput:input,aiResponse:'你走进右门。'};
 const node=await useGameStore.getState().addActionNode(record,useGameStore.getState().createSnapshot(),[{type:'narration',text:record.aiResponse}],options);
 return {plan,node};
}
it('prepares the observed source without inventing a node or restoring live progress',async()=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later');
 expect(useGameStore.getState().currentNode?.id).toBe('later');expect(useGameStore.getState().worldFlags.futureOnly).toBe(true);
 expect(plan.state.currentNode?.id).toBe('past');expect(plan.state.worldFlags.futureOnly).toBeUndefined();
 expect(Object.keys(plan.state.allNodes).sort()).toEqual(['later','past']);
 expect(plan.state.sceneNarrative).toBe('信上写着去右门。');
 expect(plan.state.history[0].sourceResponse).toBe('信上写着去左门。');
 expect(plan.state.history.map(r=>[r.playerInput,r.aiResponse])).toEqual([['看信','信上写着去右门。']]);
 expect(plan.entry.changes[0].sourceEventId).toBe('later:0:0');
 const evidence=readHistory(plan.state,{nodeId:'past',view:'both'});
 expect(evidence.presentation).toEqual(expect.arrayContaining([expect.objectContaining({id:`${plan.entry.id}:0`,state:'applied'})]));
 expect(plan.snapshot.presentationContext).toEqual(expect.arrayContaining([expect.objectContaining({nodeId:'past'})]));
});
it('accepts facts without publishing a copied arrival or moving the historical reader',async()=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later');
 await useGameStore.getState().openReadingNode('past','later');const reader=useGameStore.getState().readingView;
 const options=acceptObserverBranch(useGameStore,plan);
 const state=useGameStore.getState();
 expect(state.currentNode?.id).toBe('later');expect(state.worldLine?.allNodeIds).toEqual(['past','later']);
 expect(state.worldFlags.futureOnly).toBeUndefined();expect(state.readingView).toBe(reader);
 expect(options).toMatchObject({parentNodeId:'past',expectedHeadId:'later',reuseExisting:false,entry:{id:plan.entry.id}});
});
it('adds exactly one actual action directly under its source and keeps both originals',async()=>{
 const before=useGameStore.getState(),{plan,node}=await act();const state=useGameStore.getState();
 expect(node.parentId).toBe('past');expect(node.stepNumber).toBe(4);
 expect(state.worldLine?.allNodeIds).toHaveLength(3);expect(state.allNodes.past.childIds).toEqual(['later',node.id]);
 expect(node.entry).toMatchObject({id:plan.entry.id,sourceNodeId:'past',originNodeId:'later'});
 expect(node.aiResponse).toBe('你走进右门。');expect(node.presentation?.replicaOf).toBeUndefined();
 expect(recordPresentationText(state.allNodes.past,state.allNodes,node.id)).toBe('信上写着去右门。');
 expect(state.allNodes.past.aiResponse).toBe('信上写着去左门。');expect(state.allNodes.later).toEqual(before.allNodes.later);
 expect(Object.keys(state.allNodes).some(id=>id.startsWith('observer_'))).toBe(false);
});
it('persists distinct before-action and result snapshots',async()=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later'),options=acceptObserverBranch(useGameStore,plan);
 useGameStore.setState({worldFlags:{entered:true}});
 const record={...plan.state.history[0],id:'accepted',playerInput:'进入',aiResponse:'你走进右门。'};
 const node=await useGameStore.getState().addActionNode(record,useGameStore.getState().createSnapshot(),[{type:'narration',text:record.aiResponse}],options);
 expect(node.entry?.snapshotHash).not.toBe(node.snapshotHash);
 expect(await loadBlob(node.entry!.snapshotHash)).toMatchObject({sceneNarrative:'信上写着去右门。',worldFlags:{}});
 expect(await loadBlob(node.snapshotHash)).toMatchObject({worldFlags:{entered:true}});
});
it('uses actual action IDs and numbers for history, long memory and ability rewind targets',async()=>{
 const {node}=await act();useGameStore.getState().setNodeReadText(node.id,node.aiResponse);
 const state=useGameStore.getState();
 expect(state.getWorldLineSummary()).toMatchObject({currentNodeId:node.id,stepNumber:4,depth:1});
 expect(readHistory(state,{target:'第4步'})).toMatchObject({nodeId:node.id,stepNumber:4,parentId:'past',text:'你走进右门。'});
 expect(readHistory(state,{target:'上一节点'})).toMatchObject({nodeId:'past',stepNumber:3});
 expect(retrieveLongMemoryContext({playerInput:'读取第4步前后0步',allNodes:state.allNodes,currentNodeId:node.id}).entries.map(e=>[e.nodeId,e.stepNumber])).toEqual([[node.id,4]]);
 const world={...state.currentWorld!,gameModeConfig:{rewind:{enabled:true}}};
 expect(resolveGameRewindTarget({world,nodes:state.allNodes,currentId:node.id,reference:'第3步'})).toBe('past');
});
it('rejects stale preparation without changing the new progress',async()=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later');
 useGameStore.setState(s=>({currentNode:s.allNodes.past}));
 expect(()=>acceptObserverBranch(useGameStore,plan)).toThrow('进度');
 expect(useGameStore.getState().currentNode?.id).toBe('past');
});
it('rejects a stale or cancelled action during CAS without leaving a partial node',async()=>{
 const original=useGameStore.getState(),plan=await prepareObserverBranch(original,'past','later');let active=true;
 const options=acceptObserverBranch(useGameStore,plan);
 const saving=useGameStore.getState().addActionNode({...plan.state.history[0],id:'stale',playerInput:'前往'},plan.snapshot,plan.segments,{...options,isCurrent:()=>active});
 active=false;await expect(saving).rejects.toThrow('进度');
 expect(useGameStore.getState().worldLine?.allNodeIds).toEqual(original.worldLine?.allNodeIds);
});
it.each(['worldline_data_','worldline_index_'])('compensates a cancelled write after %s',async checkpoint=>{
 const original=useGameStore.getState(),plan=await prepareObserverBranch(original,'past','later');let active=true;
 await original.persistWorldLineData();const indexKey=scopeStorageKey(original,'worldline_index_'+original.currentWorld!.id);
 await storage.saveMeta(indexKey,[original.worldLine]);
 const save=storage.saveMeta;vi.spyOn(storage,'saveMeta').mockImplementation(async(key,value)=>{await save(key,value);if(key.includes(checkpoint)) active=false;});
 const options=acceptObserverBranch(useGameStore,plan);
 await expect(useGameStore.getState().addActionNode({...plan.state.history[0],id:'cancelled'},plan.snapshot,plan.segments,{...options,isCurrent:()=>active})).rejects.toThrow('进度');
 const saved=await storage.loadMeta<{meta:{currentNodeId:string};nodes:Record<string,WorldLineNode>}>(scopeStorageKey(original,'worldline_data_'+original.worldLine!.id));
 expect(saved?.meta.currentNodeId).toBe('later');expect(Object.keys(saved!.nodes).sort()).toEqual(['later','past']);
 expect((await storage.loadMeta<Array<{currentNodeId:string}>>(indexKey))?.[0].currentNodeId).toBe('later');
 expect(useGameStore.getState().currentNode?.id).toBe('later');
});
it('does not reuse an entry-bearing child from an ordinary input cache',async()=>{
 const {node}=await act();
 useGameStore.setState(s=>({currentNode:s.allNodes.past,worldLine:{...s.worldLine!,currentNodeId:'past'}}));
 expect(await useGameStore.getState().tryMatchChildNode(node.playerInput)).toBeNull();
 const base=await useGameStore.getState().addActionNode({...useGameStore.getState().history[0],id:'base',playerInput:node.playerInput,aiResponse:'原路线的门。'},useGameStore.getState().createSnapshot(),[{type:'narration',text:'原路线的门。'}]);
 expect(base.id).not.toBe(node.id);expect(base.entry).toBeUndefined();
});
it('retains the observed past for an actual game ability rewind',async()=>{
 const state=useGameStore.getState(),target=state.allNodes.past,snapshot=await loadBlob(target.snapshotHash) as import('@/lib/game/types').WorldSnapshot;
 const segments=await loadBlob(target.segmentHash) as StorySegment[];
 const arrival=await prepareRewindArrival({world:state.currentWorld!,nodes:state.allNodes,source:state.currentNode!,target,current:state.createSnapshot(),snapshot,segments,policy:{enabled:true,requires:{},anchorLabels:[],maxChars:2000,recentFullNodes:2},reason:'回到信前'});
 const nodes={...state.allNodes,[arrival.node.id]:arrival.node};
 expect(arrival.snapshot.sceneNarrative).toContain('去右门');expect(arrival.snapshot.worldFlags.futureOnly).toBeUndefined();
 expect(recordPresentationText({...arrival.node,playerVisibleText:target.aiResponse},nodes,arrival.node.id)).toContain('去右门');
});
it.each(['past','action'])('round trips %s export with entry snapshots and provenance',async root=>{
 const {node}=await act();const state=useGameStore.getState();await state.persistWorldLineData();
 const exported=await state.exportWorldLine(root==='action' ? node.id : 'past');
 expect(exported.snapshots[node.entry!.snapshotHash]).toMatchObject({sceneNarrative:'信上写着去右门。'});
 const broken=structuredClone(exported);delete broken.snapshots[node.entry!.snapshotHash];
 await expect(importWorldLineExport(broken,state.currentWorld!.id,'missing-entry')).rejects.toThrow('入场');
 const imported=await importWorldLineExport(exported,state.currentWorld!.id,'entry-import');
 const copy=imported.allNodes[node.id];
 expect(copy.entry).toMatchObject({id:node.entry!.id,sourceNodeId:'past',originNodeId:'later'});
 expect(await loadBlob(copy.entry!.snapshotHash)).toMatchObject({sceneNarrative:'信上写着去右门。'});
 expect(copy.aiResponse).toBe('你走进右门。');expect(copy.presentation?.replicaOf).toBeUndefined();
 if(root==='past') expect(recordPresentationText(imported.allNodes.past,imported.allNodes,copy.id)).toBe('信上写着去右门。');
 else expect(Object.keys(imported.allNodes)).toEqual([node.id]);
});

it('retries an accepted fork locally with its original result snapshot and no extra node',async()=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later'),options=acceptObserverBranch(useGameStore,plan);
 const state=useGameStore.getState(),record={...plan.state.history[0],id:'retry-action',playerInput:'进入',aiResponse:'进入后的正文。'};
 state.addToHistory(record);useGameStore.setState({sceneNarrative:record.aiResponse,worldFlags:{accepted:true}});
 const origin={worldId:state.currentWorld!.id,playthroughId:state.currentPlaythroughId,worldLineId:state.worldLine!.id,archiveScope:'ordinary',parentNodeId:'past',expectedHeadId:'later',actionId:record.id};
 vi.spyOn(cas,'hashAndStore').mockRejectedValueOnce(new Error('磁盘暂不可用'));
 await expect(saveAcceptedActionNode(useGameStore,origin,record,[{type:'narration',text:record.aiResponse}],options)).rejects.toThrow('磁盘');
 expect(getPendingActionNodeSave(useGameStore)?.phase).toBe('failed');
 expect(useGameStore.getState().worldLine!.allNodeIds).toEqual(['past','later']);
 useGameStore.setState({worldFlags:{accepted:true,laterUiWrite:true}});
 const node=await retryAcceptedActionNode(useGameStore);
 expect(node?.parentId).toBe('past');expect(node?.entry?.id).toBe(plan.entry.id);
 expect(await loadBlob(node!.snapshotHash)).toMatchObject({worldFlags:{accepted:true},sceneNarrative:record.aiResponse});
 expect((await loadBlob(node!.snapshotHash) as import('@/lib/game/types').WorldSnapshot).worldFlags.laterUiWrite).toBeUndefined();
 expect(useGameStore.getState().worldLine!.allNodeIds).toHaveLength(3);expect(getPendingActionNodeSave(useGameStore)).toBeNull();
});
it('keeps a body restore of its own entry receipt executable through portable import',async()=>{
 const {node,plan}=await act();const state=useGameStore.getState();
 const segments:StorySegment[]=[{type:'narration',text:node.aiResponse,textEffects:[{kind:'restore',effectId:`${plan.entry.id}:0`}]}];
 const presentation=compilePresentation(node,segments,state.allNodes);
 expect(presentation.errors).toEqual([]);
 const candidate={...node,presentation,segmentHash:await hashAndStore('segments',segments),playerVisibleText:node.aiResponse};
 const nodes=advancePresentation({...state.allNodes,[node.id]:candidate},node.id,0,node.aiResponse.length,true,0);
 useGameStore.setState({allNodes:nodes,currentNode:nodes[node.id]});
 expect(recordPresentationText(nodes.past,nodes,node.id)).toBe('信上写着去左门。');
 const exported=await useGameStore.getState().exportWorldLine('past');
 const imported=await importWorldLineExport(exported,state.currentWorld!.id,'entry-restore-import');
 expect(imported.allNodes[node.id].presentation!.cues).toHaveLength(1);
 expect(recordPresentationText(imported.allNodes.past,imported.allNodes,node.id)).toBe('信上写着去左门。');
});
it.each([false,true])('does not let an internal-page save overwrite a candidate, switchWorldLine=%s',async switchWorldLine=>{
 const plan=await prepareObserverBranch(useGameStore.getState(),'past','later'),options=acceptObserverBranch(useGameStore,plan);
 let release!:()=>void,reached!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),atIndex=new Promise<void>(resolve=>{reached=resolve;});
 const load=storage.loadMeta;vi.spyOn(storage,'loadMeta').mockImplementation(async key=>{
  if(key.includes('worldline_index_')) {reached();await held;}
  return load(key);
 });
 const state=useGameStore.getState(),record={...plan.state.history[0],id:'page-race',playerInput:'进入',aiResponse:'新路线。'};
 let unsubscribe=()=>{};
 if(switchWorldLine) unsubscribe=useGameStore.subscribe(live=>{if(live.currentNode?.actionId===record.id) {unsubscribe();useGameStore.setState({currentNode:null,allNodes:{},worldLine:{...live.worldLine!,id:'other-worldline'},currentPlaythroughId:'other-playthrough'});}});
 const saving=state.addActionNode(record,state.createSnapshot(),[{type:'narration',text:record.aiResponse}],options);
 await atIndex;
 const pageSave=useGameStore.getState().persistWorldLineData();release();
 const [node]=await Promise.all([saving,pageSave]);
 const saved=await storage.loadMeta<{meta:{currentNodeId:string};nodes:Record<string,WorldLineNode>}>(scopeStorageKey(state,'worldline_data_'+state.worldLine!.id));
 expect(saved?.meta.currentNodeId).toBe(node.id);expect(saved?.nodes[node.id].aiResponse).toBe('新路线。');
});
