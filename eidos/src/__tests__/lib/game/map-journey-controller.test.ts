// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { MapJourneyController } from '@/lib/game/map-journey-controller';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { Scene, WorldLineNode } from '@/lib/game/types';
const originals = { addActionNode: useGameStore.getState().addActionNode, requestAutoSave: useGameStore.getState().requestAutoSave };
const steps = [{from:'a',to:'b',arrived:true,text:'B 的街角亮着灯。',minutes:2},{from:'b',to:'c',arrived:true,text:'C 的广场有风。',minutes:3},{from:'c',to:'d',arrived:true,text:'D 的钟声响起。',minutes:4}];
const request = {worldId:'journey',from:'a',to:'d',path:['a','b','c','d']};
const callbacks=()=>({ready:vi.fn(),present:vi.fn(),loading:vi.fn(),stopped:vi.fn(),error:vi.fn()});
let controller:MapJourneyController;
beforeEach(() => {
  const world = buildRiftCityStartState().world; world.id='journey';
  world.regions={r:{id:'r',name:'城区',description:'',scenes:Object.fromEntries(['a','b','c','d'].map((id,i,ids)=>[id,{id,name:id.toUpperCase(),region:'r',connections:ids[i+1]?[ids[i+1]]:[],initialDescription:'',npcs:[],secrets:[],detailLevel:10,discoveredSecrets:[]} as Scene]))}};
  useGameStore.setState({currentWorld:world,currentSceneId:'a',currentScene:world.regions.r.scenes.a,visitedScenes:['a','b','c','d'],history:[],currentNode:null,currentPlaythroughId:'pt',phase:'playing',gameTime:{day:0,hour:8,minute:0},savedSegments:[],allNodes:{},requestAutoSave:vi.fn(),addActionNode:vi.fn(async record=>{
    const node={id:record.id,aiResponse:record.aiResponse,playerVisibleText:'',sceneId:record.sceneId} as WorldLineNode;
    useGameStore.setState(s=>({currentNode:node,allNodes:{...s.allNodes,[node.id]:node}}));return node;
  })});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({travelSegments:steps}),{status:200})));
});
afterEach(async()=>{await controller?.stop();useGameStore.setState(originals);vi.unstubAllGlobals();});
it('generates once, commits each reached segment and drops the rest on input interruption', async()=>{
  const cb=callbacks(); controller=new MapJourneyController(request,cb);
  await controller.start();
  expect(useGameStore.getState().currentSceneId).toBe('b');
  expect(useGameStore.getState().history).toHaveLength(1);
  expect(useGameStore.getState().gameTime.minute).toBe(2);
  await controller.advance(); await controller.stop(); await controller.advance();
  expect(useGameStore.getState().currentSceneId).toBe('c');
  expect(useGameStore.getState().gameTime.minute).toBe(5);
  expect(cb.present.mock.calls).toEqual([[0],[1]]);
  expect(cb.stopped).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(useGameStore.getState().serializeState())).not.toContain('D 的钟声');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(useGameStore.getState().addActionNode).mock.calls.map(call=>call[1].currentSceneId)).toEqual(['b','c']);
});
it('stays at the origin of an obstructed segment', async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({travelSegments:[{...steps[0],arrived:false,text:'门口封闭，仍停在 A。'}]}))));
  controller=new MapJourneyController(request,callbacks());await controller.start();await controller.advance();
  expect(useGameStore.getState().currentSceneId).toBe('a');
  expect(useGameStore.getState().history).toHaveLength(1);
});
it('does not apply a late response after interruption before departure', async()=>{
  let resolve!:(response:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(done=>{resolve=done;})));
  controller=new MapJourneyController(request,callbacks());const pending=controller.start();await controller.stop();
  resolve(new Response(JSON.stringify({travelSegments:steps})));await pending;
  expect(useGameStore.getState().currentSceneId).toBe('a');expect(useGameStore.getState().history).toHaveLength(0);
});
it('rechecks each edge, avoiding a newly blocked road',async()=>{
  const cb=callbacks();controller=new MapJourneyController(request,cb);await controller.start();
  useGameStore.getState().applyMapUpdates({routes:[{from:'b',to:'c',status:'blocked',bidirectional:false}]});
  await controller.advance();
  expect(useGameStore.getState().currentSceneId).toBe('b');expect(cb.error).toHaveBeenCalledWith('通路已经变化，旅行停在当前位置。');
});
it('cancels future segments on loading another branch',async()=>{
  controller=new MapJourneyController(request,callbacks());await controller.start();
  useGameStore.setState({currentSceneId:'a',currentNode:null});await controller.advance();
  expect(useGameStore.getState().currentSceneId).toBe('a');expect(useGameStore.getState().history).toHaveLength(1);
});
