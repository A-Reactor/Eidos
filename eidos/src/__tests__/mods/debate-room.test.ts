// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

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

type DebateApi = {
  createState(): Record<string, unknown>;
  view(context: Record<string, any>, state: Record<string, any>): Record<string, any>;
  respond(context: Record<string, any>, state: Record<string, any>, response: Record<string, string>): Record<string, any>;
  setPaused(state: Record<string, any>, paused: boolean): Record<string, any>;
  startOfflineDemo(state: Record<string, any>): Record<string, any>;
  endOfflineDemo(state: Record<string, any>): Record<string, any>;
  discoverDemoEvidence(context: Record<string, any>, state: Record<string, any>): Record<string, any>;
  reread(context: Record<string, any>, state: Record<string, any>): string;
};

function loadPackage() {
  const root = join(process.cwd(), 'mods/debate-room');
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const sandbox: Record<string, any> = {};
  runInNewContext(readFileSync(join(root, 'logic.js'), 'utf8'), sandbox);
  return { manifest, api: sandbox.DebateRoom as DebateApi };
}

function loadUi() {
  const root = join(process.cwd(), 'mods/debate-room');
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
    reading: { segments: [], index: 0, displayedText: '封存室的灯亮起。', complete: true, loading: false, typing: false, paused: false, error: null },
    actions: [], clues, inventory: [], characters: ['闻澜', '栖舟'],
  };
}

