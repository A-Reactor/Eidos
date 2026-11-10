// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceManifest } from './source-package';

type ModState = {
  foundClues: string[];
  selectedTestimony: string;
  challengedStatements: string[];
  suspicion: string;
  verdict: string;
  verdictFor: string;
  privacyChoice: string;
  bindings: Record<string, string>;
  [key: string]: unknown;
};
type ModContext = {
  plugin: { id: string; name: string; data: PluginData };
  state?: Partial<ModState>;
  world: { id: string; name: string; playerName: string; sceneName: string };
  reading: { segments: unknown[]; index: number; displayedText: string; complete: boolean; loading: boolean; error: string | null };
  actions: string[];
  clues: unknown[];
  inventory: unknown[];
  characters: string[];
};
type PluginData = Record<string, unknown> & {
  privateLetter: { text: string };
  case?: { victimName?: string };
  clues?: Array<{ id: string; detail: string }>;
};
type EidosApi = {
  onContext: (callback: (context: ModContext) => void) => void;
  setState: (state: ModState) => void;
  submit: (action: string, nextState?: ModState) => void;
  advance: () => void;
};
type ShareableManifest = {
  format: string;
  version: number;
  id: string;
  name: string;
  prompts: Record<'creation' | 'action' | 'review', string>;
  rules: unknown[];
  ui: { reading: string; initialState: Record<string, unknown>; html?: string };
  data: PluginData;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../mods/secrets-trial');
const manifestPath = resolve(packageRoot, 'manifest.json');
const htmlPath = resolve(packageRoot, 'index.html');
const manifest: ShareableManifest = existsSync(manifestPath) ? sourceManifest('secrets-trial') as ShareableManifest : {
  id: 'secrets-trial', name: 'Secrets Trial', prompts: { creation: '', action: '', review: '' }, rules: [],
  format: 'eidos-gameplay-plugin', version: 1,
  ui: { reading: 'replace', initialState: {} }, data: { privateLetter: { text: '' } },
};
const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
const privateLetterText = manifest.data.privateLetter.text.replaceAll('{victim}', manifest.data.case?.victimName ?? '遇难者');
const soupLedgerDetail = manifest.data.clues?.find(entry => entry.id === 'soup-ledger')?.detail ?? '';

function mount() {
  let onContext: ((context: ModContext) => void) | undefined;
  const savedStates: ModState[] = [];
  const submitted: Array<{ action: string; nextState?: unknown }> = [];
  let advances = 0;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const stage = parsed.querySelector<HTMLElement>('#mod-root');
  document.body.replaceChildren(stage ? document.importNode(stage, true) : document.createElement('div'));
  const script = parsed.querySelector('script')?.textContent ?? '';
  const modWindow = window as Window & { Eidos?: EidosApi };
  modWindow.Eidos = {
    onContext(callback) { onContext = callback; },
    setState(state) { savedStates.push(JSON.parse(JSON.stringify(state)) as ModState); },
    submit(action, nextState) { submitted.push({ action, nextState }); },
    advance() { advances += 1; },
  };
  new Function('window', 'document', script)(modWindow, document);
  const context: ModContext = {
    plugin: { id: manifest.id, name: manifest.name, data: manifest.data },
    state: undefined,
    world: { id: 'imported-city', name: '潮灯城', playerName: '渡舟', sceneName: '雾灯宿舍' },
    reading: { segments: [], index: 0, displayedText: '雨落在宿舍的旧窗台上。', complete: false, loading: false, error: null },
    actions: [],
    clues: [],
    inventory: [],
    characters: ['陆弦', '闻舟', '青荻'],
  };
  onContext?.(context);
  return {
    context,
    root: document.querySelector<HTMLElement>('#mod-root'),
    savedStates,
    submitted,
    get advances() { return advances; },
    state(): ModState { return savedStates.at(-1) ?? context.state as ModState ?? {} as ModState; },
    close() { document.body.replaceChildren(); },
  };
}

type MountedMod = ReturnType<typeof mount>;
function click(app: MountedMod, action: string, id?: string) {
  const selector = `[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`;
  const button = app.root?.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`缺少可操作控件：${selector}`);
  button.click();
}

function resolveCorrectAccusation(app: MountedMod) {
  if (!app.state().foundClues.includes('wick-fiber')) click(app, 'inspect', 'wick-fiber');
  click(app, 'testimony', 'maker-denial');
  click(app, 'present', 'wick-fiber');
  if (!app.state().foundClues.includes('bell-thread')) click(app, 'inspect', 'bell-thread');
  click(app, 'suspect', 'lampmaker');
  click(app, 'screen', 'trial');
  click(app, 'convict');
}

