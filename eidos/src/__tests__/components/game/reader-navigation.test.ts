import { actionEvidence } from '@/lib/test/action-context';
import * as cas from '@/lib/game/cas-storage';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
// @vitest-environment jsdom
import React from 'react';
import 'fake-indexeddb/auto';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { act,cleanup,render,screen,fireEvent,waitFor } from '@testing-library/react';
import { GameScreen } from '@/components/game/GameScreen';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { storeBlob,hashAndStore } from '@/lib/game/cas-storage';
import { webcrypto } from 'node:crypto';
import { compilePresentation,advancePresentation } from '@/lib/game/presentation';
import { saveSettings,loadSettings } from '@/lib/game/settings';
import type { WorldLineNode } from '@/lib/game/types';
import { HOST_SHORTCUT_EVENT } from '@/lib/game/keyboard-shortcuts';
vi.mock('@/lib/game/momoi/use-momoi-playback',()=>({useMomoiPlayback:()=>({isPlaying:false,isGenerating:false,replay(){},stop(){}})}));
vi.mock('@/lib/game/momoi/service-status',()=>({useVoiceServiceMonitor(){},voiceStatusLabel:()=> '关闭'}));
vi.mock('@/lib/game/midori/image-manager',()=>({ensureImage:async()=>null}));
beforeEach(async()=>{
 localStorage.clear();saveSettings({...loadSettings(),autoAdvance:false,autoSelect:false,enableSpeculation:false});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({validity:{isPossible:false,reason:'测试不执行行动'}})));
 vi.stubGlobal('crypto',webcrypto);
 const {world,snapshot}=buildRiftCityStartState();
 const past={id:'reader-past',parentId:null,childIds:['reader-now'],stepNumber:3,playerInput:'旧时的选择',aiResponse:'信上写着去左门。',playerVisibleText:'信上写着去左门。',summary:'旧信',worldImpacts:[],snapshotHash:'',segmentHash:'reader-past',createdAt:1,gameTime:{day:0,hour:8,minute:0},dayNumber:0,sceneId:'',sceneName:'房间',timeSpent:{day:0,hour:0,minute:0},availableActions:['走向右门'],generationComplete:true} as WorldLineNode;
 const now={...past,id:'reader-now',parentId:past.id,childIds:[],stepNumber:6,playerInput:'后来',aiResponse:'当前的故事继续。',playerVisibleText:'当前的故事继续。',segmentHash:'reader-now'};
 past.snapshotHash=await hashAndStore('snapshot',snapshot);
 const oldLines=[{type:'narration' as const,text:past.aiResponse}],newLines=[{type:'narration' as const,text:now.aiResponse,textEffects:[{kind:'replace' as const,nodeId:past.id,quote:'左门',value:'右门',afterSegments:-1}]}];
 past.presentation=compilePresentation(past,oldLines,{});now.presentation=compilePresentation(now,newLines,{[past.id]:past});
 const nodes=advancePresentation({[past.id]:past,[now.id]:now},now.id,0,now.aiResponse.length,true,0);
 useGameStore.setState({...useGameStore.getInitialState(),phase:'playing',currentWorld:{...world,gameplayPlugins:[{format:'eidos-gameplay-plugin',version:1,id:'meta',name:'Meta',description:'原生文字演出',tags:[],rules:[],prompts:{creation:'',action:'',review:''},ui:{html:'<main></main>',presentation:'native-text',reading:'inherit'}}]},currentPlaythroughId:'reader-ui',currentNode:nodes[now.id],allNodes:nodes,savedSegments:newLines,savedIsShowingSegments:false,availableActions:['继续当前剧情'],history:[],momoiSettings:{...useGameStore.getState().momoiSettings,enabled:false},midoriSettings:{...useGameStore.getState().midoriSettings,enabled:false}});
 await storeBlob('reader-past','segments',oldLines);await storeBlob('reader-now','segments',newLines);
 useGameStore.getState().restoreSnapshot(snapshot);
 useGameStore.setState({worldFlags:{futureOnly:true},sceneNarrative:now.aiResponse,worldLine:{id:'reader-ui-line',playthroughId:'reader-ui',worldId:world.id,rootNodeId:past.id,currentNodeId:now.id,allNodeIds:[past.id,now.id],totalSteps:6,branchCount:0,createdAt:0,updatedAt:0}});
});
function submitHistoricalAction(source:'choice'|'input') {
 if(source==='choice') {
  fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));
  fireEvent.click(screen.getByRole('button',{name:'走向右门'}));
 } else {
  const input=screen.getByRole('textbox',{name:'行动输入'});
  fireEvent.change(input,{target:{value:'从这里走向右门'}});
  fireEvent.keyDown(input,{key:'Enter'});
 }
}
it('uses the viewed historical snapshot and reference for a typed action without changing live progress on rejection',async()=>{
 const requests:Record<string,unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async (url,init)=>{if(String(url).startsWith('/api/game/action')) requests.push(JSON.parse(String(init?.body)));return Response.json({validity:{isPossible:false,reason:'测试不执行行动'}});}));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.change(screen.getByRole('textbox',{name:'行动输入'}),{target:{value:'检查这封信'}});
 fireEvent.keyDown(screen.getByRole('textbox',{name:'行动输入'}),{key:'Enter'});
 await waitFor(()=>expect(requests.length).toBeGreaterThan(0));
 expect((requests[0].snapshot as any).worldFlags.futureOnly).toBeUndefined();
 expect(String(actionEvidence(requests[0]))).toContain('branchOrigin');
 expect(String(actionEvidence(requests[0]))).toContain('去右门');
 expect(String(actionEvidence(requests[0]))).toContain('reader-past');
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
});
it('retains the draft and live route when the viewed historical snapshot is missing instead of submitting at the live head', async () => {
 const requests:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url)=>{if(String(url).startsWith('/api/game/action')) requests.push(url);return Response.json({});}));
 useGameStore.setState(state=>({allNodes:{...state.allNodes,'reader-past':{...state.allNodes['reader-past'],snapshotHash:'missing-history-snapshot'}}}));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 submitHistoricalAction('input');
 await screen.findByText('历史场景内容缺失');
 expect(requests).toHaveLength(0);
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
 expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past');
 expect((screen.getByRole('textbox',{name:'行动输入'}) as HTMLTextAreaElement).value).toBe('从这里走向右门');
});
it.each([[false,'choice'],[true,'choice'],[false,'input'],[true,'input']] as const)('keeps live progress until a historical action is accepted, streaming=%s, source=%s',async (streaming,source)=>{
 localStorage.setItem('eidos_stream_mode',JSON.stringify(streaming));
 let resolve!:(response:Response)=>void;let body:Record<string,any>|undefined;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>String(url).startsWith('/api/game/action') ? new Promise<Response>(done=>{body=JSON.parse(String(init?.body));resolve=done;}) : Response.json({})));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 submitHistoricalAction(source);
 await waitFor(()=>expect(body).toBeDefined());
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');expect(body!.snapshot.worldFlags.futureOnly).toBeUndefined();
 expect(body!.snapshot.sceneNarrative).toContain('去右门');
 const response={segments:[{type:'narration',text:'你走向右门。'}],timeSpent:{day:0,hour:0,minute:0},availableActions:['继续']};
 await act(async()=>resolve(streaming ? new Response(`data: ${JSON.stringify({type:'segments',segments:response.segments})}\n\ndata: ${JSON.stringify({type:'done',...response})}\n\n`) : Response.json(response)));
 await waitFor(()=>expect(useGameStore.getState().currentNode?.aiResponse).toBe('你走向右门。'));
 const state=useGameStore.getState();
 expect(state.currentNode!.parentId).toBe('reader-past');expect(state.currentNode!.entry?.originNodeId).toBe('reader-now');
 expect(state.worldFlags.futureOnly).toBeUndefined();expect(state.allNodes['reader-now'].aiResponse).toBe('当前的故事继续。');
});
afterEach(()=>{cleanup();abortActiveStream();vi.unstubAllGlobals();});

