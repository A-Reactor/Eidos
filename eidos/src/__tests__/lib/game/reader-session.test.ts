// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach,expect,it } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { storeBlob } from '@/lib/game/cas-storage';
import { compilePresentation,advancePresentation } from '@/lib/game/presentation';
import { readingReference } from '@/lib/game/reader-session';
import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '@/lib/game/types';

const oldLines:StorySegment[]=[{type:'narration',text:'信上写着去左门。'},{type:'narration',text:'末尾原文。'}];
const lines:StorySegment[]=[{type:'narration',text:'后来信被改过。',textEffects:[{kind:'replace',nodeId:'past',segment:0,quote:'左门',value:'右门',afterSegments:-1}]}];
const node=(id:string,parentId:string|null,text:string,stepNumber:number):WorldLineNode=>({id,parentId,aiResponse:text,playerVisibleText:text,stepNumber,playerInput:id,summary:'',worldImpacts:[],childIds:[],snapshotHash:'',segmentHash:id,createdAt:stepNumber,gameTime:{day:0,hour:8,minute:stepNumber},sceneId:'dock',sceneName:'渡口',dayNumber:0,timeSpent:{day:0,hour:0,minute:0},generationComplete:true});
beforeEach(async()=>{
 const {world,snapshot}=buildRiftCityStartState();
 const past=node('past',null,oldLines.map(s=>s.text).join('\n\n'),3);past.childIds=['now'];past.presentation=compilePresentation(past,oldLines,{});
 const now=node('now','past',lines[0].text,6);now.presentation=compilePresentation(now,lines,{past});
 const nodes=advancePresentation({past,now},'now',0,lines[0].text.length,true,0);
 useGameStore.setState({...useGameStore.getInitialState(),currentWorld:world,currentPlaythroughId:'reader-test',allNodes:nodes,currentNode:nodes.now,phase:'playing',worldLine:{id:'reader-line',worldId:world.id,playthroughId:'reader-test',rootNodeId:'past',currentNodeId:'now',allNodeIds:['past','now'],totalSteps:6,branchCount:0,createdAt:0,updatedAt:0}});
 useGameStore.getState().restoreSnapshot(snapshot);
 await storeBlob('past','segments',oldLines);await storeBlob('now','segments',lines);
});
it('opens history without restoring world facts and returns both the referenced source and actual display',async()=>{
 const before=useGameStore.getState(),time=before.gameTime,inventory=before.inventory,heads=before.documentHeads,history=before.history;
 await before.openReadingNode('past');
 const state=useGameStore.getState();
 expect(state.currentNode?.id).toBe('now');expect(state.worldLine?.currentNodeId).toBe('now');
 expect(state.gameTime).toBe(time);expect(state.inventory).toBe(inventory);expect(state.documentHeads).toBe(heads);expect(state.history).toBe(history);
 expect(state.readingView).toMatchObject({nodeId:'past',originId:'now',segmentIndex:0});
 expect(state.readingSegments).toHaveLength(2);
 const reference=readingReference(state);
 expect(reference?.sourceText).toContain('去左门');expect(reference?.displayText).toContain('去右门');
 state.closeReadingView();expect(useGameStore.getState().readingView).toBeNull();expect(useGameStore.getState().currentNode?.id).toBe('now');
});
it('only loads already-read prose and never turns unseen paragraphs into playback events',async()=>{
 useGameStore.setState(s=>({allNodes:{...s.allNodes,past:{...s.allNodes.past,playerVisibleText:'信上写着'}}}));
 await useGameStore.getState().openReadingNode('past');
 expect(useGameStore.getState().readingSegments?.map(s=>s.text)).toEqual(['信上写着']);
 expect(useGameStore.getState().allNodes.past.presentation?.read).toEqual({});
});
it('persists the reading position separately from the real saved progress',async()=>{
 await useGameStore.getState().openReadingNode('past');useGameStore.getState().setReadingSegment(1);
 const save=useGameStore.getState().serializeState();
 expect(save.worldLineNodeId).toBe('now');expect(save.readingView).toMatchObject({nodeId:'past',originId:'now',segmentIndex:1});
 useGameStore.getState().deserializeState(save,useGameStore.getState().currentWorld!);
 expect(useGameStore.getState().readingView).toMatchObject({nodeId:'past',segmentIndex:1});
});
it('references the selected paragraph rather than an unrelated beginning of a long record',async()=>{
 await useGameStore.getState().openReadingNode('past');useGameStore.getState().setReadingSegment(1);
 expect(readingReference(useGameStore.getState())?.sourceText).toBe('末尾原文。');
 expect(readingReference(useGameStore.getState())?.displayText).toBe('末尾原文。');
});
it('binds an excerpt to the branch actually being read rather than the live branch display',async()=>{
 const state=useGameStore.getState(),sibling={...state.allNodes.now,id:'sibling',presentation:undefined};
 useGameStore.setState({currentNode:sibling,allNodes:{...state.allNodes,sibling}});
 await useGameStore.getState().openReadingNode('past','now');
 useGameStore.getState().addPlayerExcerpt('past','去右门','另一段经历中看到的字迹','now');
 expect(useGameStore.getState().allNodes.past.playerExcerpts?.[0].text).toBe('去右门');
 expect(useGameStore.getState().currentNode?.id).toBe('sibling');
});
it('clears the old reading session when starting another world',async()=>{
 await useGameStore.getState().openReadingNode('past');
 const world={...useGameStore.getState().currentWorld!,id:'another-world'};
 useGameStore.getState().setCurrentWorld(world);
 expect(useGameStore.getState().readingView).toBeNull();expect(useGameStore.getState().readingSegments).toBeNull();
});
