import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { callAi, subscribeKeiCorrection } from '@/lib/ai/client';
import { cancelKeiQueue, hasPendingKeiReviews, subscribeKeiActivity, keiQualityQueue, submitKeiReview, type KeiReviewOptions } from '@/lib/ai/kei-review';
import type { AIGameResponse, KeiReviewResult } from '@/lib/ai/types';
import { makeResponse, usage } from './kei-fixtures';

vi.mock('@/lib/ai/client', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ai/client')>(), callAi: vi.fn() }));
const { world, snapshot } = buildRiftCityStartState();
const settings = { aliceApiKey: 'alice-test', keiApiKey: 'kei-test' };
let received: KeiReviewResult[];
let unsubscribe: () => void;
function commit(index: number, response: AIGameResponse = makeResponse(), overrides: KeiReviewOptions = {}) {
  submitKeiReview(response, world, snapshot, '守卫只看见货车，没有见到驾驶者。', undefined, null, '', {
    origin: { worldId: world.id, playthroughId: 'run', worldLineId: 'line', archiveScope: 'ordinary', parentNodeId: 'parent', actionId: `action_${index}` },
    settingsOverride: settings,
    narrativeContext: { playerInput: '驾驶者是谁？', responseText: response.segments.map(s => s.text).join('\n'), recentHistory: [{ playerInput: '问车辆的细节', aiResponse: '守卫回答车是蓝色，除此之外没有看清。', summary: '蓝色货车', sceneId: snapshot.currentSceneId }] },
    ...overrides,
  });
}
beforeEach(() => {
  cancelKeiQueue(); keiQualityQueue.actionCount = 0;
  vi.mocked(callAi).mockReset().mockResolvedValue({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 });
  received = []; unsubscribe = subscribeKeiCorrection(result => received.push(result));
});
afterEach(() => { unsubscribe(); cancelKeiQueue(); vi.useRealTimers(); });
describe('committed action quality review', () => {
  it('includes identical validation context in consecutive independent reviews', async () => {
    const response = makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '重要证据' } });
    commit(1, response);
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    commit(2, response);
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(callAi).toHaveBeenCalledTimes(2);
    for (const request of vi.mocked(callAi).mock.calls) expect(request[0].systemPrompt).toContain('守卫只看见货车，没有见到驾驶者。');
  });
  it('reviews the fifth action with no encyclopedia or fact updates', async () => {
    for (let i = 1; i <= 4; i++) commit(i);
    expect(callAi).not.toHaveBeenCalled();
    commit(5);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]._reviewOrigin?.actionId).toBe('action_5');
    expect(vi.mocked(callAi).mock.calls[0][0].callType).toBe('quality');
  });
  it('counts mixed actions once without reviewing routine additions', async () => {
    commit(1, makeResponse({ criticalFactsDiscovered: ['车辆是蓝色。'] }));
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    commit(1); commit(2); commit(3); commit(4); commit(5);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(vi.mocked(callAi).mock.calls.map(c => c[0].callType)).toEqual(['quality']);
    expect(keiQualityQueue.actionCount).toBe(5);
  });
  it('does not treat ordinary world impacts as a request', async () => {
    commit(1, makeResponse({ worldImpacts: ['守卫递过名册'] }));
    expect(callAi).not.toHaveBeenCalled();
  });
  it('sends actual current and recent prose with snapshot context as review material', async () => {
    for (let i = 1; i <= 5; i++) commit(i);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const request = vi.mocked(callAi).mock.calls[0];
    const material = JSON.parse(request[0].userMessage.slice(request[0].userMessage.indexOf('{')));
    expect(material.current.playerInput).toBe('驾驶者是谁？');
    expect(material.current.responseText).toBe('守卫确认自己没有看见驾驶者。');
    expect(material.recentHistory[0].aiResponse).toBe('守卫回答车是蓝色，除此之外没有看清。');
    expect(material.sceneId).toBe(snapshot.currentSceneId);
    expect(material.gameTime).toEqual({ day: 0, hour: 8, minute: 0 });
    expect(request[0].settingsOverride).toMatchObject(settings);
  });
  it('guides continuation from the observed knowledge boundary without default escalation', async () => {
    for (let i = 1; i <= 5; i++) commit(i);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const { systemPrompt: prompt, userMessage: input } = vi.mocked(callAi).mock.calls[0][0];
    expect(input).toContain('守卫确认自己没有看见驾驶者。');
    expect(input).toContain('除此之外没有看清');
    expect(prompt).not.toContain('不确定时使用 delay 或 complicate');
    expect(prompt).not.toContain('玩家连续追问但证据不足时，优先 delay');
    expect(prompt).not.toContain('玩家连续低风险行动时，可以 raise');
    expect(prompt).not.toContain('若连续多轮高强度或低强度，使用 pacing_monotony');
    expect(prompt).toContain('确认不知道、方法无效、完成工作和关系变化都可以是局部结果');
    expect(prompt).toContain('根据正文中已经给出的答复、结果和可行机会');
    expect(prompt).toContain('是否无铺垫揭示重大秘密');
    expect(prompt).toContain('successCriteria');
  });
  it('preserves the beginning and ending when limiting long prose', async () => {
    for (let i = 1; i <= 4; i++) commit(i);
    const text = '开头证据' + '中'.repeat(9000) + '结尾答案';
    commit(5, makeResponse(), { narrativeContext: { playerInput: '追问', responseText: text,
      recentHistory: Array.from({ length: 8 }, () => ({ playerInput: '问', aiResponse: text, summary: '', sceneId: 'corridor' })) } });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const request = vi.mocked(callAi).mock.calls[0];
    const material = JSON.parse(request[0].userMessage.slice(request[0].userMessage.indexOf('{')));
    expect(material.current.responseText.length).toBeLessThanOrEqual(6000);
    expect(material.current.responseText).toMatch(/^开头证据[\s\S]*结尾答案$/);
    expect(material.recentHistory).toHaveLength(5);
    expect(material.recentHistory[0].aiResponse.length).toBeLessThanOrEqual(2000);
    expect(material.recentHistory[0].aiResponse).toMatch(/^开头证据[\s\S]*结尾答案$/);
  });
  it('coalesces queued background reviews while retaining the active review', async () => {
    let finish!: (value: Awaited<ReturnType<typeof callAi>>) => void;
    vi.mocked(callAi).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    for (let i = 1; i <= 15; i++) commit(i);
    expect(keiQualityQueue.size).toBe(1);
    cancelKeiQueue();
    finish({ content: '{"approved":true,"corrections":""}', usage, elapsedMs: 1 });
    await Promise.resolve();
    expect(received).toEqual([]);
  });
  it('resets the interval and deduplication for a new session', async () => {
    for (let i = 1; i <= 4; i++) commit(i);
    cancelKeiQueue();
    for (let i = 1; i <= 4; i++) commit(i);
    expect(callAi).not.toHaveBeenCalled();
    commit(5);
    await vi.waitFor(() => expect(received).toHaveLength(1));
  });
  it('skips model requests when credentials are missing', async () => {
    commit(1, makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '守卫出示重要证据' } }), { settingsOverride: { aliceApiKey: '', keiApiKey: '' } });
    await Promise.resolve();
    expect(callAi).not.toHaveBeenCalled();
    expect(hasPendingKeiReviews()).toBe(false);
  });
  it('ends a failed review without publishing corrections', async () => {
    vi.mocked(callAi).mockRejectedValue(new Error('provider failed'));
    commit(1, makeResponse({ reviewRequest: { reason: 'narrative_stall', evidence: '重复追问没有新信息' } }));
    await vi.waitFor(() => expect(hasPendingKeiReviews()).toBe(false));
    expect(callAi).toHaveBeenCalledOnce();
    expect(received).toEqual([]);
  });
  it('releases the pipeline at the quality deadline even if a provider ignores abort', async () => {
    vi.useFakeTimers(); vi.mocked(callAi).mockImplementation(() => new Promise(() => {}));
    commit(1, makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '守卫出示重要证据' } }));
    expect(hasPendingKeiReviews()).toBe(true);
    await vi.advanceTimersByTimeAsync(25000);
    expect(hasPendingKeiReviews()).toBe(false);
    expect(vi.mocked(callAi).mock.calls[0][0].signal?.aborted).toBe(true);
    expect(received).toEqual([]);
  });
});

it('notifies activity subscribers when a background review starts and finishes', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof callAi>>) => void;
  vi.mocked(callAi).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const states: boolean[] = [];
  const stop = subscribeKeiActivity(() => states.push(hasPendingKeiReviews()));
  try {
    commit(1, makeResponse({ reviewRequest: { reason: 'major_turn', evidence: '重要证据' } }), { mode: 'background' });
    expect(hasPendingKeiReviews()).toBe(true);
    expect(states).toContain(true);
    await vi.waitFor(() => expect(callAi).toHaveBeenCalledOnce());
    resolve({ content: '{"approved":true}', usage, elapsedMs: 1 });
    await vi.waitFor(() => expect(states.at(-1)).toBe(false));
  } finally { stop(); }
});