it('uses the same action number in the real tree and reader for a fork',async()=>{
 const state=useGameStore.getState(),past=state.allNodes['reader-past'];
 const current={...state.allNodes['reader-now'],parentId:past.id,stepNumber:4,
  entry:{version:1 as const,id:'entry-navigation',sourceNodeId:past.id,originNodeId:'other',changes:[],presentationOrder:1,snapshotHash:'before'}};
 useGameStore.setState({allNodes:{[past.id]:{...past,childIds:[current.id]},[current.id]:current},currentNode:current});
 render(React.createElement(GameScreen));expect(screen.getByRole('img',{name:'节点深度 4'})).toBeDefined();
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe(past.id));
 expect(screen.getByLabelText('当前段落字形场').textContent).toContain('去右门');
 expect(useGameStore.getState().currentNode?.stepNumber).toBe(4);
});

async function seedMultiSegmentRecord() {
 const lines=[{type:'narration' as const,text:'旧记录第一段。'},{type:'narration' as const,text:'旧记录第二段。'},{type:'narration' as const,text:'旧记录第三段。'}];
 const text=lines.map(line=>line.text).join('\n\n');
 const segmentHash=await hashAndStore('segments',lines);
 useGameStore.setState(state=>({allNodes:{...state.allNodes,'reader-past':{...state.allNodes['reader-past'],segmentHash,aiResponse:text,playerVisibleText:text,presentation:undefined}}}));
}