describe('debate-room mod logic', () => {
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
  it('shows only evidence already discovered in the world context', () => {
    const { manifest, api } = loadPackage();
    const view = api.view(contextFor(manifest), api.createState());
    const sealedClue = manifest.data.case.rounds[0].evidenceId;

    expect(view.evidence).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(sealedClue);
    expect(view.current.statement.text).toBeTruthy();
  });

  it('maps the sample speaker label to a character present in an imported world', () => {
    const { manifest, api } = loadPackage();
    const statement = manifest.data.case.rounds[0].statement;
    manifest.data.case.characterBindings = { [statement.speaker]: '夜班守门人' };
    const context = contextFor(manifest);
    context.characters = ['夜班守门人'];

    expect(api.view(context, api.createState()).current.statement.speaker).toBe('夜班守门人');
  });

  it('does not accept a valid case clue until the world has revealed it', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const round = manifest.data.case.rounds[0];

    const result = api.respond(contextFor(manifest), state, {
      lineId: round.statement.id,
      evidenceId: round.evidenceId,
      relation: round.relation,
    });

    expect(result.outcome).toBe('unknown-evidence');
    expect(result.state.roundIndex).toBe(0);
  });

  it('keeps the debate on the same statement after an unrelated discovered clue', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const round = manifest.data.case.rounds[0];
    const decoy = manifest.data.case.clues.find((clue: any) => clue.id !== round.evidenceId);
    const context = contextFor(manifest, [{ id: decoy.id, name: decoy.name }]);

    const result = api.respond(context, state, {
      lineId: round.statement.id,
      evidenceId: decoy.id,
      relation: round.relation,
    });

    expect(result.outcome).toBe('wrong-evidence');
    expect(result.state.roundIndex).toBe(0);
  });

  it('accepts the factual rebuttal, then accepts a supporting fact for the next speaker', () => {
    const { manifest, api } = loadPackage();
    let state = api.createState();
    const first = manifest.data.case.rounds[0];
    const firstClue = manifest.data.case.clues.find((clue: any) => clue.id === first.evidenceId);
    let result = api.respond(contextFor(manifest, [{ id: firstClue.id, name: firstClue.name }]), state, {
      lineId: first.statement.id,
      evidenceId: first.evidenceId,
      relation: first.relation,
    });
    expect(result.outcome).toBe('resolved');
    state = result.state;
    expect(state.roundIndex).toBe(1);

    const second = manifest.data.case.rounds[1];
    const secondClue = manifest.data.case.clues.find((clue: any) => clue.id === second.evidenceId);
    result = api.respond(contextFor(manifest, [
      { id: firstClue.id, name: firstClue.name }, { id: secondClue.id, name: secondClue.name },
    ]), state, {
      lineId: second.statement.id,
      evidenceId: second.evidenceId,
      relation: second.relation,
    });

    expect(second.relation).toBe('support');
    expect(result.outcome).toBe('case-complete');
    expect(result.state.completed).toBe(true);
  });

  it('pauses without changing the evidence record and rereads only visible case text', () => {
    const { manifest, api } = loadPackage();
    const state = api.createState();
    const paused = api.setPaused(state, true);
    const view = api.view(contextFor(manifest), paused);

    expect(view.paused).toBe(true);
    expect(api.reread(contextFor(manifest), paused)).toContain('封存室的灯亮起。');
    expect(api.reread(contextFor(manifest), paused)).not.toContain(manifest.data.case.rounds[0].evidenceId);
  });

  it('plays the full authored case offline while revealing its evidence one investigation at a time', () => {
    const { manifest, api } = loadPackage();
    const context = contextFor(manifest);
    let state = api.startOfflineDemo(api.createState());
    const first = manifest.data.case.rounds[0];

    expect(api.view(context, state).evidence).toEqual([]);
    state = api.discoverDemoEvidence(context, state).state;
    expect(api.view(context, state).evidence.map((item: any) => item.id)).toEqual([manifest.data.case.demoDiscoveries[0]]);

    const wrongDirection = api.respond(context, state, {
      lineId: first.statement.id, evidenceId: first.evidenceId, relation: 'support',
    });
    expect(wrongDirection.outcome).toBe('wrong-relation');
    expect(wrongDirection.state.roundIndex).toBe(0);

    state = api.respond(context, state, {
      lineId: first.statement.id, evidenceId: first.evidenceId, relation: first.relation,
    }).state;
    expect(state.roundIndex).toBe(1);
    state = api.discoverDemoEvidence(context, state).state;
    const decoyId = manifest.data.case.demoDiscoveries[1];
    expect(api.view(context, state).evidence.map((item: any) => item.id)).toEqual([first.evidenceId, decoyId]);
    const second = manifest.data.case.rounds[1];
    expect(api.respond(context, state, {
      lineId: second.statement.id, evidenceId: decoyId, relation: second.relation,
    }).outcome).toBe('wrong-evidence');

    state = api.discoverDemoEvidence(context, state).state;
    const finished = api.respond(context, state, {
      lineId: second.statement.id, evidenceId: second.evidenceId, relation: second.relation,
    });
    expect(finished.outcome).toBe('case-complete');
    expect(finished.state.completed).toBe(true);
  });

  it('returns from the offline sample to the real world clue context without keeping sample progress', () => {
    const { manifest, api } = loadPackage();
    const context = contextFor(manifest);
    let state = api.startOfflineDemo(api.createState());
    state = api.discoverDemoEvidence(context, state).state;

    const resumed = api.endOfflineDemo(state);

    expect(api.view(context, resumed).demoMode).toBe(false);
    expect(api.view(context, resumed).evidence).toEqual([]);
    expect(resumed.roundIndex).toBe(0);
  });

  it('renders the current reading, advances it, and shows a submitted debate response', () => {
    const { manifest } = loadPackage();
    const { window, calls, byId, query, emit } = loadUi();
    const context = contextFor(manifest, [
      { id: 'salted-key', name: '盐渍钥匙' },
      { id: 'bell-ledger', name: '外廊巡铃簿' },
    ]);
    context.reading = { ...context.reading, segments: ['已揭示的第一段'], index: 0, displayedText: '已揭示的第一段正文。', complete: false, loading: false, typing: false, paused: true };
    emit(context);

    expect(byId('reading-text').textContent).toBe(context.reading.displayedText);
    expect(byId<HTMLButtonElement>('advance-reading').disabled).toBe(false);
    byId<HTMLButtonElement>('advance-reading').click();
    expect(calls.advances).toBe(1);

    query<HTMLButtonElement>('[data-evidence="salted-key"]').click();
    expect(query<HTMLButtonElement>('[data-relation="rebut"]').disabled).toBe(true);
    context.reading = { ...context.reading, paused: false };
    emit(context);
    query<HTMLButtonElement>('[data-evidence="salted-key"]').click();
    query<HTMLButtonElement>('[data-relation="rebut"]').click();
    expect(calls.submits).toHaveLength(0);
    expect(calls.states[calls.states.length - 1]?.roundIndex).toBe(0);

    query<HTMLButtonElement>('[data-evidence="bell-ledger"]').click();
    query<HTMLButtonElement>('[data-relation="rebut"]').click();
    expect(calls.submits).toHaveLength(1);
    emit({ ...context, state: calls.submits[0].state, reading: { ...context.reading, displayedText: '守门人停顿后作出回应。', segments: ['守门人停顿后作出回应。'], complete: true } });
    expect(byId('reading-text').textContent).toBe('守门人停顿后作出回应。');
  });
});
