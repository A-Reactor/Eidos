// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrativeInput, type NarrativeRequest } from '@/lib/game/narrative';
import { beforeAll, describe, expect, it } from 'vitest';

const modDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../mods/continuous-novel');
interface NovelManifest {
  format: string;
  version: number;
  id: string;
  name: string;
  prompts: Record<'creation' | 'action' | 'review', string>;
  rules: unknown[];
  ui?: { html?: string; reading: string; initialState?: Record<string, unknown> };
  data: Record<string, unknown>;
}
const manifest = JSON.parse(readFileSync(resolve(modDirectory, 'manifest.json'), 'utf8')) as NovelManifest;
const htmlPath = resolve(modDirectory, 'index.html');

function context(overrides: Record<string, unknown> = {}) {
  return {
    plugin: { id: manifest.id, name: manifest.name, data: manifest.data },
    state: { autoRead: true },
    world: { id: 'mist-harbor', name: '雾港', playerName: '旅客', sceneName: '旧港站台' },
    reading: {
      segments: [{ type: 'narration', text: '雾灯在站台尽头亮起。' }],
      index: 0,
      displayedText: '雾灯在站台尽头亮起。',
      typing: false,
      paused: false,
      complete: false,
      loading: false,
      error: null,
    },
    actions: [],
    clues: [],
    inventory: [],
    characters: ['白槿'],
    scope: 'world:mist-harbor:node:one',
    ...overrides,
  };
}

function openReader() {
  const html = existsSync(htmlPath)
    ? readFileSync(htmlPath, 'utf8')
    : '<!doctype html><html><body><main id="continuous-novel"></main></body></html>';
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  if (!win || !frameDocument) throw new Error('jsdom iframe did not initialize');
  const scriptBodies = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  frameDocument.open();
  frameDocument.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  frameDocument.close();
  const scheduled = new Map<number, () => void>();
  const submitted: Array<{ action: string; nextState?: unknown; request?: NarrativeRequest }> = [];
  const savedStates: unknown[] = [];
  let advances = 0;
  let listener: ((value: unknown) => void) | undefined;
  let timerId = 0;
  win.setTimeout = ((callback: TimerHandler) => {
    const id = ++timerId;
    if (typeof callback === 'function') scheduled.set(id, callback as () => void);
    return id;
  }) as typeof win.setTimeout;
  win.clearTimeout = ((id: number) => { scheduled.delete(id); }) as typeof win.clearTimeout;
  (win as Window & { Eidos: unknown }).Eidos = {
    onContext(callback: (value: unknown) => void) { listener = callback; },
    setState(state: unknown) { savedStates.push(state); },
    submit(action: string, nextState?: unknown) { submitted.push({ action, nextState }); },
    narrate(request: NarrativeRequest, nextState?: unknown) { submitted.push({ action: narrativeInput(request), request, nextState }); },
    advance() { advances += 1; },
  };

  for (const script of scriptBodies) (win as Window & typeof globalThis).eval(script);

  return {
    frame,
    win,
    document: frameDocument,
    scheduled,
    submitted,
    savedStates,
    get advances() { return advances; },
    publish(value: unknown) { listener?.(value); },
    runScheduled() {
      const next = scheduled.entries().next().value as [number, () => void] | undefined;
      if (!next) return false;
      scheduled.delete(next[0]);
      next[1]();
      return true;
    },
  };
}