it('previews arrow-selected records without selecting their first paragraph',async()=>{
 await seedMultiSegmentRecord();
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
 expect(view.container.querySelector('[data-record-segment][data-current-record-segment]')).toBeNull();
});

it.each([false,true])('advances the selected historical paragraph from the main scene, phone=%s',async phone=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:phone,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 await seedMultiSegmentRecord();
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(view.container.querySelector('.eidos-record-page:not(.is-outgoing) [data-record-segment="0"] [data-reading-text]')!);
 fireEvent.click(view.container.querySelector('[data-story-stage]')!);
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(1);
 expect(view.container.querySelector('.eidos-record-page:not(.is-outgoing) [data-current-record-segment]')?.getAttribute('data-record-segment')).toBe('1');
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
 expect(useGameStore.getState().savedIsShowingSegments).toBe(false);
 expect(useGameStore.getState().savedSegmentIndex).toBe(0);
});

it('uses reading shortcuts on the historical cursor without changing the live segment',async()=>{
 await seedMultiSegmentRecord();
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(view.container.querySelector('.eidos-record-page:not(.is-outgoing) [data-record-segment="1"] [data-reading-text]')!);
 act(()=>window.dispatchEvent(new CustomEvent(HOST_SHORTCUT_EVENT,{detail:'previous'})));
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(0);
 act(()=>window.dispatchEvent(new CustomEvent(HOST_SHORTCUT_EVENT,{detail:'advance'})));
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(1);
 expect(useGameStore.getState().savedSegmentIndex).toBe(0);
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
});

