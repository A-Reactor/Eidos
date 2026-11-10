import { describe, expect, it } from 'vitest';
import { alteredText, parseTextEffects } from '@/lib/game/text-effects';
import { compilePresentation, advancePresentation, presentationCues, recordPresentationText, projectRanges, presentationRevision, arrivalPresentation, reindexPresentations, presentedSpeech, presentationLighting } from '@/lib/game/presentation';
import { readHistory } from '@/lib/game/history-reader';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { WorldLineNode } from '@/lib/game/types';

const node = (id = 'a', parentId: string | null = null): WorldLineNode => ({ id, parentId, stepNumber: 1, playerInput: '听她说', aiResponse: '明天见。', playerVisibleText: '明天见。', summary: '', childIds: [], snapshotHash: '', segmentHash: '', createdAt: 0, gameTime: { day: 1, hour: 0, minute: 0 }, dayNumber: 1, sceneId: '', sceneName: '', timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], generationComplete: true });
const segment = (afterSegments = 0) => ({ type: 'narration' as const, text: '明天见。', textEffects: [{ kind: 'mask' as const, quote: '明天', afterSegments }] });

describe('persistent native presentation', () => {
  it('fades to a persistent brightness using the shared clock and isolates it to the declaring branch', () => {
    const root=node('root');root.presentation=compilePresentation(root,[{type:'narration',text:root.aiResponse}],{});
    const a=node('a','root');a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse,textEffects:[{kind:'dim',brightness:0.25,transitionMs:1000}]}],{root});
    let nodes=advancePresentation({root,a},'a',0,4,true,0);
    expect(presentationLighting(presentationCues(nodes,'a')).brightness).toBe(1);
    nodes=advancePresentation(nodes,'a',0,4,true,500);
    expect(presentationLighting(presentationCues(nodes,'a')).brightness).toBeCloseTo(0.625);
    nodes=advancePresentation(nodes,'a',0,4,true,5000);
    expect(presentationLighting(presentationCues(nodes,'a')).brightness).toBe(0.25);
    const sibling=node('sibling','root');sibling.presentation=compilePresentation(sibling,[{type:'narration',text:sibling.aiResponse}],nodes);
    expect(presentationLighting(presentationCues({...nodes,sibling},'sibling')).brightness).toBe(1);
    expect(presentationLighting(presentationCues(JSON.parse(JSON.stringify(nodes)),'a')).brightness).toBe(0.25);
  });

  it('returns an edit target for the current accepted record without confusing it with the preceding record',()=>{
    const a=node();a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse}],{});
    const b={...node('b','a'),stepNumber:2};b.presentation=compilePresentation(b,[{type:'narration',text:b.aiResponse}],{a});
    const source={allNodes:{a,b},currentNode:b};
    expect(readHistory(source,{target:'当前节点',view:'both'}).segments?.[0].editTarget).toMatchObject({nodeId:'b',segment:0});
    expect(readHistory(source,{target:'上一节点',view:'both'}).segments?.[0].editTarget).toMatchObject({nodeId:'a',segment:0});
  });
  it('never exposes an entire replacement when only its original opening has been read', () => {
    const a = node(); a.playerVisibleText = '明';
    a.presentation = compilePresentation(a,[{ type:'narration',text:a.aiResponse,textEffects:[{kind:'replace',value:'未来结局已发生',afterSegments:-1}] }],{});
    expect(recordPresentationText(a,{a},'a')).toBe('未');
    expect(readHistory({allNodes:{a},currentNode:a},{nodeId:'a',view:'both'}).displayText).toBe('未');
  });
  it('composes an intersecting mask with the replacement rather than leaking its hidden letters', () => {
    const runs=projectRanges('原来的话',[{start:0,end:4,effect:{kind:'replace',value:'未来结局已发生'}},{start:2,end:4,effect:{kind:'mask'}}]);
    expect(runs.map(r=>r.text).join('')).toMatch(/^未来[░▒�⌁▓]+$/u);
    expect(runs.map(r=>r.text).join('')).not.toContain('结局');
  });
  it('replaces hidden text in the actual copyable string while keeping original input intact', () => {
    const source = '秘密\n名字';
    const hidden = alteredText(source, [{ kind: 'mask' }]);
    expect(hidden).not.toContain('秘密'); expect(hidden).not.toContain('名字'); expect(hidden).toContain('\n');
    expect(source).toBe('秘密\n名字');
    expect(parseTextEffects([{ kind: 'mask', afterSegments: -1 }, { kind: 'strike', progress: 'typing', afterSegments: 1 }])).toHaveLength(2);
  });
  it('fires at the next unique segment, retains results across serialization and does not count replay', () => {
    const a = node(); a.presentation = compilePresentation(a, [segment(1), { type: 'narration', text: '风停了。' }], {});
    let nodes = { a };
    nodes = advancePresentation(nodes, 'a', 0, 4, true, 0);
    expect(presentationCues(nodes, 'a').filter(c => c.active)).toHaveLength(0);
    nodes = advancePresentation(nodes, 'a', 0, 4, true, 100);
    expect(presentationCues(nodes, 'a').filter(c => c.active)).toHaveLength(0);
    nodes = advancePresentation(nodes, 'a', 1, 1, false, 100);
    expect(presentationCues(nodes, 'a').filter(c => c.active)).toHaveLength(1);
    const restored = JSON.parse(JSON.stringify(nodes));
    expect(recordPresentationText(restored.a, restored, 'a')).not.toContain('明天');
    expect(restored.a.aiResponse).toBe('明天见。');
  });
  it('allows a descendant to change an already read ancestor only in that branch', () => {
    const a = node(); a.presentation = compilePresentation(a, [{ type: 'narration', text: a.aiResponse }], {});
    const b = node('b', 'a'); b.aiResponse = '她摇头。';
    b.presentation = compilePresentation(b, [{ type: 'narration', text: b.aiResponse, textEffects: [{ kind: 'replace', value: '永远见。', nodeId: 'a', segment: 0, expectedText: '明天见。', afterSegments: -1 }] }], { a });
    const sibling = node('sibling', 'a');
    const nodes = advancePresentation({ a, b, sibling }, 'b', 0, 4, true, 0);
    expect(recordPresentationText(a, nodes, 'b')).toBe('永远见。');
    expect(recordPresentationText(a, nodes, 'sibling')).toBe('明天见。');
    expect(recordPresentationText(a, nodes, 'a')).toBe('明天见。');
  });
  it('rejects stale or unread targets as a batch and does not alter world facts', () => {
    const a = node(); a.playerVisibleText = '';
    const b = node('b', 'a');
    b.presentation = compilePresentation(b, [{ type: 'narration', text: b.aiResponse, textEffects: [{ kind: 'mask', nodeId: 'a', segment: 0 }] }], { a });
    expect(b.presentation.errors.length).toBe(1); expect(b.presentation.cues).toHaveLength(0);
    expect(buildRiftCityStartState().world.gameplayPlugins).toBeUndefined();
  });
  it('defaults new declarations to paragraph completion and carries a deferred cue across nodes',()=>{
    const a=node(); a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse,textEffects:[{kind:'mask',quote:'明天'}]}],{});
    let nodes:Record<string,WorldLineNode>=advancePresentation({a},'a',0,2,false,500);
    expect(recordPresentationText(nodes.a,nodes,'a')).toBe('明天见。');
    nodes=advancePresentation(nodes,'a',0,4,true,0);
    expect(recordPresentationText(nodes.a,nodes,'a')).not.toContain('明天');
    const first=node('first'); first.presentation=compilePresentation(first,[segment(1)],{});
    nodes=advancePresentation({first},'first',0,4,true,0);
    const next=node('next','first');next.presentation=compilePresentation(next,[{type:'narration',text:next.aiResponse}],nodes);
    nodes=advancePresentation({...nodes,next},'next',0,1,false,0);
    expect(recordPresentationText(first,nodes,'next')).not.toContain('明天');
  });
  it('offers original/display/revision evidence and rejects stale history edits atomically',()=>{
    const a=node();a.presentation=compilePresentation(a,[segment(-1)],{});
    const source={allNodes:{a},currentNode:a};
    const result=readHistory(source,{nodeId:'a',view:'both'});
    expect(result.text).toBe('明天见。');expect(result.displayText).not.toContain('明天');
    expect(result.segments?.[0].text).toBe('明天见。');
    expect(result.presentationRevision).toBe(presentationRevision(a,{a},'a'));
    const b=node('b','a');
    b.presentation=compilePresentation(b,[{type:'narration',text:b.aiResponse,textEffects:[{kind:'color',quote:'明天',value:'blood',nodeId:'a',segment:0,expectedRevision:'outdated'}]}],{a});
    expect(b.presentation.cues).toHaveLength(0);expect(b.presentation.errors.join()).toContain('版本');
  });
  it('preserves settled lettering at a rewind arrival without duplicating its source cues or counting a new beat',()=>{
    const a=node();a.presentation=compilePresentation(a,[segment(-1)],{});
    const arrival={...a,id:'arrival',parentId:a.id,presentation:arrivalPresentation(a.presentation,a.id,'arrival')};
    const nodes={a,arrival};
    expect(recordPresentationText(a,nodes,'arrival')).toBe(recordPresentationText(a,{a},'a'));
    expect(recordPresentationText(arrival,nodes,'arrival')).not.toContain('明天');
    expect(new Set(presentationCues(nodes,'arrival').map(c=>c.id)).size).toBe(2);
    const pending=node('pending');pending.presentation=compilePresentation(pending,[segment(1)],{});
    const rewind={...pending,id:'rewind',parentId:pending.id,presentation:arrivalPresentation(pending.presentation,pending.id,'rewind')};
    const read=advancePresentation({pending,rewind},'rewind',0,4,true,0);
    expect(presentationCues(read,'rewind').some(c=>c.active)).toBe(false);
  });
  it('reindexes effects and read boundaries when imported document IDs change length',()=>{
    const a=node();a.aiResponse='[信](document://x/material_1234567890abcdef)秘密';a.playerVisibleText=a.aiResponse;
    a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse,textEffects:[{kind:'mask',quote:'秘密',afterSegments:-1}]}],{});
    const remapped={...a,aiResponse:a.aiResponse.replace('document://x/','document://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/'),playerVisibleText:a.aiResponse.replace('document://x/','document://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/')};
    const nodes=reindexPresentations({a:remapped},{a:[{type:'narration',text:remapped.aiResponse}]},{a});
    const shown=recordPresentationText(nodes.a,nodes,'a');
    expect(shown).toContain('document://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/');expect(shown).not.toContain('秘密');
    expect(nodes.a.presentation!.cues[0].id).toBe(a.presentation.cues[0].id);
  });
  it('paginates expanded display text independently and bounds the segment comparison payload',()=>{
    const a=node();a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse,textEffects:[{kind:'replace',value:'长'.repeat(15000),afterSegments:-1}]}],{});
    const source={allNodes:{a},currentNode:a};
    expect(readHistory(source,{nodeId:'a',view:'display'})).toMatchObject({totalChars:15000,nextOffset:12000});
    expect(readHistory(source,{nodeId:'a',view:'display',offset:12000})).toMatchObject({text:'长'.repeat(3000),nextOffset:null});
    const both=readHistory(source,{nodeId:'a',view:'both'});
    expect(both.segments?.[0].display.length).toBe(12000);expect(both.segments?.[0].partial).toBe(true);
  });
  it('uses current text for replayed speech and never speaks a persistently masked phrase',()=>{
    const a=node();a.aiResponse='「澄：秘密姓名」';a.playerVisibleText=a.aiResponse;
    const spoken={type:'dialogue' as const,speaker:'澄',text:'秘密姓名',textEffects:[{kind:'mask' as const,quote:'秘密',afterSegments:-1}]};
    a.presentation=compilePresentation(a,[spoken],{});
    expect(presentedSpeech(spoken,{a},'a','a',0).text).toBe('姓名');
    const changed={...spoken,textEffects:[{kind:'replace' as const,value:'别再来',afterSegments:-1}]};
    a.presentation=compilePresentation(a,[changed],{});
    expect(presentedSpeech(changed,{a},'a','a',0).text).toBe('别再来');
  });
  it('composes deferred edits by execution order rather than by the age of the declaring node',()=>{
    const a=node();a.presentation=compilePresentation(a,[{type:'narration',text:a.aiResponse}],{});
    const b=node('b','a');b.presentation=compilePresentation(b,[{type:'narration',text:b.aiResponse,textEffects:[{kind:'replace',value:'延后的改写',nodeId:'a',segment:0,afterSegments:2}]}],{a});
    let nodes:Record<string,WorldLineNode>=advancePresentation({a,b},'b',0,4,true,0);
    const c=node('c','b');c.aiResponse='甲\n\n乙';c.playerVisibleText=c.aiResponse;
    c.presentation=compilePresentation(c,[{type:'narration',text:'甲',textEffects:[{kind:'replace',value:'先发生的改写',nodeId:'a',segment:0,afterSegments:-1}]},{type:'narration',text:'乙'}],nodes);
    nodes=advancePresentation({...nodes,c},'c',0,1,true,0);
    expect(recordPresentationText(a,nodes,'c')).toBe('先发生的改写');
    nodes=advancePresentation(nodes,'c',1,1,true,0);
    expect(recordPresentationText(a,nodes,'c')).toBe('延后的改写');
  });
});
