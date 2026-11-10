// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceManifest } from './source-package';

type ReadingSegment = string | { text?: string; content?: string; displayedText?: string };
type TestContext = {
  plugin: { id: string; name: string; data: Record<string, any> };
  state: Record<string, any>;
  world: { id: string; name: string; playerName: string; sceneName: string };
  reading: {
    segments: ReadingSegment[];
    index: number;
    displayedText: string;
    complete: boolean;
    loading: boolean;
    typing: boolean;
    paused: boolean;
    error: string | null;
  };
  actions: string[];
  clues: Array<Record<string, string> | string>;
  inventory: string[];
  characters: string[];
};
type EidosBridge = {
  gameplay?: { commit?(value: Record<string, unknown>): Promise<unknown>; narrate(id: string): Promise<unknown> };
  onContext(callback: (context: TestContext) => void): void;
  setState(state: Record<string, any>): void;
  submit(action: string, state: Record<string, any>): void;
  advance(): void;
};
type FrameWindow = Window & { Eidos: EidosBridge; eval(source: string): unknown };

afterEach(() => document.body.replaceChildren());

type CrossExaminationApi = {
  createState(): Record<string, unknown>;
  view(context: Record<string, any>, state: Record<string, any>): Record<string, any>;
  press(context: Record<string, any>, state: Record<string, any>, lineId: string): Record<string, any>;
  present(context: Record<string, any>, state: Record<string, any>, lineId: string, evidenceId: string): Record<string, any>;
  setPaused(state: Record<string, any>, paused: boolean): Record<string, any>;
  startOfflineDemo(state: Record<string, any>): Record<string, any>;
  endOfflineDemo(state: Record<string, any>): Record<string, any>;
  discoverDemoEvidence(context: Record<string, any>, state: Record<string, any>): Record<string, any>;
  reread(context: Record<string, any>, state: Record<string, any>): string;
};

function loadPackage() {
  const root = join(process.cwd(), 'mods/cross-examination');
  const manifest = sourceManifest('cross-examination');
  const sandbox: Record<string, any> = {};
  runInNewContext(readFileSync(join(root, 'logic.js'), 'utf8'), sandbox);
  return { manifest, api: sandbox.CrossExamination as CrossExaminationApi };
}

function loadUi() {
  const root = join(process.cwd(), 'mods/cross-examination');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
  const inline = scripts.map((script) => script.replace(/^<script[^>]*>|<\/script>$/g, '')).find((script) => script.trim());
  const documentMarkup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const frameDocument = iframe.contentDocument;
  const window = iframe.contentWindow as FrameWindow | null;
  if (!frameDocument || !window) throw new Error('Could not create the mod preview iframe');
  const previewWindow: FrameWindow = window;
  frameDocument.open();
  frameDocument.write(documentMarkup);
  frameDocument.close();
  let onContext: ((context: TestContext) => void) | undefined;
  const calls = { states: [] as Array<Record<string, any>>, submits: [] as Array<{ action: string; state: Record<string, any> }>, advances: 0 };
  window.Eidos = {
    onContext(callback: (context: TestContext) => void) { onContext = callback; },
    setState(state: Record<string, any>) { calls.states.push(state); },
    submit(action: string, state: Record<string, any>) { calls.submits.push({ action, state }); },
    advance() { calls.advances += 1; },
  };
  window.eval(readFileSync(join(root, 'logic.js'), 'utf8'));
  window.eval(inline || '');
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = previewWindow.document.getElementById(id);
    if (!element) throw new Error(`Missing #${id} in mod preview`);
    return element as T;
  }
  function query<T extends Element = Element>(selector: string): T {
    const element = previewWindow.document.querySelector(selector);
    if (!element) throw new Error(`Missing ${selector} in mod preview`);
    return element as T;
  }
  return { window, calls, byId, query, emit: (context: TestContext) => onContext?.(context) };
}

