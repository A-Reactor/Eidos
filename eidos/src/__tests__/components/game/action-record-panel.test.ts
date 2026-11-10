// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActionRecordPanel } from '@/components/game/ActionRecordPanel';
import { useGameStore } from '@/store/game-store';
import type { WorldLineNode } from '@/lib/game/types';
const node=(id:string,parentId:string|null,childIds:string[]):WorldLineNode=>({id,parentId,childIds,playerInput:`选择 ${id}`,aiResponse:id,summary:'',snapshotHash:'',segmentHash:'',stepNumber:1,createdAt:1,gameTime:{day:1,hour:8,minute:0},sceneId:id,sceneName:id,dayNumber:1,timeSpent:{day:0,hour:0,minute:1},worldImpacts:[],generationComplete:true});
const segments=[{type:'dialogue' as const,speaker:'船夫',text:'潮水涨了。'},{type:'narration' as const,text:'你望向对岸。'}];
const props=()=>({pageKey:0,segments,segmentIndex:0,showing:true,loading:false,fallback:'',actions:['看看桥下','问问船夫'],onAction:vi.fn(),onReplay:vi.fn(),onNavigate:vi.fn().mockResolvedValue(undefined),onFocusChange:vi.fn()});
beforeEach(()=>{const a=node('a',null,['b','c']),b=node('b','a',[]),c=node('c','a',[]);useGameStore.setState({currentNode:a,allNodes:{a,b,c}});});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reveals clickable dialogue-style suggestions only after ending the last segment',()=>{
 const p=props();const v=render(React.createElement(ActionRecordPanel,p));
 expect(screen.queryByRole('button',{name:/看看桥下/})).toBeNull();
 v.rerender(React.createElement(ActionRecordPanel,{...p,segmentIndex:1}));expect(screen.queryByLabelText('推荐行动')).toBeNull();
 v.rerender(React.createElement(ActionRecordPanel,{...p,showing:false}));fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));fireEvent.click(screen.getByRole('button',{name:/看看桥下/}));expect(p.onAction).toHaveBeenCalledWith('看看桥下');
});
it('offers branches before navigation and confirms keyboard selection with space',async()=>{
 const p=props();render(React.createElement(ActionRecordPanel,p));const panel=screen.getByRole('region',{name:'行动记录'});
 fireEvent.keyDown(panel,{key:'ArrowDown'});expect(p.onNavigate).not.toHaveBeenCalled();expect(screen.getByRole('group',{name:'选择后续分支'})).toBeTruthy();
 fireEvent.keyDown(panel,{key:'ArrowDown'});fireEvent.keyDown(panel,{key:' '});await waitFor(()=>expect(p.onNavigate).toHaveBeenCalledWith('c','down'));
});
it('moves to a parent with ArrowUp, and prevents duplicate navigation while pending',async()=>{
 useGameStore.setState({currentNode:useGameStore.getState().allNodes.b});const p=props();let finish!:()=>void;p.onNavigate.mockImplementation(()=>new Promise<void>(done=>{finish=done;}));
 render(React.createElement(ActionRecordPanel,p));const panel=screen.getByRole('region',{name:'行动记录'});
 fireEvent.keyDown(panel,{key:'ArrowUp'});fireEvent.keyDown(panel,{key:'ArrowUp'});expect(p.onNavigate).toHaveBeenCalledTimes(1);expect(p.onNavigate).toHaveBeenCalledWith('a','up');await act(async()=>finish());
});
function seedEntryChoices() {
 const source={...node('source',null,['old','new']),stepNumber:20,aiResponse:'源节点正文。',playerVisibleText:'源节点正文。'};
 const old={...node('old',source.id,[]),stepNumber:21,playerInput:'选择 A',aiResponse:'原路线正文。'};
 const fresh={...node('new',source.id,[]),stepNumber:21,playerInput:'选择 A',aiResponse:'新路线正文。',
  entry:{version:1 as const,id:'entry-new',sourceNodeId:source.id,originNodeId:old.id,changes:[],presentationOrder:1,snapshotHash:'before'}};
 useGameStore.setState({allNodes:{source,old,new:fresh},currentNode:source});
 return {source,old,fresh};
}
it('offers same-input branches with distinct entry contexts separately',async()=>{
 const {old,fresh}=seedEntryChoices(),p={...props(),showing:false,actions:[]};
 render(React.createElement(ActionRecordPanel,p));
 const choices=screen.getAllByRole('button',{name:'选择 A'});expect(choices).toHaveLength(2);
 fireEvent.click(choices[1]);await waitFor(()=>expect(p.onNavigate).toHaveBeenCalledWith(fresh.id,'down'));
 expect(useGameStore.getState().allNodes[old.id].aiResponse).toBe('原路线正文。');
});
it('moves from an entry-bearing action straight to its source record',async()=>{
 const {source,fresh}=seedEntryChoices();useGameStore.setState({currentNode:fresh});
 const p=props();render(React.createElement(ActionRecordPanel,p));fireEvent.click(screen.getByRole('button',{name:'上一行动记录'}));
 await waitFor(()=>expect(p.onNavigate).toHaveBeenCalledWith(source.id,'up'));
});
it.each([null, 'missing-node'])('does not substitute the live head when an explicitly displayed record is %s', displayNodeId => {
 const p = { ...props(), displayNodeId, loading: true, allowNavigationWhileLoading: true, pendingPreviousId: 'a' };
 render(React.createElement(ActionRecordPanel, p));
 expect(screen.getByRole<HTMLButtonElement>('button', { name: '上一行动记录' }).disabled).toBe(false);
 expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一行动记录' }).disabled).toBe(true);
 fireEvent.keyDown(screen.getByRole('region', { name: '行动记录' }), { key: 'ArrowDown' });
 expect(screen.queryByRole('group', { name: '选择后续分支' })).toBeNull();
 expect(p.onNavigate).not.toHaveBeenCalled();
});
it('replays the clicked speaker’s segment without selecting an action',()=>{
 const p=props();render(React.createElement(ActionRecordPanel,p));fireEvent.click(screen.getByRole('button',{name:'船夫'}));expect(p.onReplay).toHaveBeenCalledWith(segments[0]);expect(p.onAction).not.toHaveBeenCalled();
});
it('scrolls on segment changes and keeps the outgoing page inert during transitions',async()=>{
 const scrollTo=vi.fn();HTMLElement.prototype.scrollTo=scrollTo;
 const p=props();const v=render(React.createElement(ActionRecordPanel,p));scrollTo.mockClear();
 v.rerender(React.createElement(ActionRecordPanel,{...p,segmentIndex:1}));expect(scrollTo).toHaveBeenCalled();
 v.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:1,segments:[{type:'narration',text:'新的一页'}]}));
 expect(v.container.querySelector('.is-outgoing')?.hasAttribute('inert')).toBe(true);
 await waitFor(()=>expect(v.container.querySelector('.is-outgoing')).toBeNull());
});