describe('continuous novel package', () => {
  it.each([['chapter', '进入下一章'], ['ending', '续写尾声']])('pauses automatic generation at a %s boundary and keeps an explicit continuation', (boundary, label) => {
    const reader = openReader();
    reader.publish(context({ settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '她终于寄出了信。', beat: { chapter: { id: 'night', title: '雾灯之后' }, boundary } }], complete: true, loading: false } }));
    expect(reader.scheduled.size).toBe(0);
    expect(reader.document.querySelector('[data-scene]')?.textContent).toContain('雾灯之后');
    const next = reader.document.querySelector<HTMLButtonElement>('[data-continue]')!;
    expect(next.textContent).toContain(label); next.click();
    expect(reader.submitted[0].request?.kind).toBe('continue'); reader.frame.remove();
  });
  it('never schedules background continuation when its stage has been suspended', () => {
    const reader = openReader();
    reader.publish(context({ surface: { active: false }, settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '普通段落。' }], complete: true, paused: true, loading: false } }));
    expect(reader.scheduled.size).toBe(0); reader.frame.remove();
  });
  it('waits for actual prose before scheduling automatic continuation', () => {
    const reader = openReader();
    reader.publish(context({ settings: { auto_continue: true }, reading: { segments: [], complete: true, loading: false } }));
    expect(reader.scheduled.size).toBe(0); reader.frame.remove();
  });
  it('does not bring future prose into an old snapshot that predates reader bookkeeping', () => {
    const reader = openReader();
    reader.publish(context({ world: { id: 'mist-harbor', nodeId: 'future', parentNodeId: 'past' }, scope: 'future', reading: { segments: [{ type: 'narration', text: '未来才会看到的结局。' }], complete: true } }));
    reader.publish(context({ world: { id: 'mist-harbor', nodeId: 'past', parentNodeId: null }, scope: 'past', state: { autoRead: false }, reading: { segments: [{ type: 'narration', text: '回到最初的站台。' }], complete: true } }));
    expect(reader.document.querySelector('[data-story-text]')?.textContent).not.toContain('未来才会看到');
    reader.frame.remove();
  });
  it('keeps chapter headings with earlier prose after opening a fresh reader', () => {
    const reader = openReader();
    reader.publish(context({ reading: { segments: [{ type: 'narration', text: '站台上的告别。', beat: { chapter: { id: 'platform', title: '第一章 · 最后一盏灯' }, boundary: 'chapter' } }], complete: true } }));
    const state = reader.savedStates.at(-1); reader.frame.remove();
    const next = openReader(); next.publish(context({ scope: 'next', state, reading: { segments: [{ type: 'narration', text: '车厢里的独处。' }], complete: true } }));
    expect(next.document.querySelector('[data-read-history]')?.textContent).toContain('第一章 · 最后一盏灯');
    next.frame.remove();
  });
  it('stops on explicit choices without a prose marker and submits the stable choice id', () => {
    const reader = openReader();
    reader.publish(context({ settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '列车停在了最后一站。', choices: [{ id: 'leave', label: '带着信下车' }, { id: 'stay', label: '陪她走完最后一段' }] }], complete: true, loading: false, typing: false } }));
    const button = [...reader.document.querySelectorAll<HTMLButtonElement>('[data-choice]')].find(b => b.textContent?.includes('带着信下车'));
    expect(button).toBeDefined(); expect(reader.scheduled.size).toBe(0);
    button!.click();
    expect(reader.submitted[0].request).toMatchObject({ kind: 'choice', choice: '带着信下车', choiceId: 'leave' });
    reader.frame.remove();
  });
  it('auto-continues only when enabled, once per beat, and stops at a critical choice', () => {
    const reader = openReader();
    const completed = context({ settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '列车穿过隧道。' }], complete: true, loading: false } });
    reader.publish(completed);
    expect(reader.runScheduled()).toBe(true);
    expect(reader.submitted[0].request?.kind).toBe('continue');
    reader.publish(completed); expect(reader.scheduled.size).toBe(0);
    reader.publish(context({ scope: 'world:mist-harbor:node:two', settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '〔关键抉择：下车｜留下〕' }], complete: true, loading: false } }));
    expect(reader.scheduled.size).toBe(0);
    expect(reader.submitted).toHaveLength(1);
    reader.frame.remove();
  });
  it('pauses automatic continuation when going back to previous prose', () => {
    const reader = openReader();
    reader.publish(context({ settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '读完这段。' }], complete: true, loading: false } }));
    reader.document.querySelector<HTMLButtonElement>('[data-backlog]')?.click();
    expect(reader.savedStates.at(-1)).toMatchObject({ autoRead: false });
    reader.publish(context({ state: reader.savedStates.at(-1), settings: { auto_continue: true }, reading: { segments: [{ type: 'narration', text: '读完这段。' }], complete: true, loading: false } }));
    expect(reader.scheduled.size).toBe(0);
    reader.frame.remove();
  });
  beforeAll(() => {
    expect(manifest.format).toBe('eidos-gameplay-plugin');
    expect(manifest.version).toBe(1);
    expect(manifest.prompts).toHaveProperty('creation');
    expect(manifest.prompts).toHaveProperty('action');
    expect(manifest.prompts).toHaveProperty('review');
    expect(manifest.rules).toEqual([]);
    expect(manifest.ui?.html).toBeUndefined();
  });

  it('keeps rendering within the visible segment and typewriter boundary', () => {
    const reader = openReader();
    reader.publish(context({
      reading: {
        segments: [
          { type: 'narration', text: '雾灯在站台尽头亮起。' },
          { type: 'dialogue', speaker: '白槿', text: '这班车只停一次。' },
          { type: 'narration', text: '还没有读到的车厢。' },
        ],
        index: 1,
        displayedText: '这班车只停',
        typing: true,
        paused: false,
        complete: false,
        loading: false,
        error: null,
      },
    }));

    const story = reader.document.querySelector('[data-story-text]');
    expect(story).toBeTruthy();
    expect(story?.textContent).toContain('雾灯在站台尽头亮起。');
    expect(story?.textContent).toContain('这班车只停');
    expect(story?.textContent).not.toContain('只停一次');
    expect(story?.textContent).not.toContain('还没有读到的车厢');
    expect(reader.scheduled.size).toBe(0);
    reader.frame.remove();
  });

  it('automatically advances a finished ordinary beat without requiring a click', () => {
    const reader = openReader();
    reader.publish(context());

    expect(reader.scheduled.size).toBe(1);
    expect(reader.runScheduled()).toBe(true);
    expect(reader.advances).toBe(1);
    expect(reader.submitted).toEqual([]);
    reader.frame.remove();
  });

  it('can pause automatic reading and keep a manual advance control', () => {
    const reader = openReader();
    reader.publish(context());
    const pause = reader.document.querySelector<HTMLButtonElement>('[data-auto-toggle]');
    expect(pause?.textContent).toContain('暂停连读');
    pause?.click();
    expect(reader.savedStates.at(-1)).toMatchObject({ autoRead: false });

    reader.publish(context({ state: { autoRead: false } }));
    expect(reader.scheduled.size).toBe(0);
    const next = reader.document.querySelector<HTMLButtonElement>('[data-manual-advance]');
    expect(next).toBeTruthy();
    next?.click();
    expect(reader.advances).toBe(1);
    reader.frame.remove();
  });

  it('pauses at an authored choice and submits the selected option as a normal action', () => {
    const reader = openReader();
    const text = '白槿把信封递到你面前。〔关键抉择：把信交给白槿｜先问清录音来自哪里〕';
    reader.publish(context({
      reading: {
        segments: [{ type: 'narration', text }],
        index: 0,
        displayedText: text,
        typing: false,
        paused: false,
        complete: true,
        loading: false,
        error: null,
      },
    }));

    const buttons = [...reader.document.querySelectorAll<HTMLButtonElement>('[data-choice]')];
    expect(buttons.map(button => button.textContent?.trim())).toEqual(['把信交给白槿', '先问清录音来自哪里']);
    expect(reader.document.querySelector('[data-story-text]')?.textContent).toContain('白槿把信封递到你面前。');
    expect(reader.document.querySelector('[data-story-text]')?.textContent).not.toContain('关键抉择');
    expect(reader.scheduled.size).toBe(0);

    buttons[1]?.click();
    expect(reader.advances).toBe(0);
    expect(reader.submitted).toHaveLength(1);
    expect(reader.submitted[0].action).toContain('先问清录音来自哪里');
    expect(reader.submitted[0].nextState).toMatchObject({ autoRead: true });
    reader.frame.remove();
  });

  it('offers a normal-action continuation at the end of a completed reading', () => {
    const reader = openReader();
    reader.publish(context({
      reading: {
        segments: [{ type: 'narration', text: '返潮号驶入海雾，站台灯光重新熄灭。' }],
        index: 0,
        displayedText: '返潮号驶入海雾，站台灯光重新熄灭。',
        typing: false,
        paused: false,
        complete: true,
        loading: false,
        error: null,
      },
    }));

    const continuation = reader.document.querySelector<HTMLButtonElement>('[data-continue]');
    expect(continuation?.textContent).toContain('继续故事');
    continuation?.click();
    expect(reader.submitted).toHaveLength(1);
    expect(reader.submitted[0].action).toContain('继续故事');
    expect(reader.advances).toBe(0);
    reader.frame.remove();
  });

  it('keeps previously read prose visible when context moves to the next world-line node', () => {
    const reader = openReader();
    reader.publish(context({
      reading: {
        segments: [{ type: 'dialogue', speaker: '白槿', text: '有些信，寄出去以后就不再属于写信的人。' }],
        index: 0,
        displayedText: '有些信，寄出去以后就不再属于写信的人。',
        typing: false,
        paused: false,
        complete: true,
        loading: false,
        error: null,
      },
    }));
    reader.publish(context({
      scope: 'world:mist-harbor:node:two',
      state: { autoRead: true, activeScope: 'world:mist-harbor:node:one' },
      reading: {
        segments: [{ type: 'narration', text: '列车向海雾深处驶去。' }],
        index: 0,
        displayedText: '列车向海雾深处驶去。',
        typing: true,
        paused: false,
        complete: false,
        loading: false,
        error: null,
      },
    }));

    const story = reader.document.querySelector('[data-story-text]');
    expect(story?.textContent).toContain('白槿：有些信，寄出去以后就不再属于写信的人。');
    expect(story?.textContent).toContain('列车向海雾深处驶去。');
    expect(reader.savedStates.at(-1)).toMatchObject({
      activeScope: 'world:mist-harbor:node:two',
      readHistory: expect.arrayContaining([{ scope: 'world:mist-harbor:node:one', scene: '旧港站台', text: '白槿：有些信，寄出去以后就不再属于写信的人。', decision: '' }]),
    });
    reader.frame.remove();
  });

  it('does not advance, submit, or offer choices while the model is still streaming', () => {
    const reader = openReader();
    reader.publish(context({
      actions: ['追问白槿'],
      reading: {
        segments: [{ type: 'narration', text: '车门刚刚打开。' }],
        index: 0,
        displayedText: '车门刚刚打开。',
        typing: false,
        paused: false,
        complete: true,
        loading: true,
        error: null,
      },
    }));

    expect(reader.document.querySelector('[data-novel-root]')).toBeTruthy();
    expect(reader.scheduled.size).toBe(0);
    expect(reader.document.querySelector<HTMLButtonElement>('[data-continue]')?.hidden).toBe(true);
    expect(reader.document.querySelector('[data-choice]')).toBeNull();
    expect(reader.submitted).toEqual([]);
    expect(reader.advances).toBe(0);
    reader.frame.remove();
  });

  it('archives the visible page when choosing a suggested action', () => {
    const reader = openReader();
    const text = '我把那封未寄出的信放回她手里。';
    reader.publish(context({ actions: ['陪她登车'], reading: { segments: [{ type: 'narration', text }], index: 0, displayedText: text, complete: true } }));
    reader.document.querySelector<HTMLButtonElement>('[data-suggestion]')?.click();
    expect(reader.submitted[0].nextState).toMatchObject({ readHistory: [{ text }] });
    reader.frame.remove();
  });

  it('restores previously read prose in a fresh frame after a core free-input action', () => {
    const reader = openReader();
    const text = '这是原输入框行动之前读完的正文。';
    reader.publish(context({ reading: { segments: [{ type: 'narration', text }], index: 0, displayedText: text, complete: true } }));
    const persisted = reader.savedStates.at(-1);
    reader.frame.remove();
    const next = openReader();
    next.publish(context({ scope: 'world:mist-harbor:node:two', state: persisted, reading: { segments: [{ type: 'narration', text: '接下来列车出发了。' }], index: 0, displayedText: '接下来列车出发了。', complete: true } }));
    expect(next.document.querySelector('[data-story-text]')?.textContent).toContain(text);
    expect(next.document.querySelector('[data-story-text]')?.textContent).toContain('接下来列车出发了。');
    next.frame.remove();
  });

  it('keeps the old page intact while new prose arrives before a node save completes', () => {
    const reader = openReader();
    const text = '她在站台上告别。';
    reader.publish(context({ reading: { segments: [{ type: 'narration', text }], index: 0, displayedText: text, complete: true } }));
    const persisted = reader.savedStates.at(-1);
    reader.publish(context({ state: persisted, reading: { segments: [{ type: 'narration', text: '列车驶过山洞。' }], index: 0, displayedText: '列车驶过山洞。', complete: false, loading: false } }));
    const saved = reader.savedStates.at(-1) as { readHistory?: Array<{ text: string }> };
    expect(saved.readHistory?.[0].text).toBe(text);
    reader.frame.remove();
  });

  it('does not archive a partially typed choice marker as story prose', () => {
    const reader = openReader();
    const full = '站台的最后一盏灯亮了。〔关键抉择：登车｜留下〕';
    reader.publish(context({ reading: { segments: [{ type: 'narration', text: full }], index: 0, displayedText: '站台的最后一盏灯亮了。〔关键抉择', complete: false, typing: true } }));
    expect(reader.document.querySelector('[data-story-text]')?.textContent).toBe('站台的最后一盏灯亮了。');
    const persisted = reader.savedStates.at(-1);
    reader.publish(context({ state: persisted, reading: { segments: [{ type: 'narration', text: full }], index: 0, displayedText: full, complete: false, typing: false } }));
    const saved = reader.savedStates.at(-1) as { readHistory: Array<{ text: string }> };
    expect(saved.readHistory[0].text).toBe('站台的最后一盏灯亮了。');
    reader.frame.remove();
  });
  it('labels a remote camera, hides protagonist possessions, and assigns a choice to its actor', () => {
    const reader = openReader();
    const view = { kind: 'cutaway', actor: '白槿', location: '空车厢', timeLabel: '与此同时' };
    const text = '白槿把信攥在手中。〔关键抉择：藏起信件｜交给检票员〕';
    reader.publish(context({ inventory: ['主角的钥匙'], clues: ['主角的线索'], reading: { segments: [{ type: 'narration', text, view }], complete: true, loading: false } }));
    expect(reader.document.querySelector('[data-scene]')?.textContent).toContain('空车厢');
    expect(reader.document.querySelector('[data-story-text]')?.textContent).toContain('主角尚未知情');
    expect(reader.document.querySelector<HTMLElement>('[data-inventory-section]')?.hidden).toBe(true);
    reader.document.querySelector<HTMLButtonElement>('[data-choice]')?.click();
    expect(reader.submitted[0].request).toEqual({ kind: 'choice', frame: view, choice: '藏起信件' });
    expect(reader.submitted[0].action).not.toContain('我选择');
    reader.frame.remove();
  });

  it('offers a return to the protagonist and retains the cutaway header across frames', () => {
    const reader = openReader();
    const view = { kind: 'cutaway', location: '站务室', timeLabel: '此前' };
    reader.publish(context({ reading: { segments: [{ type: 'narration', text: '无人听见她留下的告别。', view }], complete: true, loading: false } }));
    const persisted = reader.savedStates.at(-1);
    reader.document.querySelector<HTMLButtonElement>('[data-return]')?.click();
    expect(reader.submitted[0].request).toEqual({ kind: 'return' });
    reader.frame.remove();
    const next = openReader();
    next.publish(context({ scope: 'world:mist-harbor:node:two', state: persisted }));
    expect(next.document.querySelector('[data-read-history]')?.textContent).toContain('站务室');
    expect(next.document.querySelector('[data-read-history]')?.textContent).toContain('此前');
    next.frame.remove();
  });

});
