import { useGameStore } from '@/store/game-store';
import { record, pluginIdentifier } from '../plugins/validation';
import type { BeforeSubmitHook, GlobalPluginApi, GlobalPluginEntry } from './types';

/** Own resources explicitly: disabling a plugin must undo its host registrations. */
export class PluginResources {
  private cleanups = new Set<() => void>();
  readonly abort = new AbortController();
  private closed = false;
  constructor(private readonly failed: (error: unknown) => void) {}
  active() { if (this.closed) throw new Error('插件已停止'); }
  own(cleanup: () => void): () => void {
    this.active(); let released = false;
    const release = () => {
      if (released) return; released = true; this.cleanups.delete(release);
      const result = (cleanup as () => unknown)(); if (result instanceof Promise) void result.catch(this.failed);
    };
    this.cleanups.add(release); return release;
  }
  protect(callback: () => unknown) {
    if (this.closed) return;
    try { const result = callback(); if (result instanceof Promise) void result.catch(this.failed); }
    catch (error) { this.failed(error); }
  }
  dispose() {
    if (this.closed) return [];
    const errors: string[] = [];
    this.closed = true; this.abort.abort();
    // A broken cleanup must not prevent other registrations from being released.
    for (const release of [...this.cleanups].reverse()) { try { release(); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
    this.cleanups.clear(); return errors;
  }
}
function pluginStorage(id: string): GlobalPluginApi['storage'] {
  const storageKey = `eidos_global_plugin_data:${id}`;
  const read = () => record(JSON.parse(localStorage.getItem(storageKey) ?? '{}'));
  const check = (key: string) => { if (!pluginIdentifier(key)) throw new Error('插件私有存储键须为有效 ID'); };
  const write = (value: Record<string, unknown>) => {
    const source = JSON.stringify(value);
    if (new TextEncoder().encode(source).length > 256 * 1024) throw new Error('插件私有数据超过 256 KB，请导出大文件');
    localStorage.setItem(storageKey, source);
  };
  return {
    get: (key, fallback) => { check(key); const value = read(); return Object.hasOwn(value, key) ? value[key] : fallback; },
    set: (key, value) => { check(key); write({ ...read(), [key]: value }); },
    remove: key => { check(key); const value = read(); delete value[key]; write(value); },
  };
}
export function createGlobalPluginApi(entry: GlobalPluginEntry, resources: PluginResources, register: (hook: BeforeSubmitHook) => () => void, appendStyle: (style: HTMLStyleElement) => void): GlobalPluginApi {
  const own = (cleanup: () => void) => resources.own(cleanup), id = entry.plugin.id;
  return Object.freeze({
    version: 1 as const, plugin: Object.freeze({ ...entry.plugin }), preferences: Object.freeze({ ...entry.preferences }), signal: resources.abort.signal,
    game: {
      getState: () => useGameStore.getState(),
      setState: (state: Parameters<GlobalPluginApi['game']['setState']>[0]) => { resources.active(); useGameStore.setState(state); },
      subscribe: (listener: Parameters<GlobalPluginApi['game']['subscribe']>[0]) => { resources.active(); return own(useGameStore.subscribe((state, previous) => resources.protect(() => listener(state, previous)))); },
    },
    ui: {
      addStyle: (css: string) => {
        resources.active(); const style = document.createElement('style'); style.dataset.eidosGlobalStyle = id; style.textContent = css;
        appendStyle(style); return own(() => style.remove());
      },
      mount: (element: HTMLElement, target: Element | string = document.body) => {
        resources.active(); if (element.isConnected) throw new Error('请挂载新建的插件界面节点');
        const parent = typeof target === 'string' ? document.querySelector(target) : target;
        if (!parent) throw new Error('未找到插件挂载位置');
        const root = document.createElement('div'); root.dataset.eidosGlobalUi = id; root.appendChild(element); parent.appendChild(root);
        return own(() => root.remove());
      },
    },
    actions: { beforeSubmit: (hook: BeforeSubmitHook) => { resources.active(); return own(register(hook)); } },
    // Compatibility for old installed scripts; dubbing languages are now built in.
    voice: { registerJapaneseMaterial: () => { resources.active(); return () => {}; } },
    storage: pluginStorage(id),
    listen: (target: EventTarget, type: string, listener: (event: Event) => void) => {
      resources.active(); const protectedListener = (event: Event) => resources.protect(() => listener(event));
      target.addEventListener(type, protectedListener); return own(() => target.removeEventListener(type, protectedListener));
    },
    setTimeout: (callback: () => void, ms: number) => {
      resources.active(); const timer = window.setTimeout(() => { release(); resources.protect(callback); }, ms);
      const release = own(() => window.clearTimeout(timer)); return release;
    },
    setInterval: (callback: () => void, ms: number) => { resources.active(); const timer = window.setInterval(() => resources.protect(callback), ms); return own(() => window.clearInterval(timer)); },
    onDispose: own,
  });
}
