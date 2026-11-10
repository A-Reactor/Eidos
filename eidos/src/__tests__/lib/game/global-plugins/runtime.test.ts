// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GlobalPluginRuntime } from '@/lib/game/global-plugins/runtime';
import { installGlobalPlugins, setGlobalPluginEnabled, setGlobalPluginPreference, setGlobalPluginIntroduction, removeGlobalPlugin, GLOBAL_PLUGIN_LIBRARY_KEY } from '@/lib/game/global-plugins/library';
import { parseGlobalPlugin } from '@/lib/game/global-plugins/manifest';
import { useGameStore } from '@/store/game-store';
const make = (id: string, script: string) => parseGlobalPlugin({ format: 'eidos-global-plugin', version: 1, id, name: id, release: '1', description: id, script });
let runtime: GlobalPluginRuntime, stop: () => void;
beforeEach(() => { localStorage.clear(); useGameStore.setState({ phase: 'world_select', currentWorld: null }); runtime = new GlobalPluginRuntime(); stop = runtime.start(); });
afterEach(() => { stop(); vi.restoreAllMocks(); });
it('updates introduction metadata without restarting a running extension or dropping its hooks', () => {
  installGlobalPlugins([make('intro', `api.ui.addStyle('body{--intro-test:1}');api.actions.beforeSubmit(input=>'intro:'+input);`)]);
  setGlobalPluginEnabled('intro', true);
  const style = document.querySelector('[data-eidos-global-style="intro"]');
  setGlobalPluginIntroduction('intro', { impacts: ['appearance'], images: [{ src: 'data:image/png;base64,iVBORw0KGgo=', alt: '介绍' }] });
  expect(document.querySelector('[data-eidos-global-style="intro"]')).toBe(style);
  expect(runtime.transformAction('行动', false)).toBe('intro:行动');
  expect(runtime.getSnapshot().intro.state).toBe('running');
});
it('does not execute installed code until enabled, and keeps it alive across world selection and play', () => {
  installGlobalPlugins([make('badge', `const badge=document.createElement('output');badge.id='test-global-badge';api.ui.mount(badge);const render=()=>badge.textContent=api.game.getState().phase;render();api.game.subscribe(render);`)]);
  expect(document.getElementById('test-global-badge')).toBeNull();
  setGlobalPluginEnabled('badge', true);
  expect(document.getElementById('test-global-badge')?.textContent).toBe('world_select');
  useGameStore.setState({ phase: 'playing' });
  expect(document.getElementById('test-global-badge')?.textContent).toBe('playing');
  setGlobalPluginEnabled('badge', false);
  expect(document.getElementById('test-global-badge')).toBeNull();
  expect(runtime.transformAction('/环顾', false)).toBe('/环顾');
});
it('removes styles, action hooks, subscriptions, listeners and timers when disabled', () => {
  vi.useFakeTimers();
  try {
    installGlobalPlugins([make('managed', `api.ui.addStyle('body { --test-global: 1; }');api.actions.beforeSubmit(input=>input==='短命令'?'完整行动':input);api.listen(document,'test-global-event',()=>api.storage.set('event',true));api.setInterval(()=>api.storage.set('tick',true),100);api.onDispose(()=>api.storage.set('disposed',true));`)]);
    setGlobalPluginEnabled('managed', true);
    expect(runtime.transformAction('短命令', false)).toBe('完整行动');
    expect(document.querySelector('[data-eidos-global-style="managed"]')).not.toBeNull();
    setGlobalPluginEnabled('managed', false);
    document.dispatchEvent(new Event('test-global-event')); vi.advanceTimersByTime(200);
    expect(document.querySelector('[data-eidos-global-style="managed"]')).toBeNull();
    expect(runtime.transformAction('短命令', false)).toBe('短命令');
    const data = JSON.parse(localStorage.getItem('eidos_global_plugin_data:managed')!);
    expect(data).toEqual({ disposed: true });
  } finally { vi.useRealTimers(); }
});
it('isolates a failing plugin and cleans its partial registrations', () => {
  installGlobalPlugins([make('bad', `api.ui.addStyle('body{color:red}');throw new Error('broken mount');`),make('good', `api.actions.beforeSubmit(input=>'good:'+input);`)]);
  setGlobalPluginEnabled('bad', true); setGlobalPluginEnabled('good', true);
  expect(runtime.getSnapshot().bad).toMatchObject({ state: 'error', error: 'broken mount' });
  expect(document.querySelector('[data-eidos-global-style="bad"]')).toBeNull();
  expect(runtime.transformAction('行动', false)).toBe('good:行动');
});
it('uses stable install ordering for hooks and rejects broken hooks before any model request', () => {
  installGlobalPlugins([make('first', `api.actions.beforeSubmit(input=>'A'+input);`),make('second', `api.actions.beforeSubmit(input=>'B'+input);`)]);
  setGlobalPluginEnabled('first', true); setGlobalPluginEnabled('second', true);
  expect(runtime.transformAction('x', false)).toBe('BAx');
  runtime.reload('first'); expect(runtime.transformAction('x', false)).toBe('BAx');
  installGlobalPlugins([make('first', `api.actions.beforeSubmit(()=>{throw new Error('hook failure')});`)]); setGlobalPluginEnabled('first', true);
  expect(() => runtime.transformAction('x', false)).toThrow('hook failure');
  expect(runtime.getSnapshot().first.state).toBe('error');
});
it('restarts when preferences change and responds to cross-window disabling and uninstall', () => {
  const plugin = parseGlobalPlugin({ ...make('preferences', `api.ui.addStyle('body{--density:'+api.preferences.density+'}');`), settings: [{id:'density',label:'密度',type:'number',default:1,min:1,max:3}] });
  installGlobalPlugins([plugin]); setGlobalPluginEnabled(plugin.id, true);
  setGlobalPluginPreference(plugin.id, 'density', 3);
  expect(document.querySelector('[data-eidos-global-style="preferences"]')?.textContent).toContain('--density:3');
  const data=JSON.parse(localStorage.getItem(GLOBAL_PLUGIN_LIBRARY_KEY)!);data.entries[0].enabled=false;
  localStorage.setItem(GLOBAL_PLUGIN_LIBRARY_KEY,JSON.stringify(data));window.dispatchEvent(new StorageEvent('storage',{key:GLOBAL_PLUGIN_LIBRARY_KEY}));
  expect(document.querySelector('[data-eidos-global-style="preferences"]')).toBeNull();
  setGlobalPluginEnabled(plugin.id,true);removeGlobalPlugin(plugin.id);
  expect(document.querySelector('[data-eidos-global-style="preferences"]')).toBeNull();
});

