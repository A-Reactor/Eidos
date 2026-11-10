import { expect,it } from 'vitest';
import { compilePresentation,advancePresentation,recordPresentationText,presentationCues,presentedSpeech,arrivalPresentation,presentationLighting,stagePresentationDraft,adoptPresentationDraft } from '@/lib/game/presentation';
import { readHistory } from '@/lib/game/history-reader';
import { parseTextEffects } from '@/lib/game/text-effects';
import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '@/lib/game/types';

function record(id:string,parentId:string | null,segments:StorySegment[],nodes:Record<string,WorldLineNode>={}) {
  const text=segments.map(s=>s.text).join('\n\n');
  const node={id,parentId,stepNumber:Object.keys(nodes).length+1,playerInput:'继续',aiResponse:text,playerVisibleText:text,summary:'',childIds:[],snapshotHash:'',segmentHash:'',createdAt:0,gameTime:{day:1,hour:0,minute:0},dayNumber:1,sceneId:'room',sceneName:'房间',timeSpent:{day:0,hour:0,minute:0},worldImpacts:[],generationComplete:true} as WorldLineNode;
  node.presentation=compilePresentation(node,segments,nodes);return node;
}
const prose=(text:string,textEffects?:StorySegment['textEffects']):StorySegment[]=>[{type:'narration',text,textEffects}];
const play=(nodes:Record<string,WorldLineNode>,id:string,index=0)=>advancePresentation(nodes,id,index,1000,true,0);
function masked() {
  const a=record('a',null,prose('明天见。',[{kind:'mask',quote:'明天',afterSegments:-1},{kind:'color',quote:'明天',value:'blood',afterSegments:-1},{kind:'replace',quote:'见',value:'来',afterSegments:-1}]));
  return play({a},'a');
}

it('does not discard a valid historical restoration because an unrelated local color quote is missing',()=>{
 const a=record('a',null,prose('旧名字',[{kind:'mask',quote:'旧名字',afterSegments:-1}]));
 const lines:StorySegment[]=[{type:'narration',text:'不可移除'},{type:'narration',text:'恢复先前字迹',textEffects:[{kind:'restore',effectId:'a:0:0',afterSegments:-1},{kind:'color',quote:'不可移除',value:'muted'}]}];
 const b=record('b','a',lines,{a}),next=play({a,b},'b',1);
 expect(b.presentation?.errors).toEqual(['第2段：找不到目标短语']);expect(recordPresentationText(a,next,'b')).toBe('旧名字');
 expect(presentationCues(next,'b').find(c=>c.id==='a:0:0')?.cancelled).toBe(true);
});

it('returns a single versioned edit reference that can modify a past paragraph',()=>{
  const a=record('a',null,prose('明天见。')),nodes={a};
  const result=readHistory({allNodes:nodes,currentNode:a},{target:'当前节点',view:'both'});
  const editRef=result.segments?.[0].editRef;expect(editRef).toEqual(expect.any(String));
  const b=record('b','a',prose('她点头。',[{kind:'replace',editRef,quote:'明天',value:'昨天',afterSegments:-1}]),nodes);
  const next=play({...nodes,b},'b');
  expect(b.presentation?.errors).toEqual([]);expect(recordPresentationText(a,next,'b')).toBe('昨天见。');
});

it('rejects a stale or invalid reference without silently substituting a new version',()=>{
  const a=record('a',null,prose('明天见。'));
  const editRef=readHistory({allNodes:{a},currentNode:a},{nodeId:'a',view:'both'}).segments?.[0].editRef;
  expect(editRef).toEqual(expect.any(String));
  const b=record('b','a',prose('她点头。',[{kind:'color',nodeId:'a',segment:0,value:'blood',afterSegments:-1}]),{a});
  const nodes=play({a,b},'b');
  const c=record('c','b',prose('她改口。',[{kind:'replace',editRef,value:'昨天见。'}]),nodes);
  expect(c.presentation?.errors.join()).toContain('版本');expect(c.presentation?.cues).toHaveLength(0);
  const invalid=record('invalid','b',prose('她停住。',[{kind:'mask',editRef:'not-a-host-reference'}]),nodes);
  expect(invalid.presentation?.errors.join()).toContain('引用');
});