it('preserves full review context and deduplicates walked branches out of collapsed recommendations',()=>{
 const a=useGameStore.getState().allNodes.a;const b=useGameStore.getState().allNodes.b;
 useGameStore.setState(s=>({allNodes:{...s.allNodes,c:{...b,id:'c'}},currentNode:a}));
 const p={...props(),showing:false,reviewing:true,actions:['选择 b','新行动'],onPlay:vi.fn()};
 render(React.createElement(ActionRecordPanel,p));
 expect(screen.getByText('你望向对岸。')).toBeTruthy();
 expect(screen.getAllByRole('button',{name:/选择 b/})).toHaveLength(1);
 expect(screen.queryByRole('button',{name:/新行动/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'推荐行动'}));
 expect(screen.getByRole('button',{name:/新行动/})).toBeTruthy();
 fireEvent.click(screen.getByText('你望向对岸。'));expect(p.onPlay).toHaveBeenCalledWith(1);
});

it('moves keyboard focus from a paragraph into branch selection before confirming with space', async()=>{
 const p={...props(),showing:false,reviewing:true,onPlay:vi.fn()};
 render(React.createElement(ActionRecordPanel,p));
 const paragraph=screen.getByRole('button',{name:'你望向对岸。'});
 paragraph.focus();fireEvent.keyDown(paragraph,{key:'ArrowDown'});
 expect(document.activeElement).toBe(screen.getByRole('region',{name:'行动记录'}));
 fireEvent.keyDown(document.activeElement!,{key:' '});
 await waitFor(()=>expect(p.onNavigate).toHaveBeenCalledWith('b','down'));
 expect(p.onPlay).not.toHaveBeenCalled();
});