describe('secrets-trial shareable gameplay mod', () => {
  it('keeps v1 manifest data separate from the authored HTML stage', () => {
    expect(manifest).toMatchObject({ format: 'eidos-gameplay-plugin', version: 1, id: 'secrets-trial' });
    expect(manifest.prompts).toMatchObject({ creation: expect.any(String), action: expect.any(String), review: expect.any(String) });
    expect(manifest.rules).toEqual(expect.any(Array));
    expect(manifest.ui).toMatchObject({ reading: 'inherit', presentation: 'native', initialState: expect.any(Object) });
    expect(manifest.ui).not.toHaveProperty('html');
    expect(html).toContain('Eidos.onContext');
  });

  it('renders an independent trial stage without displaying a private letter before judgment', () => {
    const app = mount();
    const content = app.root?.textContent ?? '';
    expect(app.root?.matches('[data-trial-stage]')).toBe(true);
    expect(content).toContain('渡舟');
    expect(content).toContain('雨落在宿舍的旧窗台上。');
    expect(content).not.toContain(privateLetterText);
    expect(content).not.toContain(soupLedgerDetail);
    expect(app.savedStates).toHaveLength(1);
    app.close();
  });

  it('records only inspected evidence, sends the inquiry through Eidos, and preserves role mapping', () => {
    const app = mount();
    click(app, 'inspect', 'soup-ledger');
    const state = app.state();
    expect(state.foundClues).toContain('soup-ledger');
    expect(app.root?.textContent).toContain(soupLedgerDetail);
    expect(app.submitted.at(-1)?.action).toContain('漏写的一碗');
    click(app, 'advance');
    expect(app.advances).toBe(1);

    const mapping = app.root?.querySelector<HTMLSelectElement>('[data-bind="echoist"]');
    expect(mapping).toBeTruthy();
    if (!mapping) return;
    mapping.value = '陆弦';
    mapping.dispatchEvent(new Event('change', { bubbles: true }));
    expect(app.root?.textContent).toContain('陆弦');
    expect(app.state().bindings.echoist).toBe('陆弦');
    app.close();
  });

  it('treats the echo as limited evidence and leaves an unsupported accusation unresolved', () => {
    const app = mount();
    click(app, 'inspect', 'echo-test');
    click(app, 'testimony', 'keeper-time');
    click(app, 'present', 'echo-test');
    expect(app.state().challengedStatements).not.toContain('keeper-time');
    expect(app.root?.textContent).toContain('目前不能直接证明或推翻这句话');

    click(app, 'testimony', 'echo-origin');
    click(app, 'present', 'echo-test');
    expect(app.root?.textContent).toContain('不能辨认说话人，也不能证明发生时间');

    click(app, 'suspect', 'echoist');
    click(app, 'screen', 'trial');
    click(app, 'convict');
    expect(app.state().suspicion).toBe('echoist');
    expect(app.state().verdict).toBe('open');
    expect(app.root?.textContent).toContain('证据还不能支持定罪');
    app.close();
  });

  it('rejects a wrong charge gently, then resolves the evidence-backed case without exposing the letter', () => {
    const app = mount();
    click(app, 'inspect', 'wick-fiber');
    click(app, 'suspect', 'echoist');
    click(app, 'screen', 'trial');
    click(app, 'convict');
    expect(app.state().verdict).toBe('open');
    expect(app.root?.textContent).toContain('证据还不能支持定罪');

    resolveCorrectAccusation(app);
    expect(app.state().verdict).toBe('resolved');
    expect(app.state().verdictFor).toBe('lampmaker');
    expect(app.root?.textContent).toContain('原信内容可以匿名保护');
    expect(app.root?.textContent).not.toContain(privateLetterText);

    click(app, 'protect-secret');
    expect(app.state().privacyChoice).toBe('anonymous');
    expect(app.root?.textContent).not.toContain(privateLetterText);
    expect(app.root?.textContent).toContain('没有复述林杳的私信原句');
    app.close();
  });

  it('allows quoting the private detail only as an explicit post-verdict choice', () => {
    const app = mount();
    resolveCorrectAccusation(app);
    expect(app.root?.textContent).not.toContain(privateLetterText);
    click(app, 'publish-secret');
    expect(app.state().privacyChoice).toBe('quoted');
    expect(app.root?.textContent).toContain(privateLetterText);
    app.close();
  });
});
