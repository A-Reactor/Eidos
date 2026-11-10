import { historyEvidence } from '@/lib/test/action-context';
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { advancePresentation,recordPresentationText,presentationCues } from '@/lib/game/presentation';
import { importWorldLineExport } from '@/lib/game/worldline-export';
import { loadMeta } from '@/lib/game/storage';
import { scopeStorageKey } from '@/lib/game/archive-scope';
import type { StorySegment } from '@/lib/ai/types';
import { continueActionTools } from '@/lib/game/action-tool-continuation';
import type { HistoryReadResult } from '@/lib/game/history-reader';
import { readHistory } from '@/lib/game/history-reader';

beforeEach(async()=>{
  vi.stubGlobal('crypto',webcrypto);
  const {world,snapshot}=buildRiftCityStartState();
  useGameStore.setState({...useGameStore.getInitialState(),phase:'playing',currentWorld:{...world,gameModeConfig:{rewind:{requires:{abilityReady:true}}},gameplayPlugins:[{format:'eidos-gameplay-plugin',version:1,id:'meta',name:'文字演出',release:'0.4.0',description:'原生文字演出',tags:[],rules:[],prompts:{creation:'',action:'',review:''},ui:{html:'<main></main>',reading:'inherit',presentation:'native-text'}}]},currentPlaythroughId:crypto.randomUUID()});
  useGameStore.getState().restoreSnapshot(snapshot);
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!,world.id);
});
afterEach(()=>vi.unstubAllGlobals());
async function step(text:string,textEffects?:StorySegment['textEffects']) {
  const state=useGameStore.getState();
  const node=await state.addActionNode({id:crypto.randomUUID(),timestamp:Date.now(),playerInput:text,aiResponse:text,summary:text,gameTime:state.gameTime,sceneId:state.currentSceneId,sceneName:'房间',timeSpent:{day:0,hour:0,minute:0},worldImpacts:[],snapshot:null},state.createSnapshot(),[{type:'narration',text,textEffects}],{reuseExisting:false});
  const live=useGameStore.getState(),nodes=advancePresentation(live.allNodes,node.id,0,text.length,true,0);
  useGameStore.setState({allNodes:nodes,currentNode:nodes[node.id]});
  useGameStore.getState().setNodeReadText(node.id,text);
  return useGameStore.getState().currentNode!;
}
it('preserves real accepted node effects through a game rewind, persisted worldline and portable import',async()=>{
  const target=await step('秘密姓名',[{kind:'mask',quote:'秘密',afterSegments:-1}]);
  await step('后来');useGameStore.setState({worldFlags:{abilityReady:true}});
  await useGameStore.getState().backtrackToNode(target.id,{sourceNodeId:useGameStore.getState().currentNode!.id,reason:'触发了回溯'});
  const arrival=useGameStore.getState().currentNode!;
  expect(arrival.id).not.toBe(target.id);expect(arrival.presentation?.replicaOf).toBe(target.id);
  useGameStore.getState().setNodeReadText(arrival.id,arrival.aiResponse);
  const live=useGameStore.getState();
  const shown=recordPresentationText(live.currentNode!,live.allNodes,arrival.id);
  expect(shown).not.toContain('秘密');expect(new Set(presentationCues(live.allNodes,arrival.id).map(c=>c.id)).size).toBe(2);
  await live.persistWorldLineData();
  const stored=await loadMeta<{nodes:typeof live.allNodes}>(scopeStorageKey(live,'worldline_data_'+live.worldLine!.id));
  expect(stored?.nodes[arrival.id].presentation?.cues[0].targetNode).toBe(arrival.id);
  const portable=await live.exportWorldLine(live.worldLine!.rootNodeId);
  const imported=await importWorldLineExport(portable,live.currentWorld!.id,crypto.randomUUID());
  expect(recordPresentationText(imported.allNodes[arrival.id],imported.allNodes,arrival.id)).toBe(shown);
  expect(imported.allNodes[arrival.id].aiResponse).toBe('秘密姓名');
});
it('indexes an old target before applying an accepted historical edit',async()=>{
  const old=await step('早年的秘密');
  const {presentation:_old,...legacy}=old;
  useGameStore.setState(s=>({allNodes:{...s.allNodes,[old.id]:legacy},currentNode:legacy}));
  const source=useGameStore.getState();
  // A new accepted response can target the actual old CAS text, without first opening a reader page.
  const text='她合上信。';
  const next=await source.addActionNode({id:crypto.randomUUID(),timestamp:Date.now(),playerInput:'重读旧信',aiResponse:text,summary:text,gameTime:source.gameTime,sceneId:source.currentSceneId,sceneName:'房间',timeSpent:{day:0,hour:0,minute:0},worldImpacts:[],snapshot:null},source.createSnapshot(),[{type:'narration',text,textEffects:[{kind:'mask',nodeId:old.id,segment:0,quote:'秘密',afterSegments:-1}]}],{reuseExisting:false});
  const live=useGameStore.getState(),nodes=advancePresentation(live.allNodes,next.id,0,text.length,true,0);
  expect(nodes[old.id].presentation).toBeDefined();expect(nodes[next.id].presentation?.errors).toEqual([]);
  expect(recordPresentationText(nodes[old.id],nodes,next.id)).not.toContain('秘密');
});