it('hides recommendations while replaying an earlier segment of a completed record',()=>{
 const p={...props(),showing:false,reviewing:true};const view=render(React.createElement(ActionRecordPanel,p));
 expect(screen.getByLabelText('推荐行动')).toBeTruthy();
 view.rerender(React.createElement(ActionRecordPanel,{...p,showing:true,segmentIndex:0}));
 expect(screen.queryByLabelText('推荐行动')).toBeNull();expect(screen.getByText('你望向对岸。')).toBeTruthy();
 view.rerender(React.createElement(ActionRecordPanel,{...p,showing:true,segmentIndex:1}));
 expect(screen.getByLabelText('推荐行动')).toBeTruthy();
});

it('keeps the scroll position when playback ends and follows recommendations arriving later',()=>{
 useGameStore.setState({currentNode:useGameStore.getState().allNodes.b});
 const scrollTo=vi.fn();HTMLElement.prototype.scrollTo=scrollTo;
 const p={...props(),segmentIndex:1,actions:[] as string[]};
 const view=render(React.createElement(ActionRecordPanel,p));
 const viewport=view.container.querySelector('.eidos-record-scroll') as HTMLElement;
 Object.defineProperty(viewport,'scrollHeight',{configurable:true,value:900});
 viewport.scrollTop=320;scrollTo.mockClear();
 view.rerender(React.createElement(ActionRecordPanel,{...p,showing:false}));
 expect(scrollTo).not.toHaveBeenCalled();expect(viewport.scrollTop).toBe(320);
 view.rerender(React.createElement(ActionRecordPanel,{...p,showing:false,actions:['看看桥下']}));
 expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({top:900}));
});

it('keeps long narration and the player action intact in completed records',()=>{
 const text='完整行动经过。'.repeat(160)+'叙事末尾标记';
 const action='仔细观察。'.repeat(80)+'行动末尾标记';
 render(React.createElement(ActionRecordPanel,{...props(),showing:false,playerInput:action,segments:[{type:'narration',text}]}));
 expect(screen.getByText(text).textContent).toBe(text);
 expect(screen.getByLabelText('玩家行动').textContent).toContain(action);
});

it.each([{restored:[]}, {restored:segments}])('opens the submitted action immediately on its own waiting page, restored=$restored', ({restored}) => {
 const p={...props(),showing:false,segments:restored,fallback:'已有节点的完整内容',playerInput:'查看旧记录'};
 const view=render(React.createElement(ActionRecordPanel,p));
 const paper=view.container.querySelector('.eidos-story-paper')!;
 const pendingAction='尝试在输出两句话之后开始写文件';
 view.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:1,loading:true,segments:[],playerInput:pendingAction}));
 const waiting=view.container.querySelector('.eidos-record-page:not(.is-outgoing)')!;
 expect(waiting.contains(paper)).toBe(false);
 expect(waiting.textContent).toContain(pendingAction);
 expect(waiting.textContent).not.toContain('已有节点的完整内容');
 expect(waiting.querySelector('[aria-label="行动回复状态"]')?.textContent).toContain('正在召唤ALICE');
 view.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:1,loading:true,showing:true,playerInput:pendingAction,segments:[{type:'narration',text:'新行动的回应'}]}));
 const currentPage=view.container.querySelector('.eidos-record-page:not(.is-outgoing)')!;
 expect(currentPage).toBe(waiting);
 expect(currentPage.querySelector('[aria-label="玩家行动"]')?.textContent).toBe(`→ ${pendingAction}`);
 expect(currentPage.textContent).toContain('新行动的回应');
 expect(view.container.textContent?.split(pendingAction)).toHaveLength(2);
});