it.each(['visual', 'classic'])('returns to unfinished live progress without selecting the rail, with record following in %s layout',async layout=>{
 localStorage.setItem('eidos_story_display_mode',layout);
 useGameStore.setState({savedIsShowingSegments:true});
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(screen.getByRole('button',{name:'下一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView).toBeNull());
 expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
 const playing=view.container.querySelector('.eidos-record-page:not(.is-outgoing) [data-current-record-segment]');
 if(layout==='visual') expect(playing?.getAttribute('data-record-segment')).toBe('0');
 else expect(playing).toBeNull();
 expect(useGameStore.getState().savedIsShowingSegments).toBe(true);
});

it('turns action-record arrows into a read-only cursor while retaining later edits and live progress',async()=>{
 const before=useGameStore.getState(),time=before.gameTime,heads=before.documentHeads;
 const view=render(React.createElement(GameScreen));
 expect(screen.getByRole('img',{name:'节点深度 6'})).toBeDefined();
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');expect(useGameStore.getState().gameTime).toBe(time);expect(useGameStore.getState().documentHeads).toBe(heads);
 await waitFor(()=>expect(view.container.querySelector('.eidos-record-page:not(.is-outgoing)')?.textContent).toContain('去右门'));
 expect(useGameStore.getState().currentNode?.stepNumber).toBe(6);
 expect(screen.getByRole('img',{name:'节点深度 3'})).toBeDefined();
 expect(screen.getByLabelText('当前段落字形场').textContent).toContain('去右门');
 expect(view.container.querySelector('.eidos-record-page:not(.is-outgoing) h2')?.textContent).toBe('行动记录');
 expect(screen.queryByText(/正在回看|回看记录|从这里另作选择/)).toBeNull();
 expect(screen.getByRole('textbox',{name:'行动输入'}).getAttribute('placeholder')).toBe('描述你的行动…');
 fireEvent.click(screen.getByRole('button',{name:'下一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView).toBeNull());
 expect(screen.getByRole('img',{name:'节点深度 6'})).toBeDefined();
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
});

it.each(['choice','input'] as const)('retains branch origin and reading references through an offline queue, source=%s',async source=>{
 localStorage.setItem('eidos_stream_mode','false');
 const requests:Record<string,any>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{if(String(url).startsWith('/api/game/action')) requests.push(JSON.parse(String(init?.body)));return Response.json({validity:{isPossible:false,reason:'read only'}});}));
 render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 act(()=>window.dispatchEvent(new Event('offline')));
 submitHistoricalAction(source);
 await waitFor(()=>expect(screen.getByText(/离线模式——行动已排队/)).toBeDefined());
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
 act(()=>window.dispatchEvent(new Event('online')));
 await waitFor(()=>expect(requests.length).toBeGreaterThan(0));
 expect(requests[0].snapshot.worldFlags.futureOnly).toBeUndefined();
 expect(actionEvidence(requests[0])).toContain('reader-past');
});
it('consumes items from the historical inventory after the branch is accepted',async()=>{
 localStorage.setItem('eidos_stream_mode','false');
 const past=useGameStore.getState().allNodes['reader-past'];
 const snapshot=await cas.loadBlob(past.snapshotHash) as any;
 snapshot.inventory=[{id:'past-key',name:'旧钥匙',description:'历史背包中的钥匙',quantity:1,category:'key',consumable:true,value:0,acquiredFrom:'past',acquiredAt:{day:0,hour:8,minute:0}}];
 const hash=await cas.hashAndStore('snapshot',snapshot);
 useGameStore.setState(s=>({inventory:[],allNodes:{...s.allNodes,[past.id]:{...past,snapshotHash:hash}}}));
 vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).startsWith('/api/game/action') ? Response.json({segments:[{type:'narration',text:'你消耗旧钥匙，打开了门。'}],itemsUsed:['旧钥匙'],timeSpent:{day:0,hour:0,minute:0},availableActions:['继续']}) : Response.json({})));
 render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));
 fireEvent.click(screen.getByRole('button',{name:'走向右门'}));
 await waitFor(()=>expect(useGameStore.getState().currentNode?.aiResponse).toBe('你消耗旧钥匙，打开了门。'));
 expect(useGameStore.getState().inventory).toEqual([]);
});
it('uses pinned historical facts when SSE falls back to JSON',async()=>{
 useGameStore.setState({criticalFacts:[{text:'未来第六步才发现的密钥 FUTURE_SECRET',source:'test'} as any],weather:'雨'});
 const requests:Array<{url:string;body:Record<string,any>}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url).startsWith('/api/game/action')) requests.push({url:String(url),body:JSON.parse(String(init?.body))});
  if(String(url)==='/api/game/action/stream') return Response.json({error:'endpoint unavailable'},{status:404});
  return Response.json({validity:{isPossible:false,reason:'read only'}});
 }));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));fireEvent.click(screen.getByRole('button',{name:'走向右门'}));
 await waitFor(()=>expect(requests).toHaveLength(2));
 expect(JSON.stringify(requests[1].body.criticalFacts)).not.toContain('FUTURE_SECRET');
 expect(requests[1].body.weather).toEqual(requests[1].body.snapshot.weather);
});
it.each([['rejected','choice'],['error','choice'],['rejected','input'],['error','input']] as const)('leaves both worlds intact when a historical action is %s, source=%s',async (result,source)=>{
 localStorage.setItem('eidos_stream_mode','false');
 const before=useGameStore.getState(),head=before.currentNode,inventory=before.inventory;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(result==='rejected' ? {validity:{isPossible:false,reason:'门还锁着。'}} : {error:'本次生成失败'})));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 submitHistoricalAction(source);
 await waitFor(()=>expect(screen.getByText(result==='rejected' ? '门还锁着。' : '本次生成失败')).toBeDefined());
 expect(useGameStore.getState().currentNode).toBe(head);expect(useGameStore.getState().inventory).toBe(inventory);
 expect(Object.keys(useGameStore.getState().allNodes)).toEqual(Object.keys(before.allNodes));
 expect(useGameStore.getState().worldFlags.futureOnly).toBe(true);
});
it.each(['choice','input'] as const)('keeps the original route when a pending historical action is stopped, source=%s', async source => {
 localStorage.setItem('eidos_stream_mode','false');
 let resolve!:(response:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).startsWith('/api/game/action') ? new Promise<Response>(done=>{resolve=done;}) : Response.json({})));
 const before=useGameStore.getState();
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 submitHistoricalAction(source);
 await waitFor(()=>expect(resolve).toBeDefined());
 fireEvent.click(screen.getByRole('button',{name:'停止生成'}));
 await act(async()=>resolve(Response.json({segments:[{type:'narration',text:'不应接入的迟到结果。'}],timeSpent:{day:0,hour:0,minute:0}})));
 await waitFor(()=>expect(useGameStore.getState().isLoading).toBe(false));
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
 expect(Object.keys(useGameStore.getState().allNodes)).toEqual(Object.keys(before.allNodes));
 expect(useGameStore.getState().worldFlags.futureOnly).toBe(true);
});
it('keeps the historical snapshot and observed text through hidden history-tool rounds',async()=>{
 localStorage.setItem('eidos_stream_mode','false');
 const requests:Record<string,any>[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
   if(!String(url).startsWith('/api/game/action')) return Response.json({});
   requests.push(JSON.parse(String(init?.body)));
   return Response.json(requests.length===1 ? {historyRequest:{target:'第3步',view:'both'}} :
     {segments:[{type:'narration',text:'你循着变动的字迹，走向右门。'}],timeSpent:{day:0,hour:0,minute:0},availableActions:['继续']});
 }));
 render(React.createElement(GameScreen));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));fireEvent.click(screen.getByRole('button',{name:'走向右门'}));
 await waitFor(()=>expect(useGameStore.getState().currentNode?.aiResponse).toBe('你循着变动的字迹，走向右门。'));
 expect(requests).toHaveLength(2);
 for(const request of requests) {
   expect(request.snapshot.worldFlags.futureOnly).toBeUndefined();expect(request.snapshot.sceneNarrative).toContain('去右门');
   expect(actionEvidence(request)).toContain('reader-past');
 }
 expect(actionEvidence(requests[1])).toContain('editRef');
 expect(useGameStore.getState().allNodes['reader-now'].aiResponse).toBe('当前的故事继续。');
});