it('looks up a past step, returns a directly usable edit target and commits the historical change',async()=>{
  const old=await step('旧信里写着明天见。');await step('她把信放回抽屉。');
  const {presentation:_old,...legacy}=old;
  useGameStore.setState(s=>({allNodes:{...s.allNodes,[old.id]:legacy}}));
  const source=useGameStore.getState();let evidence:HistoryReadResult | undefined;
  const final=await continueActionTools({response:{historyRequest:{target:`第${old.stepNumber}步`,view:'both'}},historySource:source,session:null,
    context:{longMemoryContext:'',workspaceContext:{draftRoot:'drafts/history',mounts:[],results:[],nextOffset:null}},isCurrent:()=>true,onResponse(){},
    invoke:async context=>{
      evidence=historyEvidence(context)!;
      expect(evidence.segments?.[0].editTarget).toMatchObject({nodeId:old.id,segment:0,expectedRevision:evidence.presentationRevision});
      return {segments:[{type:'narration',text:'她重新看了一眼信。',textEffects:[{kind:'replace',...evidence.segments![0].editTarget,quote:'明天',value:'永不',afterSegments:-1}]}]};
    }});
  const next=await step(final.segments![0].text,final.segments![0].textEffects),live=useGameStore.getState();
  expect(next.presentation?.errors).toEqual([]);
  expect(recordPresentationText(live.allNodes[old.id],live.allNodes,next.id)).toBe('旧信里写着永不见。');
  expect(live.allNodes[old.id].aiResponse).toBe('旧信里写着明天见。');
});

it('commits an editRef against old CAS metadata and retains a later restoration through export/import',async()=>{
  const old=await step('旧信中的秘密');
  const {presentation:_old,...legacy}=old;
  useGameStore.setState(s=>({allNodes:{...s.allNodes,[old.id]:legacy},currentNode:legacy}));
  let editRef:string | undefined;
  await continueActionTools({response:{historyRequest:{nodeId:old.id,view:'both'}},historySource:useGameStore.getState(),session:null,
    context:{longMemoryContext:'',workspaceContext:{draftRoot:'drafts/history',mounts:[],results:[],nextOffset:null}},isCurrent:()=>true,onResponse(){},
    invoke:async context=>{const evidence=historyEvidence(context)!;editRef=evidence.segments![0].editRef;return {segments:[{type:'narration',text:'准备好了。'}]};}});
  expect(editRef).toEqual(expect.any(String));
  const masked=await step('她合上信。',[{kind:'mask',editRef,quote:'秘密',afterSegments:-1}]);
  expect(masked.presentation?.errors).toEqual([]);
  expect(recordPresentationText(useGameStore.getState().allNodes[old.id],useGameStore.getState().allNodes,masked.id)).not.toContain('秘密');
  const restored=await step('她打开信。',[{kind:'restore',effectId:masked.presentation!.cues[0].id,afterSegments:-1}]);
  const live=useGameStore.getState();
  expect(restored.presentation?.errors).toEqual([]);expect(readHistory(live,{nodeId:old.id,view:'both'}).displayText).toBe('旧信中的秘密');
  await live.persistWorldLineData();
  const portable=await live.exportWorldLine(live.worldLine!.rootNodeId),imported=await importWorldLineExport(portable,live.currentWorld!.id,crypto.randomUUID());
  expect(recordPresentationText(imported.allNodes[old.id],imported.allNodes,restored.id)).toBe('旧信中的秘密');
  expect(presentationCues(imported.allNodes,restored.id).find(c=>c.id===masked.presentation!.cues[0].id)?.cancelled).toBe(true);
});
