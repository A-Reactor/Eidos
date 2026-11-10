// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { parseGameplayOperation } from '@/lib/game/plugins/gameplay-state';
import type { Operation, StageApi, StageRun, MindApi, MindRun } from './meta-minds-fixtures';
interface Context { scope: string; state: Record<string, unknown>; surface: { active: boolean }; reading: { loading: boolean; paused: boolean; segments?: Array<{text:string}> }; capabilities: { analysis: { available: boolean } } }
afterEach(() => document.body.replaceChildren());
function stage(folder: string) {
  const frame = document.createElement('iframe'); document.body.append(frame);
  const win = frame.contentWindow! as Window & typeof globalThis & { Palimpsest: StageApi; SocialMinds: MindApi; Eidos: unknown }, doc = frame.contentDocument!;
  const html = readFileSync(`mods/${folder}/index.html`, 'utf8');
  doc.open(); doc.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')); doc.close();
  let publish!: (context: Context) => void, finish!: () => void, reject = false, pending = false, calls = 0, delayRetry = false;
  let failRetry!: () => void;
  let current: Context = { scope: 'test:root', state: {}, surface: { active: true }, reading: { loading: false, paused: false }, capabilities: { analysis: { available: true } } };
  const files = new Map<string, string>(), narration: string[] = [];
  win.Eidos = { onContext(fn: typeof publish) { publish = fn; }, setState(state: Record<string, unknown>) { current = { ...current, state }; publish(current); }, gameplay: {
    async commit(op: Operation & {id?: string}) { calls++; parseGameplayOperation({ id: op.id || 'accepted-id', expectedRevision: 0, ...op }); if (reject) throw new Error('磁盘拒绝');
      if (op.id) { if (delayRetry) await new Promise((_resolve, reject) => { failRetry = () => reject(new Error('旧分支保存失败')); }); pending = false; return { id: op.id, persistence: 'saved' }; }
      current = { ...current, state: { ...op.state, _eidosGameplay: { last: { id: 'accepted-id' } } } }; publish(current);
      return { id: 'accepted-id', persistence: pending ? 'pending' : 'saved' };
    }, async narrate(id: string) { narration.push(id); },
  }, files: { async write(path: string, content: string) { files.set(path, content); }, async export() {}, async read(path: string) { return { text: files.get(path) }; }, async publish() { return { origin: 'original:branch' }; }, async receive() { return { origin: 'original:branch' }; } },
    resources: { inspect: () => new Promise(resolve => { finish = () => resolve({ content: JSON.stringify({ ...win.Palimpsest.sample(), id: 'candidate', title: '新剧本' }) }); }), async cancel() {} },
  };
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) win.eval(readFileSync(`mods/${folder}/${match[1]}`, 'utf8'));
  publish(current);
  return { win, doc, files, narration, click: (id: string) => doc.querySelector<HTMLButtonElement>('#' + id)!.click(),
    flush: () => new Promise(resolve => setTimeout(resolve, 0)), get current() { return current; }, get calls() { return calls; },
    set reject(value: boolean) { reject = value; }, set pending(value: boolean) { pending = value; },
    set delayRetry(value: boolean) { delayRetry = value; }, failRetry: () => failRetry(),
    publish(ctx: Context) { current = ctx; publish(ctx); }, finishGeneration: () => finish() };
}
it.each(['palimpsest-stage', 'social-minds'])('%s never advances on rejected commits and retries pending saves with the accepted ID', async folder => {
  const app = stage(folder); app.reject = true; app.click('start'); await app.flush();
  expect(app.current.state.run).toBeUndefined(); expect(app.doc.querySelector('#message')!.textContent).toContain('磁盘拒绝');
  app.reject = false; app.pending = true; app.click('start'); await app.flush();
  expect(app.current.state.run).toBeDefined(); expect(app.doc.querySelector<HTMLButtonElement>('#retry-save')!.hidden).toBe(false);
  const run = structuredClone(app.current.state.run); app.click('retry-save'); await app.flush();
  expect(app.current.state.run).toEqual(run); expect(app.calls).toBe(3);
  expect(app.doc.querySelector<HTMLButtonElement>('#retry-save')!.hidden).toBe(true);
});
it('shows the actual Meta edit and original comparison, then blocks input on a suspended branch', async () => {
  const app = stage('palimpsest-stage'); app.click('start'); await app.flush();
  app.click('show-all'); await app.flush(); app.doc.querySelector<HTMLButtonElement>('[data-choice="enter"]')!.click(); await app.flush();
  app.click('show-all'); await app.flush();
  expect(app.doc.querySelector('#stage-lines')!.textContent).toContain('■■');
  expect(app.doc.querySelector('#original-lines')!.textContent).toContain('明天，澄会在剧场等你。');
  expect(app.doc.querySelector('[data-choice="remember"]')!.textContent).toContain('记住她的名字');
  const before = structuredClone(app.current.state.run);
  app.publish({ ...app.current, surface: { active: false } });
  app.doc.querySelector<HTMLButtonElement>('[data-choice="remember"]')!.click(); await app.flush();
  expect(app.current.state.run).toEqual(before);
});
it('discards a late Meta candidate on branch changes and retains current play until restart confirmation', async () => {
  const app = stage('palimpsest-stage'); app.click('start'); await app.flush();
  app.click('generate'); await app.flush();
  app.publish({ ...app.current, scope: 'test:other' }); app.finishGeneration(); await app.flush();
  expect(app.doc.querySelector('#candidate')!.textContent).not.toContain('新剧本');
  app.click('generate'); await app.flush(); app.finishGeneration(); await app.flush();
  expect((app.current.state.run as StageRun).script.id).not.toBe('candidate');
  app.click('restart'); expect((app.current.state.run as StageRun).script.id).not.toBe('candidate');
  app.click('confirm-start'); await app.flush(); expect((app.current.state.run as StageRun).script.id).toBe('candidate');
});
it('lets the mind stage investigate, presents observable views and requests narration without another local turn', async () => {
  const app = stage('social-minds'); app.click('start'); await app.flush();
  app.doc.querySelector<HTMLButtonElement>('[data-inspect="fuse"]')!.click(); await app.flush();
  expect((app.current.state.run as MindRun).turn).toBe(1);
  expect(app.doc.querySelector('#evidence')!.textContent).toContain('熔断器残片');
  expect(app.doc.querySelector('#people')!.textContent).not.toMatch(/信任\s*[+−\-]?\d/);
  app.click('narrate'); await app.flush(); expect(app.narration).toEqual(['accepted-id']);
  expect((app.current.state.run as MindRun).turn).toBe(1);
});

it('keeps the player’s static presentation preference across accepted Meta decisions', async () => {
  const app = stage('palimpsest-stage'); app.click('start'); await app.flush();
  const input = app.doc.querySelector<HTMLInputElement>('#still')!; input.checked = true;
  input.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  app.click('show-all'); await app.flush();
  expect(app.current.state.still).toBe(true); expect(app.doc.documentElement.classList.contains('static')).toBe(true);
});

it.each(['palimpsest-stage', 'social-minds'])('%s discards a failed old save retry after restoring a branch without a run', async folder => {
  const app = stage(folder); app.pending = true; app.click('start'); await app.flush();
  app.delayRetry = true; app.click('retry-save'); await app.flush();
  app.publish({ ...app.current, scope: 'before-game', state: {} }); app.failRetry(); await app.flush();
  expect(app.doc.querySelector<HTMLButtonElement>('#retry-save')!.hidden).toBe(true);
  expect(app.doc.querySelector<HTMLButtonElement>('#start')!.disabled).toBe(false);
  expect(app.doc.querySelector('#message')!.textContent).not.toContain('旧分支保存失败');
});
