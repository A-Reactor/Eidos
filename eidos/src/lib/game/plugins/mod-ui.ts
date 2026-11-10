import { parseNarrativeRequest, narrativeInput, type NarrativeRequest } from '../narrative';
import type { WorldDefinition } from '../types';
import { parseGameplayPlugins, validateGameModeConfig } from './manifest';
import { PluginInputError, record } from './validation';
import { WORKSPACE_SDK } from './workspace-sdk';
import { THEME_SDK } from './theme-sdk';
import { validateWorkspace } from './workspace';
import { validateCardAdapterState } from '../cards/adapter';
import { gameplayLedger } from './gameplay-state';
import { isShortcutAction, type ShortcutAction } from '../keyboard-shortcuts';
import { KEYBOARD_SDK } from './keyboard-sdk';

export type GameplayModState = Record<string, Record<string, unknown>>;

/** Clone validated JSON so reading/backtracking never shares mutable author objects. */
export function normalizeGameplayModState(world: Pick<WorldDefinition, 'gameplayPlugins'>, value?: unknown): GameplayModState {
  const input = value === undefined ? {} : record(value);
  const plugins = parseGameplayPlugins(world.gameplayPlugins).filter(plugin => plugin.ui || plugin.rules.some(rule => rule.effects));
  if (Object.keys(input).some(id => !plugins.some(plugin => plugin.id === id))) throw new PluginInputError('模组状态引用未安装的界面模组');
  return Object.fromEntries(plugins.map(plugin => {
    const state = record(input[plugin.id] ?? plugin.ui?.initialState ?? {});
    validateWorkspace(state);
    validateCardAdapterState(plugin, state);
    gameplayLedger(state);
    return [plugin.id, JSON.parse(JSON.stringify(validateGameModeConfig(state)))];
  }));
}

type ModCommand = { command: 'rpc'; id: string; method: string; params: Record<string, unknown> } | { command: 'state'; state: Record<string, unknown> } | { command: 'advance' } | { command: 'shortcut'; action: ShortcutAction } | { command: 'release'; state?: Record<string, unknown> } | { command: 'submit'; action: string; narrativeRequest?: NarrativeRequest; state?: Record<string, unknown> } | { command: 'ready' | 'connect' | 'failed' };
export interface ModSession { token: string; scope: string; busy: boolean }

/** Frame identity is also checked by the view; this boundary checks branch and payload. */
export function acceptModCommand(input: unknown, session: ModSession): ModCommand | null {
  try {
    const message = record(input);
    if (message.channel !== 'eidos-mod' || message.token !== session.token) return null;
    if (message.command === 'connect' || message.command === 'failed') return { command: message.command };
    if (message.scope !== session.scope) return null;
    if (message.command === 'ready') return { command: 'ready' };
    if (message.command === 'rpc' && typeof message.id === 'string' && message.id.length <= 80 && typeof message.method === 'string' && message.method.length <= 80) {
      return { command: 'rpc', id: message.id, method: message.method, params: record(message.params ?? {}) };
    }
    if (message.command === 'advance') return { command: 'advance' };
    if (message.command === 'shortcut') return isShortcutAction(message.action) ? { command: 'shortcut', action: message.action } : null;
    const state = message.state === undefined ? undefined : JSON.parse(JSON.stringify(validateGameModeConfig(record(message.state))));
    if (message.command === 'state' && state) return { command: 'state', state };
    if (message.command === 'release') return { command: 'release', ...(state ? { state } : {}) };
    if (session.busy) return null;
    if (message.command === 'narrate') {
      const narrativeRequest = parseNarrativeRequest(message.request);
      if (!narrativeRequest) return null;
      return { command: 'submit', action: narrativeInput(narrativeRequest), narrativeRequest, ...(state ? { state } : {}) };
    }
    if (message.command === 'submit' && typeof message.action === 'string' && message.action.trim() && message.action.length <= 12_000) return { command: 'submit', action: message.action.trim(), ...(state ? { state } : {}) };
    return null;
  } catch { return null; }
}

/** The SDK is injected before author code. No storage, keys or host object are exposed. */
export function buildModDocument(html: string, token: string, offline = false): string {
  const encodedToken = JSON.stringify(token).replaceAll('<', '\\u003c');
  const sdk = `${offline ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'">` : ''}<script>
(() => {
 const token = ${encodedToken}; let context = null; let ready = false; let failed = false; const listeners = new Set();
 const send = (command, extra = {}) => parent.postMessage({ channel: 'eidos-mod', token, scope: context?.scope, command, ...extra }, '*');
 const fail = () => { failed = true; send('failed'); };
 ${WORKSPACE_SDK}
 ${THEME_SDK}
 ${KEYBOARD_SDK}
 const deliver = fn => {
  if (failed) return;
  try { fn(context); if (!ready) { ready = true; send('ready'); } } catch { fail(); }
 };
 window.Eidos = Object.freeze({
  ...workspaceApi,
  keyboard: keyboardApi,
  onContext(fn) { listeners.add(fn); if (context) deliver(fn); else send('connect'); return () => listeners.delete(fn); },
  setState(state) { send('state', {state}); },
  submit(action, state) { send('submit', {action, ...(state === undefined ? {} : {state})}); },
  narrate(request, state) { send('narrate', {request, ...(state === undefined ? {} : {state})}); },
  advance() { send('advance'); },
  release(state) { send('release', state === undefined ? {} : {state}); }
 });
 addEventListener('message', event => {
  if (event.source !== parent || event.data?.token !== token) return;
  if (event.data.channel === 'eidos-mod-host-ready') { if (listeners.size) send('connect'); return; }
  if (event.data.channel === 'eidos-mod-result') { rpcResult(event.data); return; }
  if (event.data.channel !== 'eidos-mod-context') return;
  context = event.data.context; applyTheme(context?.theme); deliverEvents(context); for (const fn of listeners) deliver(fn);
 });
 addEventListener('error', fail);
 addEventListener('unhandledrejection', fail);
})();
</script>`;
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, match => match + sdk)
    : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${sdk}${html}`;
}