function contextFor(manifest: Record<string, any>, clues: Array<Record<string, string> | string> = []): TestContext {
  return {
    plugin: { id: manifest.id, name: manifest.name, data: manifest.data },
    state: {},
    world: { id: 'harbor', name: '雾港', playerName: '调查员', sceneName: '档案室' },
    reading: { segments: [], index: 0, displayedText: '证人走到灯下。', complete: true, loading: false, typing: false, paused: false, error: null },
    actions: [], clues, inventory: [], characters: ['闻澜', '栖舟'],
  };
}

describe('cross-examination mod logic', () => {
  it('surfaces an accepted result narration retry after reading has finished without replaying the operation', async () => {
    const { manifest } = loadPackage(), app = loadUi();
    const narrations: string[] = [];
    app.window.Eidos.gameplay = { narrate(id: string) { narrations.push(id); return Promise.resolve({ queued: true }); } };
    const context = contextFor(manifest);
    context.state = { _eidosGameplay: { revision: 1, last: { id: 'accepted', narration: 'pending' } } };
    context.reading.error = '正文生成失败';
    app.emit(context);
    expect(app.byId('advance-reading').hidden).toBe(false);
    app.byId<HTMLButtonElement>('advance-reading').click();
    await Promise.resolve();
    expect(narrations).toEqual(['accepted']);
    expect(app.calls.states).toEqual([]);
    expect(app.calls.submits).toEqual([]);
    app.emit({ ...context, state: { _eidosGameplay: { revision: 1, last: { id: 'accepted', narration: 'none' } } } });
    expect(app.byId('advance-reading').hidden).toBe(true);
  });
  it('waits for formal acceptance before advancing and keeps the current sentence after rejection', async () => {
    const { manifest } = loadPackage(), app = loadUi(), line = manifest.data.case.testimony[0];
    let proposal: Record<string, unknown> | undefined, reject!: (error: Error) => void;
    app.window.Eidos.gameplay = { commit(value: Record<string, unknown>) { proposal = value; return new Promise((_resolve, fail) => { reject = fail; }); }, narrate() { throw new Error('must not narrate a rejected result'); } };
    app.emit({ ...contextFor(manifest, manifest.data.case.clues), state: { pressed: [line.id] } });
    app.query<HTMLButtonElement>(`[data-evidence="${line.evidenceId}"]`).click();
    app.query<HTMLButtonElement>('[data-present]').click();
    expect(proposal).toMatchObject({ state: { currentIndex: 1 }, facts: { resolved: [line.id] } });
    expect(app.calls.submits).toEqual([]);
    expect(app.window.document.body.textContent).toContain(line.revised);
    reject(new Error('版本已变化')); await Promise.resolve(); await Promise.resolve();
    expect(app.window.document.body.textContent).toContain('版本已变化');
    expect(app.window.document.body.textContent).toContain(line.revised);
    expect(app.calls.states.some(state => state.currentIndex === 1)).toBe(false);
  });
  it('lets a player select and present evidence discovered inside the offline rehearsal', () => {
    const { manifest } = loadPackage();
    const app = loadUi();
    app.emit(contextFor(manifest));
    app.window.document.querySelector<HTMLButtonElement>('[data-offline-demo]')!.click();
    app.window.document.querySelector<HTMLButtonElement>('[data-press]')!.click();
    for (let index = 0; index < 2; index++) app.window.document.querySelector<HTMLButtonElement>('[data-demo-investigate]')!.click();
    const evidenceId = manifest.data.case.testimony[0].evidenceId;
    app.window.document.querySelector<HTMLButtonElement>(`[data-evidence="${evidenceId}"]`)!.click();
    const present = app.window.document.querySelector('[data-present]') as HTMLButtonElement;
    expect(present.disabled).toBe(false);
    present.click();
    expect(app.calls.states.at(-1)?.currentIndex).toBe(1);
    expect(app.calls.submits).toHaveLength(0);
  });
  it('keeps undiscovered evidence out of the testimony view', () => {
    const { manifest, api } = loadPackage();
    const view = api.view(contextFor(manifest), api.createState());
    const sealedClue = manifest.data.case.testimony[0].evidenceId;

    expect(view.evidence).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(sealedClue);
    expect(view.current.text).toBeTruthy();
  });

  it('maps a witness name onto a character from the imported world', () => {
    const { manifest, api } = loadPackage();
    const witness = manifest.data.case.testimony[0].speaker;
    manifest.data.case.characterBindings = { [witness]: '夜班守灯人' };
    const context = contextFor(manifest);
    context.characters = ['夜班守灯人'];

    expect(api.view(context, api.createState()).current.speaker).toBe('夜班守灯人');
  });

  it('changes the selected testimony only after pressing that exact line', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const first = manifest.data.case.testimony[0];
    const initial = api.view(contextFor(manifest), state);

    expect(initial.current.text).toBe(first.original);
    expect(initial.current.text).not.toBe(first.revised);

    const pressed = api.press(contextFor(manifest), state, first.id);
    const revised = api.view(contextFor(manifest), pressed.state);

    expect(pressed.outcome).toBe('pressed');
    expect(revised.current.text).toBe(first.revised);
    expect(revised.current.pressed).toBe(true);
  });

  it('requires a follow-up before challenging the exact testimony sentence', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const first = manifest.data.case.testimony[0];
    const clue = manifest.data.case.clues.find((item: any) => item.id === first.evidenceId);
    const context = contextFor(manifest, [{ id: clue.id, name: clue.name }]);

    const result = api.present(context, state, first.id, first.evidenceId);

    expect(result.outcome).toBe('press-first');
    expect(result.state.currentIndex).toBe(0);
  });

  it('rejects unrelated discovered evidence without clearing the amended testimony', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const first = manifest.data.case.testimony[0];
    const decoy = manifest.data.case.clues.find((clue: any) => clue.id !== first.evidenceId);
    const context = contextFor(manifest, [{ id: decoy.id, name: decoy.name }]);
    const pressed = api.press(context, state, first.id).state;
    const result = api.present(context, pressed, first.id, decoy.id);

    expect(result.outcome).toBe('wrong-evidence');
    expect(result.state.currentIndex).toBe(0);
    expect(api.view(context, result.state).current.text).toBe(first.revised);
  });

  it('advances only when the revised sentence is contradicted by discovered evidence', () => {
    const { manifest, api } = loadPackage();
    let state = api.createState();
    const first = manifest.data.case.testimony[0];
    const firstClue = manifest.data.case.clues.find((clue: any) => clue.id === first.evidenceId);
    const firstContext = contextFor(manifest, [{ id: firstClue.id, name: firstClue.name }]);

    state = api.press(firstContext, state, first.id).state;
    const firstResult = api.present(firstContext, state, first.id, first.evidenceId);
    expect(firstResult.outcome).toBe('sentence-broken');
    state = firstResult.state;
    expect(state.currentIndex).toBe(1);

    const second = manifest.data.case.testimony[1];
    const secondClue = manifest.data.case.clues.find((clue: any) => clue.id === second.evidenceId);
    const bothClues = contextFor(manifest, [
      { id: firstClue.id, name: firstClue.name }, { id: secondClue.id, name: secondClue.name },
    ]);
    state = api.press(bothClues, state, second.id).state;
    const finalResult = api.present(bothClues, state, second.id, second.evidenceId);

    expect(finalResult.outcome).toBe('case-complete');
    expect(finalResult.state.completed).toBe(true);
  });

  it('pauses and rereads the currently visible statement without exposing later testimony', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const paused = api.setPaused(state, true);
    const view = api.view(contextFor(manifest), paused);

    expect(view.paused).toBe(true);
    expect(api.reread(contextFor(manifest), paused)).toContain('证人走到灯下。');
    expect(api.reread(contextFor(manifest), paused)).not.toContain(manifest.data.case.testimony[1].revised);
  });

  it('plays the authored testimony offline without preloading future evidence or bypassing follow-up', () => {
    const { manifest, api } = loadPackage();
    const context = contextFor(manifest);
    let state = api.startOfflineDemo(api.createState());
    const first = manifest.data.case.testimony[0];

    expect(api.view(context, state).evidence).toEqual([]);
    state = api.press(context, state, first.id).state;
    expect(api.view(context, state).current.text).toBe(first.revised);
    expect(api.view(context, state).evidence).toEqual([]);
    expect(api.present(context, state, first.id, first.evidenceId).outcome).toBe('unknown-evidence');

    state = api.discoverDemoEvidence(context, state).state;
    const decoyId = manifest.data.case.demoDiscoveries[0];
    expect(api.view(context, state).evidence.map((item: any) => item.id)).toEqual([decoyId]);
    expect(api.present(context, state, first.id, decoyId).outcome).toBe('wrong-evidence');

    state = api.discoverDemoEvidence(context, state).state;
    const correctId = manifest.data.case.demoDiscoveries[1];
    expect(api.view(context, state).evidence.map((item: any) => item.id)).toEqual([decoyId, correctId]);
    const broken = api.present(context, state, first.id, first.evidenceId);
    expect(broken.outcome).toBe('sentence-broken');
    state = broken.state;

    const second = manifest.data.case.testimony[1];
    state = api.press(context, state, second.id).state;
    state = api.discoverDemoEvidence(context, state).state;
    const finished = api.present(context, state, second.id, second.evidenceId);
    expect(finished.outcome).toBe('case-complete');
    expect(finished.state.completed).toBe(true);
  });

  it('leaves the offline sample cleanly and returns to the real world clue list', () => {
    const { manifest, api } = loadPackage();
    const context = contextFor(manifest);
    let state = api.startOfflineDemo(api.createState());
    state = api.discoverDemoEvidence(context, state).state;
    state = api.press(context, state, manifest.data.case.testimony[0].id).state;

    const resumed = api.endOfflineDemo(state);

    expect(api.view(context, resumed).demoMode).toBe(false);
    expect(api.view(context, resumed).evidence).toEqual([]);
    expect(api.view(context, resumed).current.pressed).toBe(false);
  });

  it('renders reading and amended testimony, then shows the model response after evidence is presented', () => {
    const { manifest } = loadPackage();
    const { calls, byId, query, emit } = loadUi();
    const context = contextFor(manifest, [
      { id: 'salted-key', name: '盐渍钥匙' },
      { id: 'breaker-card', name: '断路巡检卡' },
    ]);
    context.reading = { ...context.reading, segments: ['公开段落'], index: 0, displayedText: '调查员进入灯塔。', complete: false, loading: false, typing: false, paused: false };
    emit(context);
    expect(byId('reading-text').textContent).toBe('调查员进入灯塔。');
    byId<HTMLButtonElement>('advance-reading').click();
    expect(calls.advances).toBe(1);

    query<HTMLButtonElement>('[data-press]').click();
    expect(query('.quote').textContent).toContain(manifest.data.case.testimony[0].revised);
    query<HTMLButtonElement>('[data-evidence="salted-key"]').click();
    query<HTMLButtonElement>('[data-present]').click();
    expect(calls.submits).toHaveLength(0);
    expect(calls.states[calls.states.length - 1]?.currentIndex).toBe(0);

    query<HTMLButtonElement>('[data-evidence="breaker-card"]').click();
    query<HTMLButtonElement>('[data-present]').click();
    expect(calls.submits).toHaveLength(1);
    emit({ ...context, state: calls.submits[0].state, reading: { ...context.reading, displayedText: '证人低头看向巡检卡。', segments: ['证人低头看向巡检卡。'], complete: true } });
    expect(byId('reading-text').textContent).toBe('证人低头看向巡检卡。');
  });
});