it('advances from the dialogue box through the same guarded reading cursor as the stage', async () => {
 const lines=[0,1,2].map(i=>({type:'dialogue' as const,speaker:'船夫',text:`旧对话第${i+1}段。`}));
 const text=lines.map(line=>`「${line.speaker}：${line.text}」`).join('\n\n'),segmentHash=await hashAndStore('segments',lines);
 useGameStore.setState(state=>({allNodes:{...state.allNodes,'reader-past':{...state.allNodes['reader-past'],segmentHash,aiResponse:text,playerVisibleText:text,presentation:undefined}}}));
 const view=render(React.createElement(GameScreen));
 fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(useGameStore.getState().readingView?.nodeId).toBe('reader-past'));
 fireEvent.click(view.container.querySelector('.eidos-record-page:not(.is-outgoing) [data-record-segment="0"] [data-reading-text]')!);
 fireEvent.click(screen.getByLabelText('当前对话读条'));
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'播放与快捷设置'}));
 fireEvent.click(screen.getByLabelText('当前对话读条'));
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(1);
 fireEvent.click(view.container.querySelector('[data-story-stage]')!);
 expect(useGameStore.getState().readingView?.segmentIndex).toBe(2);
 expect(useGameStore.getState().currentNode?.id).toBe('reader-now');
});
