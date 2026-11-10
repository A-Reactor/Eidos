import { describe, expect, it, vi } from 'vitest';
import { SpeculativeEngine, speculationStateKey, speculationScope, missingSpeculationActions, type SpeculationInput } from '@/lib/ai/speculation';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { AIGameResponse } from '@/lib/ai/types';

const { world, snapshot } = buildRiftCityStartState();
const input: SpeculationInput = { scope: 'world:run:parent', world, snapshot, recentHistory: [], inventory: [], clues: [], encyclopedia: [], criticalFacts: [], questLog: [], weather: '晴', protagonistState: null, clientSettings: null };
const response = { validity: { isPossible: true }, segments: [{ type: 'narration', text: '抵达。' }], availableActions: ['继续'] } as AIGameResponse;

describe('node-scoped speculation', () => {
  it('observes the primary candidate without consuming it, and notifies selection and cancellation', async () => {
    const finishes: ((value: AIGameResponse) => void)[] = [];
    const engine = new SpeculativeEngine(2, 60000, () => new Promise(resolve => finishes.push(resolve)));
    const changed = vi.fn(), unsubscribe = engine.subscribe(changed);
    const work = engine.triggerSpeculation(['首选', '备选'], input);
    finishes[1](response);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(engine.peekPrimary(input.scope)).toBeNull();
    finishes[0](response); await work;
    expect(engine.peekPrimary(input.scope)?.response).toBe(response);
    expect(engine.peekPrimary('other')).toBeNull();
    expect(engine.size).toBe(2);
    const count = changed.mock.calls.length;
    expect(engine.checkCache('首选', input.scope)).toBe(response);
    expect(changed.mock.calls.length).toBeGreaterThan(count);
    expect(engine.peekPrimary(input.scope)).toBeNull();
    engine.cancel(); expect(engine.peekPrimary(input.scope)).toBeNull();
    unsubscribe(); changed.mockClear(); engine.cancel(); expect(changed).not.toHaveBeenCalled();
  });
  it('retains paid candidates while reading the same unchanged node for several minutes', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => response);
      const engine = new SpeculativeEngine(1, undefined, run);
      await engine.triggerSpeculation(['继续'], input);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(engine.checkCache('继续', input.scope, speculationStateKey(world, snapshot, null))).toBe(response);
      expect(run).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('continues the selected request beyond eight seconds instead of forcing a restart', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: AIGameResponse) => void;
      const engine = new SpeculativeEngine(1, undefined, () => new Promise(resolve => { finish = resolve; }));
      const warm = engine.triggerSpeculation(['继续'], input);
      const selected = engine.waitForPending('继续', input.scope);
      await vi.advanceTimersByTimeAsync(9000);
      expect(engine.hasSelectedWait).toBe(true);
      finish(response); await warm;
      expect(await selected).toBe(response);
    } finally { vi.useRealTimers(); }
  });
  it('invalidates predictions when same-node rules or card variables change, while presentation edits keep the key', async () => {
    const engine = new SpeculativeEngine(1, 60000, async () => response);
    await engine.triggerSpeculation(['继续'], input);
    const changed = speculationStateKey(world, { ...snapshot, worldFlags: { changed: true } }, null);
    expect(engine.checkCache('继续', input.scope, changed)).toBeNull();
    expect(speculationStateKey(world, { ...snapshot, gameplayModState: { panel: { x: 22, _eidosWorkspace: { files: { a: 1 } } } } }, null)).toBe(speculationStateKey(world, snapshot, null));
    expect(speculationStateKey(world, { ...snapshot, gameplayModState: { card: { _eidosCard: { revision: 1, variables: { trust: 65 } } } } }, null)).not.toBe(speculationStateKey(world, snapshot, null));
  });
  it('starts fresh work when semantics change inside an unchanged node scope', async () => {
    const run = vi.fn(async () => response), engine = new SpeculativeEngine(1, 60000, run);
    await engine.triggerSpeculation(['继续'], input);
    await engine.triggerSpeculation(['继续'], { ...input, snapshot: { ...snapshot, worldFlags: { changed: true } } });
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('invalidates a same-node history rewrite and separates sandbox dossiers', async () => {
    const run = vi.fn(async () => response), engine = new SpeculativeEngine(1, 60000, run);
    await engine.triggerSpeculation(['继续'], { ...input, recentHistory: [{ playerInput: '询问', summary: '旧证词' }] });
    await engine.triggerSpeculation(['继续'], { ...input, recentHistory: [{ playerInput: '询问', summary: '修订后的证词' }] });
    expect(run).toHaveBeenCalledTimes(2);
    expect(speculationScope('w', 'p', 'n', { sandboxMode: true, sandboxDossierId: '002' })).not.toBe(speculationScope('w', 'p', 'n'));
    expect(speculationScope('w', 'p', 'n', { sandboxMode: true, sandboxDossierId: '003' })).not.toBe(speculationScope('w', 'p', 'n', { sandboxMode: true, sandboxDossierId: '002' }));
  });
  it('adopts an in-flight selected action without restarting its request', async () => {
    let finish!: (value: AIGameResponse) => void;
    const run = vi.fn(() => new Promise<AIGameResponse>(resolve => { finish = resolve; }));
    const engine = new SpeculativeEngine(1, 60000, run);
    const warm = engine.triggerSpeculation(['去集市'], input);
    expect(engine.hasPendingAction('去集市！', input.scope)).toBe(true);
    const selected = engine.waitForPending('去集市！', input.scope);
    finish(response); await warm;
    expect(await selected).toBe(response); expect(run).toHaveBeenCalledOnce();
    expect(engine.checkCache('去集市', input.scope)).toBeNull();
  });
  it('releases a selected wait on cancellation even when the provider ignores abort', async () => {
    const engine = new SpeculativeEngine(1, 60000, () => new Promise(() => {}));
    void engine.triggerSpeculation(['去集市'], input);
    const selected = engine.waitForPending('去集市', input.scope);
    engine.cancel(); expect(await selected).toBeNull();
    expect(await engine.waitForPending('去集市', 'other:scope')).toBeNull();
  });
  it('bounds selected waiting and respects cancellation of the player request', async () => {
    vi.useFakeTimers();
    try {
      const engine = new SpeculativeEngine(1, 60000, () => new Promise(() => {}));
      void engine.triggerSpeculation(['去集市'], input);
      const selected = engine.waitForPending('去集市', input.scope, { timeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(8000); expect(await selected).toBeNull();
      const controller = new AbortController();
      const interrupted = engine.waitForPending('去集市', input.scope, { signal: controller.signal });
      controller.abort(); expect(await interrupted).toBeNull(); engine.cancel();
    } finally { vi.useRealTimers(); }
  });
  it('deduplicates pending work and fresh results for the same node', async () => {
    let finish!: (value: AIGameResponse) => void;
    const run = vi.fn(() => new Promise<AIGameResponse>(resolve => { finish = resolve; }));
    const engine = new SpeculativeEngine(1, 60000, run);
    const first = engine.triggerSpeculation(['去集市'], input);
    const second = engine.triggerSpeculation(['去集市'], input);
    expect(run).toHaveBeenCalledTimes(1);
    finish(response); await Promise.all([first, second]);
    await engine.triggerSpeculation(['去集市'], input);
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.checkCache('去集市！', input.scope)).toBe(response);
  });
  it('starts warming after entering a cached child and never accepts late parent results', async () => {
    const finishes: ((value: AIGameResponse) => void)[] = [];
    const engine = new SpeculativeEngine(1, 60000, () => new Promise(resolve => finishes.push(resolve)));
    const parent = engine.triggerSpeculation(['继续'], input);
    const childInput = { ...input, scope: 'world:run:child' };
    const child = engine.triggerSpeculation(['继续'], childInput);
    finishes[1](response); await child;
    finishes[0]({ ...response, summary: '旧节点' }); await parent;
    expect(engine.status).toBe('idle');
    expect(engine.checkCache('继续', input.scope)).toBeNull();
    expect(engine.checkCache('继续', childInput.scope)).toBe(response);
  });
  it('fills missing choices even when the first choice already has a child', () => {
    expect(missingSpeculationActions(['询问', '前往集市', '前往集市！', '继续'], [{ playerInput: '询问' }, { playerInput: '继续', generationComplete: false }], 3)).toEqual(['前往集市', '继续']);
  });
  it('does not treat a child with another entry context as an ordinary cached future',()=>{
    expect(missingSpeculationActions(['询问'],[{playerInput:'询问',entry:{id:'other-context'}}],1)).toEqual(['询问']);
  });
  it('discards cancelled results and impossible action predictions', async () => {
    const engine = new SpeculativeEngine(1, 60000, async () => ({ ...response, validity: { isPossible: false, fantasyResponse: '无法执行', reason: '' } }));
    await engine.triggerSpeculation(['瞬移'], input);
    expect(engine.size).toBe(0);
    engine.cancel(); expect(engine.checkCache('瞬移', input.scope)).toBeNull();
  });
});

it('invalidates candidates when player instructions or compression thresholds change', () => {
  const base = speculationStateKey(world, snapshot, null);
  expect(speculationStateKey(world, snapshot, { aliceUserPrompt: '对白要简练' })).not.toBe(base);
  const history = Array.from({ length: 20 }, (_, i) => ({ playerInput: String(i), summary: '摘要', aiResponse: '原文' }));
  expect(speculationStateKey(world, snapshot, null, history)).not.toBe(speculationStateKey(world, snapshot, null, history.map((h, i) => i === 0 ? { ...h, aiResponse: '改过的旧正文' } : h)));
  expect(speculationStateKey(world, snapshot, { contextCompressionLowerPercent: 50, contextCompressionUpperPercent: 80 } as unknown as Record<string, string>)).not.toBe(base);
});