it('restores a named mask while retaining the other replacement and color in that branch',()=>{
  const nodes=masked(),b=record('b','a',prose('她开灯。',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]),nodes);
  const next=play({...nodes,b},'b');
  expect(b.presentation?.errors).toEqual([]);
  expect(recordPresentationText(next.a,next,'b')).toBe('明天来。');
  expect(recordPresentationText(next.a,next,'a')).not.toContain('明天');
  expect(presentationCues(next,'b').find(c=>c.id==='a:0:1')?.active).toBe(true);
  expect(presentationCues(next,'b').find(c=>c.id==='a:0:0')?.cancelled).toBe(true);
  expect(presentedSpeech(prose('明天见。')[0],next,'b','a',0).text).toBe('明天来。');
  expect(recordPresentationText(JSON.parse(JSON.stringify(next.a)),JSON.parse(JSON.stringify(next)),'b')).toBe('明天来。');
});

it('can undo a restoration without deleting either earlier event',()=>{
  const nodes=masked(),b=record('b','a',prose('她开灯。',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]),nodes);
  const restored=play({...nodes,b},'b');
  const c=record('c','b',prose('她关灯。',[{kind:'restore',effectId:'b:0:0',afterSegments:-1}]),restored);
  const next=play({...restored,c},'c');
  expect(recordPresentationText(next.a,next,'c')).not.toContain('明天');
  expect(recordPresentationText(next.a,next,'b')).toBe('明天来。');
  expect(next.a.presentation?.cues).toHaveLength(3);
});

it('cancels a pending event so subsequent new segments cannot trigger it',()=>{
  const a=record('a',null,prose('明天见。',[{kind:'mask',afterSegments:3}]));
  const nodes=play({a},'a'),b=record('b','a',prose('她制止了变化。',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]),nodes);
  let next=play({...nodes,b},'b');
  const c=record('c','b',[...prose('第一段'),...prose('第二段'),...prose('第三段')],next);next={...next,c};
  for(let i=0;i<3;i++) next=play(next,'c',i);
  expect(recordPresentationText(next.a,next,'c')).toBe('明天见。');
  expect(presentationCues(next,'c').find(c=>c.id==='a:0:0')).toMatchObject({active:false,cancelled:true});
});

it('rejects unknown and sibling-branch event IDs rather than accepting a fake success',()=>{
  const nodes=masked(),other=record('other','a',prose('旁支',[{kind:'mask',afterSegments:-1}]),nodes);
  for(const effectId of ['missing:0:0','other:0:0']) {
    const b=record('b','a',prose('恢复',[{kind:'restore',effectId}]),{...nodes,other});
    expect(b.presentation?.errors.length).toBeGreaterThan(0);expect(b.presentation?.cues).toHaveLength(0);
  }
  expect(parseTextEffects([{kind:'restore'},{kind:'restore',effectId:'a:0:0'}])).toEqual([{kind:'restore',effectId:'a:0:0'}]);
});

it('returns bounded before/after evidence and real cancellation status through the existing history tool',()=>{
  const nodes=masked(),b=record('b','a',prose('她开灯。',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]),nodes);
  const next=play({...nodes,b},'b');
  const result=readHistory({allNodes:next,currentNode:next.b},{nodeId:'a',view:'both'});
  expect(result.presentation?.find(c=>c.id==='a:0:0')?.state).toBe('cancelled');
  expect(result.presentation?.find(c=>c.id==='a:0:0')?.quote).toBe('明天');
  expect(result.presentation?.find(c=>c.id==='a:0:1')?.value).toBe('blood');
  const change=result.presentation?.find(c=>c.id==='b:0:0');
  expect(change?.beforeText).not.toContain('明天');expect(change?.afterText).toBe('明天来。');
  expect(change?.kind).toBe('restore');
  expect(result.text).toBe('明天见。');expect(result.displayText).toBe('明天来。');
});

it('pages long change histories and bounds each comparison without losing older effect IDs',()=>{
  const effects=Array.from({length:12},(_,i)=>({kind:'replace' as const,value:String(i).repeat(400),afterSegments:-1}));
  const a=record('a',null,prose('原文'.repeat(300),effects)),nodes=play({a},'a'),source={allNodes:nodes,currentNode:nodes.a};
  const first=readHistory(source,{nodeId:'a',view:'both'});
  expect(first.presentation).toHaveLength(8);expect(first.presentationTotal).toBe(12);expect(first.presentationNextOffset).toBe(8);
  for(const change of first.presentation ?? []) {expect(change.beforeText!.length).toBeLessThanOrEqual(200);expect(change.afterText!.length).toBeLessThanOrEqual(200);expect(change.partial).toBe(true);}
  const last=readHistory(source,{nodeId:'a',view:'both',presentationOffset:first.presentationNextOffset!});
  expect(last.presentation).toHaveLength(4);expect(last.presentation?.some(c=>c.id==='a:0:0')).toBe(true);expect(last.presentationNextOffset).toBeNull();
});