it('keeps CSS precedence in installation order after reloads and later style updates', () => {
  installGlobalPlugins([make('first',`api.ui.addStyle('body{color:red}');api.listen(document,'late-style',()=>api.ui.addStyle('body{color:green}'));`),make('second',`api.ui.addStyle('body{color:blue}');`)]);
  setGlobalPluginEnabled('first',true);setGlobalPluginEnabled('second',true);
  runtime.reload('first');document.dispatchEvent(new Event('late-style'));
  const owners=[...document.head.querySelectorAll<HTMLElement>('[data-eidos-global-style]')].map(style=>style.dataset.eidosGlobalStyle);
  expect(owners).toEqual(['first','first','second']);
});

it('rejects asynchronous action hooks without leaking their rejected promises', async()=>{
 installGlobalPlugins([make('async-hook',`api.actions.beforeSubmit(async()=>{throw new Error('async failure')});`)]);setGlobalPluginEnabled('async-hook',true);
 expect(()=>runtime.transformAction('行动',false)).toThrow('须同步');
 await Promise.resolve();expect(runtime.getSnapshot()['async-hook'].state).toBe('error');
});
it('continues cleanup after one disposer throws and exposes the cleanup error',()=>{
 installGlobalPlugins([make('cleanup',`api.ui.addStyle('body{--cleanup:1}');api.onDispose(()=>{throw new Error('dispose failure')});`)]);setGlobalPluginEnabled('cleanup',true);setGlobalPluginEnabled('cleanup',false);
 expect(document.querySelector('[data-eidos-global-style="cleanup"]')).toBeNull();
 expect(runtime.getSnapshot().cleanup).toMatchObject({state:'disabled',error:expect.stringContaining('dispose failure')});
});
it('rejects an async module entry and cleans registrations made before its rejection',async()=>{
 installGlobalPlugins([make('async-module',`api.ui.addStyle('body{--async:1}');return Promise.reject(new Error('async entry'));`)]);setGlobalPluginEnabled('async-module',true);
 await Promise.resolve();expect(runtime.getSnapshot()['async-module'].state).toBe('error');
 expect(document.querySelector('[data-eidos-global-style="async-module"]')).toBeNull();
});
