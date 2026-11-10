import { describe, expect, it } from 'vitest';
import { acceptModCommand } from '@/lib/game/plugins/mod-ui';
import { narrativeInput, parseNarrativeRequest, protectNarrativeResponse } from '@/lib/game/narrative';
import { extractNarrativeFrame } from '@/lib/ai/stream-parser';
import { validateActionInput } from '@/lib/api/request-input';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { AIGameResponse } from '@/lib/ai/types';

const frame = { kind: 'cutaway' as const, actor: '白槿', location: '车厢', timeLabel: '与此同时' };
const request = { kind: 'choice' as const, frame, choice: '藏起信件' };
const response: AIGameResponse = {
  narrativeFrame: frame, validity: { isPossible: true, fantasyResponse: null, reason: null },
  segments: [{ type: 'narration', text: '白槿藏起了信。' }], summary: '白槿藏信',
  sceneChanges: ['carriage'], discoveredSecrets: ['信的作者'], npcsReacted: ['白槿'], availableActions: ['打开信'],
  worldImpacts: ['信被藏在车厢'], timeSpent: { day: 1, hour: 2, minute: 5 },
  itemsGained: [{ id: 'letter' } as AIGameResponse['itemsGained'][number]], itemsUsed: ['letter'], cluesDiscovered: ['sender'],
  criticalFactsDiscovered: ['寄件人'], encyclopediaUpdates: [{ name: '作者', type: 'npc', description: '身份', knowledge: '已知' }],
  questsDiscovered: [{ title: '寻找信', description: '找信' }], relationshipUpdates: [{ npcName: '白槿', affinityDelta: 50 }],
  pluginEvents: [{ pluginId: 'novel', ruleId: 'letter-hidden' }],
};
describe('reader camera and character knowledge boundary', () => {
  it('retains chapter continuity as reader metadata while keeping cutaway facts out of protagonist knowledge', () => {
    const { snapshot } = buildRiftCityStartState();
    const narrativeBeat = { chapter: { id: 'night', title: '夜车' }, recap: '白槿把信藏进座椅。', threads: ['谁会来取信？'], boundary: 'chapter' as const };
    const safe = protectNarrativeResponse({ ...response, narrativeBeat }, snapshot.currentGameTime, request);
    expect(safe.narrativeBeat).toEqual(narrativeBeat);
    expect(safe.segments.at(-1)?.beat).toEqual(narrativeBeat);
    expect(safe.cluesDiscovered).toEqual([]); expect(safe.criticalFactsDiscovered).toEqual([]);
  });
  it('discards malformed optional chapter metadata while preserving readable prose', () => {
    const { snapshot } = buildRiftCityStartState();
    const safe = protectNarrativeResponse({ ...response, narrativeBeat: { boundary: 'hack', recap: ['wrong'] } } as unknown as AIGameResponse, snapshot.currentGameTime);
    expect(safe.narrativeBeat).toBeUndefined(); expect(safe.segments[0].text).toBe(response.segments[0].text);
  });
  it('clears protagonist mutations while retaining canonical prose and declared plugin outcomes', () => {
    const { snapshot } = buildRiftCityStartState();
    const safe = protectNarrativeResponse(response, snapshot.currentGameTime, request);
    expect(safe).toMatchObject({ narrativeFrame: frame, segments: [{ view: frame }], summary: '[旁观剧情，主角未知] 白槿藏信',
      timeAfter: snapshot.currentGameTime, timeSpent: { day: 0, hour: 0, minute: 0 }, sceneChanges: [], discoveredSecrets: [],
      npcsReacted: [], availableActions: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [], criticalFactsDiscovered: [],
      encyclopediaUpdates: [], questsDiscovered: [], relationshipUpdates: [], worldImpacts: response.worldImpacts, pluginEvents: response.pluginEvents });
    expect(protectNarrativeResponse(safe, snapshot.currentGameTime).summary).toBe(safe.summary);
    expect(response.itemsGained).toHaveLength(1);
  });
  it('fixes an actor choice to its requested character even when the model returns a protagonist camera', () => {
    const { snapshot } = buildRiftCityStartState();
    expect(protectNarrativeResponse({ ...response, narrativeFrame: { kind: 'protagonist' } }, snapshot.currentGameTime, request).itemsGained).toEqual([]);
    expect(narrativeInput(request)).toContain('白槿（车厢 / 与此同时）选择');
  });
  it('leaves legacy responses unchanged and allows protagonist outcomes after returning', () => {
    const { snapshot } = buildRiftCityStartState();
    const ordinary = { ...response, narrativeFrame: undefined };
    expect(protectNarrativeResponse(ordinary, snapshot.currentGameTime)).toBe(ordinary);
    expect(protectNarrativeResponse(response, snapshot.currentGameTime, { kind: 'return' }).itemsGained).toEqual(response.itemsGained);
  });
  it('requires an actor for a cutaway decision, without requiring one for an observation', () => {
    expect(parseNarrativeRequest({ kind: 'continue', frame: { kind: 'cutaway' } })).toBeTruthy();
    expect(() => parseNarrativeRequest({ kind: 'choice', choice: '藏信', frame: { kind: 'cutaway' } })).toThrow();
    expect(() => parseNarrativeRequest({ kind: 'choice', choice: 'x'.repeat(161) })).toThrow();
  });
  it('routes SDK narration through the existing branch/busy boundary', () => {
    const session = { token: 't', scope: 's', busy: false };
    const message = { channel: 'eidos-mod', command: 'narrate', token: 't', scope: 's', request, state: { page: 2 } };
    expect(acceptModCommand(message, session)).toMatchObject({ command: 'submit', narrativeRequest: request, state: { page: 2 } });
    expect(acceptModCommand(message, { ...session, busy: true })).toBeNull();
    expect(acceptModCommand(message, { ...session, scope: 'other' })).toBeNull();
  });
  it('rejects malformed API narration before generation', () => {
    const { snapshot } = buildRiftCityStartState();
    expect(() => validateActionInput({ playerInput: '继续故事', snapshot, narrativeRequest: { kind: 'hack' } })).toThrow('叙事请求无效');
  });
  it('reads a complete streaming camera containing punctuation and waits for unfinished metadata', () => {
    expect(extractNarrativeFrame(JSON.stringify({ narrativeFrame: { ...frame, location: '旧站台 {北侧}' }, segments: [] }))).toEqual({ ...frame, location: '旧站台 {北侧}' });
    expect(extractNarrativeFrame('{"narrativeFrame":{"kind":"cutaway","actor":"白')).toBeUndefined();
    expect(extractNarrativeFrame('{"narrativeFrame":{"kind":"bad"}}')).toBeUndefined();
  });
});