it('preserves local restoration identities when replaying a rewind arrival',()=>{
  const segments=[...prose('明天见。',[{kind:'mask',afterSegments:-1}]),...prose('恢复了。',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}])];
  const a=record('a',null,segments);let nodes=play({a},'a');nodes=play(nodes,'a',1);
  expect(recordPresentationText(nodes.a,nodes,'a')).toContain('明天见。');
  const arrival={...nodes.a,id:'arrival',parentId:'a',presentation:arrivalPresentation(nodes.a.presentation!,'a','arrival')};
  const next={...nodes,arrival};
  expect(recordPresentationText(arrival,next,'arrival')).toContain('明天见。');
  expect(arrival.presentation.cues.find(c=>c.effect.kind==='restore')?.effect.effectId).toBe('arrival:0:0');
});

it('accepts the reference returned for a completed legacy record without an explicit read-boundary field',()=>{
  const a=record('a',null,prose('旧信中的秘密'));delete a.playerVisibleText;
  const editRef=readHistory({allNodes:{a},currentNode:a},{nodeId:'a',view:'both'}).segments![0].editRef;
  expect(editRef).toEqual(expect.any(String));
  const b=record('b','a',prose('她合上信。',[{kind:'mask',editRef,quote:'秘密',afterSegments:-1}]),{a});
  expect(b.presentation?.errors).toEqual([]);
});

it('does not expose unread source or future choice parameters in history evidence',()=>{
  const a=record('a',null,[...prose('读到这里'),...prose('未读结局',[{kind:'replace',target:'choice',quote:'未来原选项',value:'未来改名选项',afterSegments:-1}])]);
  a.playerVisibleText='读到这里';
  const result=readHistory({allNodes:{a},currentNode:a},{nodeId:'a',view:'both'});
  expect(result.text).toBe('读到这里');expect(JSON.stringify(result.presentation)).not.toMatch(/未来原选项|未来改名选项/);
  const current=record('current',null,[...prose('读到这里',[{kind:'replace',target:'choice',quote:'另一原选项',value:'另一改名选项',afterSegments:-1}]),...prose('未读结局')]);
  current.playerVisibleText='读到这里';
  expect(readHistory({allNodes:{current},currentNode:current},{nodeId:'current',view:'both'}).presentation).toEqual([]);
});

it('places adopted draft commands after the existing branch sequence',()=>{
  const a=record('a',null,prose('灯暗了',[{kind:'color',value:'blood'},{kind:'size',value:'large'},{kind:'dim',brightness:0.2,transitionMs:0}]));
  const nodes=play({a},'a'),next=prose('灯亮了',[{kind:'dim',brightness:1,transitionMs:0}]);
  stagePresentationDraft({key:'adoption-order-test',segments:next,index:0,chars:3,complete:true,showing:true,elapsed:0,legacy:false});
  const b=record('b','a',next,nodes);b.presentation=adoptPresentationDraft('adoption-order-test',b,nodes);
  expect(presentationLighting(presentationCues(play({...nodes,b},'b'),'b')).brightness).toBe(1);
});

it('does not replay a cancelled animation after undoing its restoration in the same elapsed tick',()=>{
  const a=record('a',null,prose('秘密',[{kind:'color',value:'blood'},{kind:'fracture'}]));
  let nodes=play({a},'a');
  const b=record('b','a',prose('恢复',[{kind:'restore',effectId:'a:0:1'}]),nodes);
  nodes=advancePresentation({...nodes,b},'b',0,2,true,50);
  const c=record('c','b',prose('再撤销',[{kind:'restore',effectId:'b:0:0'}]),nodes);nodes=play({...nodes,c},'c');
  expect(presentationCues(nodes,'c').find(cue=>cue.id==='a:0:1')).toMatchObject({active:true,remainingMs:0});
});

it('settles a re-enabled pending event immediately when its segment condition is already satisfied',()=>{
  const a=record('a',null,prose('明天见。',[{kind:'mask',afterSegments:2}]));
  let nodes=play({a},'a');
  const b=record('b','a',prose('取消等待',[{kind:'restore',effectId:'a:0:0',afterSegments:-1}]),nodes);nodes=play({...nodes,b},'b');
  const c=record('c','b',prose('恢复等待',[{kind:'restore',effectId:'b:0:0'}]),nodes);nodes=play({...nodes,c},'c');
  expect(presentationCues(nodes,'c').find(cue=>cue.id==='a:0:0')).toMatchObject({active:true,cancelled:false});
  expect(recordPresentationText(nodes.a,nodes,'c')).not.toContain('明天');
});