// Navigation landing takes precedence over restored segment focus and recommendations.
it.each([false, true])('lands previous records at the top and next records at the bottom, phone=%s', phone => {
 vi.stubGlobal('matchMedia', vi.fn((query:string) => ({ matches: phone && query.includes('max-width'), addEventListener:vi.fn(), removeEventListener:vi.fn() })));
 vi.spyOn(Element.prototype,'scrollHeight','get').mockReturnValue(1200);
 const scrollTo=vi.fn(function(this:HTMLElement, options?:ScrollToOptions | number) { if(typeof options !== 'number') this.scrollTop=options?.top ?? 0; });
 HTMLElement.prototype.scrollTo=scrollTo;
 const p={...props(),showing:false,reviewing:true,segmentIndex:1};
 const view=render(React.createElement(ActionRecordPanel,p));
 view.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:1,direction:'up' as const,landing:{pageKey:1,edge:'top' as const}}));
 const previous=view.container.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing) .eidos-record-scroll')!;
 expect(previous.scrollTop).toBe(0);
 expect(scrollTo).toHaveBeenLastCalledWith({top:0,behavior:'instant'});
 view.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:2,direction:'down' as const,landing:{pageKey:2,edge:'bottom' as const},showing:true,segmentIndex:0}));
 const next=view.container.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing) .eidos-record-scroll')!;
 expect(next.scrollTop).toBe(1200);
 expect(scrollTo).toHaveBeenLastCalledWith({top:1200,behavior:'instant'});
 // A later generated page must not reuse the older manual-navigation landing.
 view.rerender(React.createElement(ActionRecordPanel,{...p,pageKey:3,landing:{pageKey:2,edge:'bottom' as const},showing:true,segmentIndex:0}));
 expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({top:0}));
});
it('keeps same-text branches with different references separately selectable', () => {
 const current=useGameStore.getState(), b={...current.allNodes.b,playerInput:'核对资料',inputDocuments:[{documentId:'a',revision:'one',title:'A'}]},c={...current.allNodes.c,playerInput:'核对资料',inputDocuments:[{documentId:'b',revision:'one',title:'B'}]};
 useGameStore.setState({allNodes:{...current.allNodes,b,c}});
 render(React.createElement(ActionRecordPanel,{...props(),showing:false}));
 const choices=screen.getAllByRole('button').filter(button=>button.textContent?.includes('核对资料'));
 expect(choices).toHaveLength(2);expect(choices[0].textContent).toContain('引用 → A');expect(choices[1].textContent).toContain('引用 → B');
});

it('keeps a visible selected last paragraph in place instead of jumping to its recommendations', () => {
 const previousScroll=HTMLElement.prototype.scrollTo;
 const scrollTo=vi.fn(function(this:HTMLElement,options?:ScrollToOptions|number){if(typeof options!=='number')this.scrollTop=options?.top??0;});
 HTMLElement.prototype.scrollTo=scrollTo;
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  const viewport=this.closest('.eidos-record-scroll');
  if(this.matches('.eidos-record-scroll'))return new DOMRect(0,100,480,360);
  if(this.hasAttribute('data-record-segment'))return new DOMRect(0,100+Number(this.dataset.recordSegment)*240-(viewport?.scrollTop??0),480,100);
  return new DOMRect(0,900,480,100);
 });
 try {
  const p={...props(),reviewing:true,showing:false,focused:false};
  const view=render(React.createElement(ActionRecordPanel,p));
  const viewport=view.container.querySelector<HTMLElement>('.eidos-record-scroll')!;
  Object.defineProperty(viewport,'scrollHeight',{configurable:true,value:1500});
  viewport.scrollTop=160;scrollTo.mockClear();
  view.rerender(React.createElement(ActionRecordPanel,{...p,showing:true,focused:true,segmentIndex:1}));
  expect(view.container.querySelector('[data-current-record-segment]')?.getAttribute('data-record-segment')).toBe('1');
  expect(viewport.scrollTop).toBe(160);
  expect(scrollTo).not.toHaveBeenCalled();
 } finally {HTMLElement.prototype.scrollTo=previousScroll;}
});

it('keeps the active continuation status after prose and updates it until completion', () => {
 const p={...props(),loading:true,replyPhase:'files' as const};
 const view=render(React.createElement(ActionRecordPanel,p));
 const status=screen.getByRole('status',{name:'行动回复状态'});
 expect(status.textContent).toBe('ALICE正在赶作业');
 expect(view.container.querySelector('[data-record-segment]')!.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 view.rerender(React.createElement(ActionRecordPanel,{...p,replyPhase:'thinking'}));
 expect(screen.getByRole('status',{name:'行动回复状态'}).textContent).toBe('ALICE陷入了思考');
 view.rerender(React.createElement(ActionRecordPanel,{...p,loading:false}));
 expect(screen.queryByRole('status',{name:'行动回复状态'})).toBeNull();
});
