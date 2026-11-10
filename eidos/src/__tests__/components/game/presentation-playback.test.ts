// @vitest-environment jsdom
import React from 'react';
import { act,cleanup,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { NarrativeText } from '@/components/game/NarrativeText';
import { usePresentationPlayback } from '@/components/game/use-presentation-playback';
import { compilePresentation,recordPresentationText,advancePresentation,stagePresentationDraft,presentedSpeech } from '@/lib/game/presentation';
import { ReadingScreen } from '@/components/game/ReadingScreen';
import { SegmentGlyphField } from '@/components/game/SegmentGlyphField';
import { PresentationDim } from '@/components/game/PresentationDim';
import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '@/lib/game/types';
const segments:StorySegment[]=[{type:'narration',text:'秘密姓名',textEffects:[{kind:'mask',quote:'秘密',afterSegments:0,delayMs:100}]},{type:'narration',text:'第二段'}];
function setup(prose=segments) {
  const {world}=buildRiftCityStartState();
  const node={id:'a',parentId:null,stepNumber:1,playerInput:'听她说',aiResponse:prose.map(s=>s.text).join('\n\n'),playerVisibleText:prose.map(s=>s.text).join('\n\n'),summary:'',childIds:[],snapshotHash:'',segmentHash:'',createdAt:0,gameTime:{day:1,hour:0,minute:0},dayNumber:1,sceneId:'',sceneName:'',timeSpent:{day:0,hour:0,minute:0},worldImpacts:[],generationComplete:true} as WorldLineNode;
  node.presentation=compilePresentation(node,prose,{});
  useGameStore.setState({...useGameStore.getInitialState(),phase:'playing',currentWorld:{...world,gameplayPlugins:[{format:'eidos-gameplay-plugin',version:1,id:'text',name:'文字演出',description:'',tags:[],rules:[],prompts:{creation:'',action:'',review:''},ui:{html:'',reading:'inherit',presentation:'native-text'}}]},currentNode:node,allNodes:{a:node},persistWorldLineData:vi.fn().mockResolvedValue(undefined)});
}
function Playback({index=0,active=true,chars=4,prose=segments}:{index?:number;active?:boolean;chars?:number;prose?:StorySegment[]}) {
  usePresentationPlayback({nodeId:'a',segments:prose,index,chars,complete:chars===prose[index].text.length,showing:true,active});
  return React.createElement('p',{'data-testid':'copyable'},React.createElement(NarrativeText,{text:prose[0].text,source:prose[0].text,effects:prose[0].textEffects,nodeId:'a',segmentIndex:0}));
}
beforeEach(()=>{localStorage.clear();setup();vi.useFakeTimers();});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('retains the replacement on remount and exposes only garbled characters to a normal selection',()=>{
  const view=render(React.createElement(Playback));
  expect(screen.getByTestId('copyable').textContent).toBe('秘密姓名');
  act(()=>vi.advanceTimersByTime(100));
  expect(screen.getByTestId('copyable').textContent).not.toContain('秘密');
  const range=document.createRange();range.selectNodeContents(screen.getByTestId('copyable'));
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  expect(selection.toString()).not.toContain('秘密');expect(selection.toString()).toContain('姓名');
  view.unmount();render(React.createElement(Playback,{active:false}));
  expect(screen.getByTestId('copyable').textContent).not.toContain('秘密');
  expect(useGameStore.getState().currentNode!.aiResponse).toContain('秘密');
});
it('keeps a saved effect visible when a stale action acceptance flag accompanies a reopened record',()=>{
  const state=useGameStore.getState(),nodes=advancePresentation(state.allNodes,'a',0,4,true,100);
  useGameStore.setState({allNodes:nodes,currentNode:nodes.a});
  function Reopened() {
    usePresentationPlayback({key:'reopened:saved-record',accepted:false,nodeId:'a',segments,index:0,chars:4,complete:true,showing:true,active:true});
    return React.createElement(NarrativeText,{text:segments[0].text,effects:segments[0].textEffects,nodeId:'a',segmentIndex:0,playbackKey:'reopened:saved-record'});
  }
  const view=render(React.createElement(Reopened));
  expect(view.container.textContent).not.toContain('秘密');
  act(()=>vi.advanceTimersByTime(50));
  expect(view.container.textContent).not.toContain('秘密');
});
it('uses a saved record instead of an unrelated draft during a page handoff, including speech',()=>{
  const state=useGameStore.getState(),nodes=advancePresentation(state.allNodes,'a',0,4,true,100);
  useGameStore.setState({allNodes:nodes,currentNode:nodes.a});
  const key='reopened:stale-preview';
  stagePresentationDraft({key,segments,index:0,chars:4,complete:true,showing:true,elapsed:0,legacy:false});
  const view=render(React.createElement(NarrativeText,{text:segments[0].text,effects:segments[0].textEffects,nodeId:'a',segmentIndex:0,playbackKey:key}));
  expect(view.container.textContent).not.toContain('秘密');
  expect(presentedSpeech(segments[0],nodes,'a','a',0,key).text).toBe('姓名');
});
it('plays a fresh glitch once but shows its settled result after switching away and reopening the node',()=>{
  const prose:StorySegment[]=[{type:'narration',text:'故障文字',textEffects:[{kind:'fracture',afterSegments:0}]}];setup(prose);
  const state=useGameStore.getState(),a=state.currentNode!,next:StorySegment[]=[{type:'narration',text:'下一行动'}];
  const b={...a,id:'b',parentId:'a',aiResponse:'下一行动',playerVisibleText:'下一行动'};
  b.presentation=compilePresentation(b,next,state.allNodes);
  useGameStore.setState({allNodes:{a,b}});
  function Cursor({id='a',lines=prose}:{id?:string;lines?:StorySegment[]}) {
    usePresentationPlayback({nodeId:id,segments:lines,index:0,chars:4,complete:true,showing:true,active:true});
    return React.createElement(NarrativeText,{text:lines[0].text,nodeId:id,segmentIndex:0,animate:true});
  }
  const view=render(React.createElement(Cursor));
  expect(view.container.querySelector('.is-fracture')).not.toBeNull();
  expect(view.container.querySelector('.is-fracture')?.hasAttribute('data-static')).toBe(false);
  act(()=>useGameStore.setState(s=>({currentNode:s.allNodes.b})));
  view.rerender(React.createElement(Cursor,{id:'b',lines:next}));
  act(()=>useGameStore.setState(s=>({currentNode:s.allNodes.a})));
  view.rerender(React.createElement(Cursor));
  expect(view.container.querySelector('.is-fracture')?.hasAttribute('data-static')).toBe(true);
  expect(view.container.textContent).toBe('故障文字');
});
it('advances deferred cues once, while simply rendering a full record does not advance them',()=>{
  const prose:StorySegment[]=[{...segments[0],textEffects:[{kind:'mask',quote:'秘密',afterSegments:1}]},segments[1]];setup(prose);
  const view=render(React.createElement(Playback,{prose}));act(()=>vi.advanceTimersByTime(500));
  expect(screen.getByTestId('copyable').textContent).toContain('秘密');
  view.rerender(React.createElement(Playback,{prose,index:1,chars:1}));
  expect(screen.getByTestId('copyable').textContent).not.toContain('秘密');
});
it('uses the same static effects in the reading archive without leaking hidden search text',()=>{
  render(React.createElement(Playback));act(()=>vi.advanceTimersByTime(100));cleanup();
  useGameStore.setState({phase:'reading'});render(React.createElement(ReadingScreen));
  expect(screen.getByLabelText('第1步原文').textContent).not.toContain('秘密');
  expect(recordPresentationText(useGameStore.getState().currentNode!,useGameStore.getState().allNodes,'a')).not.toContain('秘密');
});
it('lets only the draft playback cursor trigger a shared effect, then carries it into the accepted node',()=>{
  const prose:StorySegment[]=[segments[0]];setup(prose);
  useGameStore.setState(s=>({currentNode:{...s.currentNode!,aiResponse:'上一段'},allNodes:{a:{...s.currentNode!,aiResponse:'上一段'}}}));
  const key='draft:unique-test';
  function Draft({chars=1,accepted=false}:{chars?:number;accepted?:boolean}) {
    usePresentationPlayback({key,accepted,nodeId:accepted ? 'new' : null,segments:prose,index:0,chars,complete:chars===4,showing:true,active:true});
    return React.createElement(React.Fragment,null,
      React.createElement('p',{'data-testid':'primary'},React.createElement(NarrativeText,{text:prose[0].text.slice(0,chars),source:prose[0].text,effects:prose[0].textEffects,nodeId:accepted ? 'new' : undefined,segmentIndex:0,playbackKey:key})),
      React.createElement('p',{'data-testid':'secondary'},React.createElement(NarrativeText,{text:prose[0].text,effects:prose[0].textEffects,nodeId:accepted ? 'new' : undefined,segmentIndex:0,playbackKey:key})));
  }
  const view=render(React.createElement(Draft));act(()=>vi.advanceTimersByTime(500));
  expect(screen.getByTestId('secondary').textContent).toBe('秘密姓名');expect(screen.getByTestId('primary').textContent).toBe('秘');
  view.rerender(React.createElement(Draft,{chars:4}));act(()=>vi.advanceTimersByTime(100));
  expect(screen.getByTestId('primary').textContent).not.toContain('秘密');expect(screen.getByTestId('secondary').textContent).not.toContain('秘密');
  const next={...useGameStore.getState().currentNode!,id:'new',aiResponse:'秘密姓名',playerVisibleText:'秘密姓名'};next.presentation=compilePresentation(next,prose,{});
  act(()=>useGameStore.setState({currentNode:next,allNodes:{new:next}}));
  view.rerender(React.createElement(Draft,{chars:4,accepted:true}));
  expect(screen.getByTestId('primary').textContent).not.toContain('秘密');expect(useGameStore.getState().currentNode!.presentation!.fired['new:0:0']).toBe(true);
});
it('preserves whitespace and settled masks when the main native display is replayed',()=>{
  const prose:StorySegment[]=[{type:'narration',text:' 秘密\n姓名 ',textEffects:[{kind:'mask',quote:'秘密',afterSegments:-1}]}];setup(prose);
  const view=render(React.createElement(SegmentGlyphField,{currentSegment:prose[0],displayedText:prose[0].text,sceneName:'地点',nodeId:'a',segmentIndex:0}));
  expect(view.container.textContent).not.toContain('秘密');expect(view.container.textContent).toContain('\n姓名 ');
});

it('shades the window outside clipped and transformed game containers and cleans up on unmount',()=>{
  setup([{type:'narration',text:'灯暗了。',textEffects:[{kind:'dim',brightness:0.2,transitionMs:0,afterSegments:-1}]}]);
  const view=render(React.createElement('div',{style:{transform:'translateX(0)',overflow:'hidden',height:100}},React.createElement(PresentationDim)));
  const shade=document.body.querySelector('.eidos-presentation-dim');
  expect(shade?.parentElement).toBe(document.body);
  expect(view.container.contains(shade)).toBe(false);
  expect(shade?.getAttribute('style')).toContain('opacity: 0.8');
  expect(shade?.getAttribute('aria-hidden')).toBe('true');
  view.unmount();
  expect(document.body.querySelector('.eidos-presentation-dim')).toBeNull();
});

it('retains window lighting over in-game screens and clears it when leaving the game',()=>{
  setup([{type:'narration',text:'灯暗了。',textEffects:[{kind:'dim',brightness:0.2,transitionMs:0,afterSegments:-1}]}]);
  render(React.createElement(PresentationDim));
  for (const phase of ['reading','world_line_view','settings','playing'] as const) {
    act(()=>useGameStore.setState({phase}));
    expect(document.body.querySelector('.eidos-presentation-dim')?.getAttribute('style')).toContain('opacity: 0.8');
  }
  for (const phase of ['world_select','title','world_create','identity'] as const) {
    act(()=>useGameStore.setState({phase}));
    expect(document.body.querySelector('.eidos-presentation-dim')).toBeNull();
  }
});

it('keeps an explicitly set brightness across paragraphs and restores it only on a later command',()=>{
  const prose:StorySegment[]=[{type:'narration',text:'灯暗了。',textEffects:[{kind:'dim',brightness:0.2,transitionMs:100}]},{type:'narration',text:'她还在说话。'}];setup(prose);
  function Lighting({id='a',index=0,segments=prose}:{id?:string;index?:number;segments?:StorySegment[]}) {
    usePresentationPlayback({nodeId:id,segments,index,chars:segments[index].text.length,complete:true,showing:true,active:true});
    return React.createElement(PresentationDim);
  }
  const view=render(React.createElement(Lighting));act(()=>vi.advanceTimersByTime(2000));
  expect(document.body.querySelector('.eidos-presentation-dim')?.getAttribute('style')).toContain('opacity: 0.8');
  view.rerender(React.createElement(Lighting,{index:1}));
  expect(document.body.querySelector('.eidos-presentation-dim')?.getAttribute('style')).toContain('opacity: 0.8');
  const live=useGameStore.getState(),restored=JSON.parse(JSON.stringify(live.allNodes));
  act(()=>useGameStore.setState({allNodes:restored,currentNode:restored.a}));
  view.unmount();const replay=render(React.createElement(Lighting,{index:1}));
  expect(document.body.querySelector('.eidos-presentation-dim')?.getAttribute('style')).toContain('opacity: 0.8');
  const reset:StorySegment[]=[{type:'narration',text:'灯亮了。',textEffects:[{kind:'dim',brightness:1,transitionMs:100}]}];
  const next={...restored.a,id:'b',parentId:'a',aiResponse:reset[0].text,playerVisibleText:reset[0].text};next.presentation=compilePresentation(next,reset,restored);
  act(()=>useGameStore.setState({allNodes:{...restored,b:next},currentNode:next}));
  replay.rerender(React.createElement(Lighting,{id:'b',segments:reset}));act(()=>vi.advanceTimersByTime(150));
  expect(document.body.querySelector('.eidos-presentation-dim')).toBeNull();
  expect(recordPresentationText(restored.a,restored,'a')).toBe('灯暗了。\n\n她还在说话。');
});

it('inherits the current brightness while the next action is still a draft',()=>{
  const prose:StorySegment[]=[{type:'narration',text:'灯暗了。',textEffects:[{kind:'dim',brightness:0.3,transitionMs:0,afterSegments:-1}]}];setup(prose);
  function DraftLighting({draft=false}:{draft?:boolean}) {
    usePresentationPlayback({key:'light:next-draft',accepted:!draft,nodeId:draft ? null : 'a',segments:draft ? [{type:'narration',text:'接下来'}] : prose,index:0,chars:4,complete:true,showing:true,active:true});
    return React.createElement(PresentationDim,{playbackKey:'light:next-draft'});
  }
  const view=render(React.createElement(DraftLighting));act(()=>vi.advanceTimersByTime(2000));
  view.rerender(React.createElement(DraftLighting,{draft:true}));
  expect(document.body.querySelector('.eidos-presentation-dim')?.getAttribute('style')).toContain('opacity: 0.7');
  act(()=>useGameStore.setState(s=>({currentWorld:{...s.currentWorld!,gameplayPlugins:s.currentWorld!.gameplayPlugins!.map(p=>({...p,activation:{requires:{awake:true}}}))},worldFlags:{awake:false}})));
  expect(document.body.querySelector('.eidos-presentation-dim')).toBeNull();
});

it('keeps the legacy dim pulse temporary when no brightness is declared',()=>{
  const prose:StorySegment[]=[{type:'narration',text:'灯闪了一下。',textEffects:[{kind:'dim'}]}];setup(prose);
  function Pulse() {usePresentationPlayback({nodeId:'a',segments:prose,index:0,chars:6,complete:true,showing:true,active:true});return React.createElement(PresentationDim);}
  render(React.createElement(Pulse));act(()=>vi.advanceTimersByTime(500));
  expect(document.body.querySelector('.eidos-presentation-dim')).not.toBeNull();
  act(()=>vi.advanceTimersByTime(2000));expect(document.body.querySelector('.eidos-presentation-dim')).toBeNull();
});

it('uses a historical restoration in the native text and reading archive while retaining its color',()=>{
  const prose:StorySegment[]=[{type:'narration',text:'秘密姓名',textEffects:[{kind:'mask',quote:'秘密',afterSegments:-1},{kind:'color',quote:'秘密',value:'blood',afterSegments:-1}]}];setup(prose);
  const current=useGameStore.getState(),a=current.currentNode!;
  const next={...a,id:'b',parentId:'a',aiResponse:'恢复',playerVisibleText:'恢复',stepNumber:2};
  next.presentation=compilePresentation(next,[{type:'narration',text:'恢复',textEffects:[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]}],current.allNodes);
  const nodes=advancePresentation({...current.allNodes,b:next},'b',0,2,true,0);
  useGameStore.setState({allNodes:nodes,currentNode:nodes.b});
  const view=render(React.createElement(NarrativeText,{text:a.aiResponse,nodeId:'a',segmentIndex:0}));
  expect(view.container.textContent).toBe('秘密姓名');expect(view.container.querySelector('.is-mask')).toBeNull();expect(view.container.querySelector('.is-color-blood')).not.toBeNull();
  view.unmount();useGameStore.setState({phase:'reading'});render(React.createElement(ReadingScreen));
  expect(screen.getByLabelText('第1步原文').textContent).toContain('秘密姓名');
});
