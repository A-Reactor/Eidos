// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {GameplayModSurface} from '@/components/game/GameplayModSurface';
import {useGameStore} from '@/store/game-store';
import {buildRiftCityStartState} from '@/lib/test/fixtures';
import {parsePluginFile} from '@/lib/game/plugins/manifest';
import {buildModScene} from '@/lib/game/plugins/world-interaction';
const plugin={format:'eidos-gameplay-plugin',version:1,id:'chinese-room',name:'文字地图与角色扮演',description:'主世界地图',tags:[],prompts:{creation:'',action:'',review:''},rules:[],ui:{html:'<main>地图</main>',reading:'replace',initialState:{},presentation:'scene-map'}};
const reading={segments:[{type:'narration' as const,text:'当前已读正文'}],index:0,displayedText:'当前已读正文',complete:true,loading:false,error:null};
beforeEach(()=>{const{world,snapshot}=buildRiftCityStartState();useGameStore.setState({...useGameStore.getInitialState(),currentWorld:{...world,gameplayPlugins:parsePluginFile(plugin)}});useGameStore.getState().restoreSnapshot({...snapshot,gameplayModState:undefined});});afterEach(cleanup);
function mount(submit=vi.fn(),value:typeof reading & {inputBlocked?:boolean}=reading){render(React.createElement(GameplayModSurface,{reading:value,onSubmit:submit,onAdvance:vi.fn()}));const frame=screen.getByTitle('文字地图与角色扮演')as HTMLIFrameElement,post=vi.spyOn(frame.contentWindow!,'postMessage');const send=(id:string,params:object,method='world.interact')=>act(()=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{channel:'eidos-mod',token:frame.dataset.session,scope:frame.dataset.scope,command:'rpc',id,method,params}})));return{submit,frame,post,send};}
it('routes an authenticated map interaction through the normal action callback with visual state already captured',async()=>{const scene=buildModScene(useGameStore.getState())!,npc=scene.npcs[0];const submit=vi.fn(()=>{expect(useGameStore.getState().createSnapshot().gameplayModState?.['chinese-room'].positions).toEqual({[scene.id]:{x:3,y:4}});});const app=mount(submit);app.send('talk',{intent:{kind:'talk',targetId:npc.id},state:{positions:{[scene.id]:{x:3,y:4}}}});await waitFor(()=>expect(app.submit).toHaveBeenCalledWith(`与${npc.name}交谈。`));await waitFor(()=>expect(app.post).toHaveBeenCalledWith(expect.objectContaining({id:'talk',ok:true}),'*'));});
it('refuses forged references and duplicate requests without granting items or moving scenes',async()=>{let finish!:()=>void;const submit=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const app=mount(submit),scene=buildModScene(useGameStore.getState())!,before=useGameStore.getState().createSnapshot();app.send('bad',{intent:{kind:'talk',targetId:'secret-npc'}});await waitFor(()=>expect(app.post).toHaveBeenCalledWith(expect.objectContaining({id:'bad',ok:false}),'*'));expect(app.submit).not.toHaveBeenCalled();app.send('one',{intent:{kind:'talk',targetId:scene.npcs[0].id}});app.send('duplicate',{intent:{kind:'talk',targetId:scene.npcs[0].id}});expect(app.submit).toHaveBeenCalledTimes(1);expect(useGameStore.getState().createSnapshot()).toEqual(before);await act(async()=>finish());});
it('only publishes a structured public scene after the visible text is complete',()=>{const app=mount();act(()=>window.dispatchEvent(new MessageEvent('message',{source:app.frame.contentWindow,data:{channel:'eidos-mod',token:app.frame.dataset.session,command:'connect'}})));const context=app.post.mock.calls.at(-1)![0].context;expect(context.scene.id).toBe(useGameStore.getState().currentSceneId);expect(context.scene.npcs[0]).toEqual(expect.objectContaining({name:expect.any(String)}));expect(JSON.stringify(context.scene)).not.toContain('personality');});

it('authenticates read-only map-file access without exposing other generated documents',async()=>{
  const {storeResource}=await import('@/lib/game/workspace/resources');
  const resource=await storeResource({name:'map.json',mimeType:'application/json',text:'{"format":"eidos-scene-map","sceneId":"public"}'});
  const {currentWorld}=useGameStore.getState();
  const node={id:'map-node',actionId:'map-action',parentId:null,childIds:[],generationComplete:true,aiResponse:'门打开了',playerVisibleText:'门打开了',stepNumber:1,playerInput:'开门',summary:'开门',snapshotHash:'',segmentHash:'',createdAt:0,gameTime:{day:0,hour:8,minute:0},sceneId:useGameStore.getState().currentSceneId,sceneName:'当前地点',dayNumber:0,timeSpent:{day:0,hour:0,minute:0},worldImpacts:[]} satisfies import('@/lib/game/types').WorldLineNode;
  useGameStore.setState({currentNode:node,allNodes:{[node.id]:node},workspaceState:{'outputs/map-action/scene_map.txt':resource,'outputs/map-action/private.txt':resource}});
  const app=mount();
  act(()=>window.dispatchEvent(new MessageEvent('message',{source:app.frame.contentWindow,data:{channel:'eidos-mod',token:app.frame.dataset.session,command:'connect'}})));
  const context=app.post.mock.calls.at(-1)![0].context;
  expect(context.sceneMapFiles).toEqual([expect.objectContaining({path:'outputs/map-action/scene_map.txt',version:resource.id})]);
  app.send('read-map',{path:'outputs/map-action/scene_map.txt',version:resource.id},'world.files.read');
  await waitFor(()=>expect(app.post).toHaveBeenCalledWith(expect.objectContaining({id:'read-map',ok:true,result:expect.objectContaining({text:expect.stringContaining('eidos-scene-map')})}),'*'));
  app.send('read-private',{path:'outputs/map-action/private.txt',version:resource.id},'world.files.read');
  await waitFor(()=>expect(app.post).toHaveBeenCalledWith(expect.objectContaining({id:'read-private',ok:false}),'*'));
  expect(useGameStore.getState().currentWorld).toBe(currentWorld);expect(app.submit).not.toHaveBeenCalled();
});

it('rejects map interaction while the host menu owns input without hiding or changing the map state',async()=>{
 const app=mount(vi.fn(),{...reading,inputBlocked:true}),scene=buildModScene(useGameStore.getState())!,before=useGameStore.getState().createSnapshot();
 app.send('blocked-talk',{intent:{kind:'talk',targetId:scene.npcs[0].id}});
 await waitFor(()=>expect(app.post).toHaveBeenCalledWith(expect.objectContaining({id:'blocked-talk',ok:false}),'*'));
 expect(app.submit).not.toHaveBeenCalled();expect(useGameStore.getState().createSnapshot()).toEqual(before);
});
