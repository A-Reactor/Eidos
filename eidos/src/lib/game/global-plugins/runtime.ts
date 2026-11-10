import { useGameStore } from '@/store/game-store';
import { getGlobalPluginLibrary, subscribeGlobalPlugins } from './library';
import { createGlobalPluginApi, PluginResources } from './sdk';
import type { BeforeSubmitHook, GlobalPluginApi, GlobalPluginEntry, GlobalPluginStatuses } from './types';

type Mount = (api: GlobalPluginApi) => unknown;
interface ActivePlugin { resources: PluginResources; hooks: Set<BeforeSubmitHook> }
const SERVER_STATUS: GlobalPluginStatuses = {};
export const getServerGlobalPluginStatuses = () => SERVER_STATUS;

/** Global developer scripts are trusted host extensions, not world sandbox documents. */
export class GlobalPluginRuntime {
  private active = new Map<string, ActivePlugin>();
  private signatures = new Map<string, string>();
  private status: GlobalPluginStatuses = SERVER_STATUS;
  private listeners = new Set<() => void>();
  private users = 0;
  private unsubscribe: (() => void) | undefined;
  private order: string[] = [];
  getSnapshot = () => this.status;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(id: string, value: GlobalPluginStatuses[string]) {
    if (JSON.stringify(this.status[id]) === JSON.stringify(value)) return;
    this.status = { ...this.status, [id]: value }; this.listeners.forEach(listener => listener());
  }
  start(): () => void {
    this.users++;
    if (this.users === 1) { this.unsubscribe = subscribeGlobalPlugins(() => this.reconcile()); this.reconcile(); }
    let stopped = false;
    return () => {
      if (stopped) return; stopped = true;
      if (--this.users) return;
      this.unsubscribe?.(); this.unsubscribe = undefined;
      for (const id of [...this.active.keys()]) this.unmount(id);
      this.signatures.clear(); this.order = []; this.status = SERVER_STATUS; this.listeners.forEach(listener => listener());
    };
  }
  private unmount(id: string) {
    const plugin = this.active.get(id); this.active.delete(id);
    const errors = plugin?.resources.dispose() ?? [];
    return errors.length ? `插件清理失败：${errors.join('；')}` : undefined;
  }
  private fail(id: string, error: unknown) {
    if (!this.active.has(id)) return;
    const cleanupError = this.unmount(id);
    this.update(id, { state: 'error', error: [error instanceof Error ? error.message : String(error), cleanupError].filter(Boolean).join('；') });
  }
  private mount(entry: GlobalPluginEntry, cleanupError?: string) {
    const id = entry.plugin.id;
    const resources = new PluginResources(error => this.fail(id, error)), hooks = new Set<BeforeSubmitHook>();
    this.active.set(id, { resources, hooks });
    const api = createGlobalPluginApi(entry, resources, hook => { if (typeof hook !== 'function') throw new Error('行动钩子必须是函数'); hooks.add(hook); return () => { hooks.delete(hook); }; }, style => {
      const index = this.order.indexOf(id);
      const next = [...document.head.querySelectorAll<HTMLStyleElement>('[data-eidos-global-style]')].find(node => this.order.indexOf(node.dataset.eidosGlobalStyle ?? '') > index);
      document.head.insertBefore(style, next ?? null);
    });
    try {
      if (entry.plugin.css) api.ui.addStyle(entry.plugin.css);
      if (entry.plugin.script) {
        // Only explicitly enabled developer packages reach this host-level execution path.
        const mount = new Function('api', '"use strict";\n' + entry.plugin.script) as Mount;
        const cleanup = mount(api);
        if (typeof cleanup === 'function') resources.own(() => { cleanup(); });
        else if (cleanup !== undefined) {
          if (cleanup instanceof Promise) void cleanup.catch(error => this.fail(id, error));
          throw new Error('插件入口须同步执行，并可返回清理函数；异步工作请监听 api.signal');
        }
      }
      if (this.active.has(id)) this.update(id, { state: 'running', ...(cleanupError ? { error: cleanupError } : {}) });
    } catch (error) { this.fail(id, error); }
  }
  private reconcile() {
    const library = getGlobalPluginLibrary(), installed = new Set(library.entries.map(entry => entry.plugin.id));
    this.order = library.entries.map(entry => entry.plugin.id);
    for (const id of [...this.signatures.keys()]) if (!installed.has(id)) { this.unmount(id); this.signatures.delete(id); }
    for (const entry of library.entries) {
      const id = entry.plugin.id, signature = JSON.stringify({ ...entry, plugin: { ...entry.plugin, introduction: undefined } });
      if (this.signatures.get(id) === signature) continue;
      const cleanupError = this.unmount(id); this.signatures.set(id, signature);
      if (entry.enabled) this.mount(entry, cleanupError); else this.update(id, { state: 'disabled', ...(cleanupError ? { error: cleanupError } : {}) });
    }
    // Reordering the installed list must also reorder CSS, without restarting unchanged code.
    for (const id of this.order) for (const style of document.head.querySelectorAll<HTMLStyleElement>('[data-eidos-global-style]')) {
      if (style.dataset.eidosGlobalStyle === id) document.head.appendChild(style);
    }
    if (Object.keys(this.status).some(id => !installed.has(id))) {
      this.status = Object.fromEntries(Object.entries(this.status).filter(([id]) => installed.has(id))); this.listeners.forEach(listener => listener());
    }
  }
  reload(id: string) { this.signatures.delete(id); this.reconcile(); }
  transformAction(input: string, fromMap: boolean): string | null {
    const state = useGameStore.getState();
    const context = { worldId: state.currentWorld?.id ?? null, playthroughId: state.currentPlaythroughId, nodeId: state.currentNode?.id ?? null, fromMap };
    let current = input;
    for (const id of this.order) {
      const plugin = this.active.get(id); if (!plugin) continue;
      for (const hook of [...plugin.hooks]) {
        try {
          const result: unknown = hook(current, context);
          if (result instanceof Promise) { void result.catch(error => this.fail(id, error)); throw new Error('行动钩子须同步返回结果'); }
          if (result === undefined) continue;
          if (typeof result === 'string') { current = result.trim(); if (!current) return null; }
          else if (result && typeof result === 'object' && 'cancel' in result && result.cancel === true) return null;
          else throw new Error('行动钩子须返回文字、取消标记或 undefined');
        } catch (error) {
          this.fail(id, error);
          throw new Error(`${getGlobalPluginLibrary().entries.find(entry => entry.plugin.id === id)?.plugin.name ?? id}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return current;
  }
}
export const globalPluginRuntime = new GlobalPluginRuntime();
