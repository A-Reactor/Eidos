// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import { authorState } from '@/lib/game/plugins/workspace';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';
import { workspaceOperation, withWorkspace } from '@/lib/game/plugins/workspace-operations';
import { workspaceOf } from '@/lib/game/plugins/workspace';
const initial = useGameStore.getState();
let unsubscribe: () => void = () => undefined;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); abortActiveStream(); });
afterEach(() => { unsubscribe(); document.body.replaceChildren(); vi.unstubAllGlobals(); abortActiveStream(); });

async function mount(name: string, reject = false) {
  const manifest = JSON.parse(readFileSync(`mods/${name}/manifest.json`, 'utf8'));
  const html = readFileSync(`mods/${name}/index.html`, 'utf8'), parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceChildren(document.importNode(parsed.body.querySelector('main')!, true));
  const { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...initial, currentWorld: { ...world, gameplayPlugins: parseGameplayPlugins([{ ...manifest, ui: { ...manifest.ui, html } }]) },
    currentPlaythroughId: crypto.randomUUID(), currentSceneId: snapshot.currentSceneId, history: [], gameplayModState: { [name]: manifest.ui.initialState }, worldLine: null, currentNode: null, allNodes: {}, sandboxMode: false });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  let listener: (context: unknown) => void = () => undefined;
  const narrations: string[] = [];
  const stageOperation = (method: string, params: Record<string, unknown> = {}) => workspaceOperation(method, params, {
    scope: 'fixture', mailbox: name, current: () => true, state: () => useGameStore.getState().gameplayModState[name],
    commit: workspace => useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [name]: withWorkspace(s.gameplayModState[name], workspace) } })),
  });
  const sdk = { onContext(fn: typeof listener) { listener = fn; }, onEvent() {}, capabilities: () => ({}),
    setState(state: Record<string, unknown>) { useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [name]: authorState(s.gameplayModState[name], state) } })); },
    submit() { throw new Error('must narrate the accepted result'); }, files: { write: async () => ({ id: 'log-file' }) },
    stages: { open: (params: Record<string, unknown>) => stageOperation('stages.open', params), update: (params: Record<string, unknown>) => stageOperation('stages.update', params), list: () => stageOperation('stages.list') },
    gameplay: { commit: (operation: Record<string, unknown>) => reject ? Promise.reject(new Error('版本已变化')) : commitGameplayOperation(useGameStore, name, { ...operation, id: crypto.randomUUID(), expectedRevision: gameplayLedger(useGameStore.getState().gameplayModState[name])?.revision ?? 0 }),
      narrate: async (id: string) => { narrations.push(id); return { queued: true }; } } };
  (window as unknown as { Eidos: typeof sdk }).Eidos = sdk;
  for (const script of parsed.querySelectorAll('script')) new Function('window', 'document', script.src ? readFileSync(`mods/${name}/logic.js`, 'utf8') : script.textContent!)(window, document);
  const publish = () => listener({ plugin: manifest, state: useGameStore.getState().gameplayModState[name], scope: useGameStore.getState().currentNode?.id, surface: { active: true }, settings: {}, reading: { complete: true, loading: false, segments: [] } });
  publish(); unsubscribe = useGameStore.subscribe(publish);
  return { narrations, click: (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click() };
}
it.each([['folded-desk', '[data-trade]', 'ticket']])('saves %s decisions as formal results and narrates them without resettling', async (name, selector, field) => {
  const app = await mount(name), root = useGameStore.getState().currentNode!.id;
  app.click(selector);
  await waitFor(() => expect(useGameStore.getState().history).toHaveLength(1));
  await waitFor(() => expect(gameplayLedger(useGameStore.getState().gameplayModState[name])?.revision).toBe(1));
  expect(useGameStore.getState().gameplayModState[name][field]).toBe(true);
  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-story]')!.disabled).toBe(false));
  app.click('[data-story]'); await waitFor(() => expect(app.narrations).toHaveLength(1));
  expect(useGameStore.getState().history).toHaveLength(1);
  await useGameStore.getState().backtrackToNode(root);
  expect(useGameStore.getState().gameplayModState[name][field]).not.toBe(true);
});
it.each([['folded-desk', '[data-trade]', 'ticket']])('does not advance %s when formal acceptance fails', async (name, selector, field) => {
  const app = await mount(name, true); app.click(selector);
  await waitFor(() => expect(document.body.textContent).toContain('版本已变化'));
  expect(useGameStore.getState().history).toEqual([]);
  expect(useGameStore.getState().gameplayModState[name][field]).not.toBe(true);
});
it.each([false, true])('shows a connected crossing only after the alignment decision is accepted (reject=%s)', async reject => {
  const app = await mount('folded-desk', reject);
  app.click('[data-fold]');
  await waitFor(() => expect(document.querySelector('[data-log]')!.textContent).toContain('两张岸的纸窗已展开'));
  app.click('[data-align]');
  await waitFor(() => expect(document.body.textContent).toContain(reject ? '版本已变化' : '两岸的纸窗已对齐'));
  // The store publishes acceptance before its async checkpoint reply; let the author finish rendering.
  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-story]')!.disabled).toBe(false));
  const state = useGameStore.getState().gameplayModState['folded-desk'], stages = workspaceOf(state).stages;
  expect(stages[0].x).toBe(stages[1].x); expect(stages[0].y).toBe(stages[1].y);
  expect(state.aligned === true).toBe(!reject);
  expect(document.querySelector('[data-fold-status]')!.textContent!.includes('渡口已经打开')).toBe(!reject);
  expect(useGameStore.getState().history).toHaveLength(reject ? 0 : 1);
});
it('accepts the selected bridge rule before using it for the next crossing', async () => {
  const app = await mount('folded-desk');
  document.querySelector<HTMLSelectElement>('[data-rule]')!.value = '桥只允许持票者';
  app.click('[data-rule-save]');
  await waitFor(() => expect(gameplayLedger(useGameStore.getState().gameplayModState['folded-desk'])?.revision).toBe(1));
  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-story]')!.disabled).toBe(false));
  expect(useGameStore.getState().gameplayModState['folded-desk'].rule).toBe('桥只允许持票者');
  app.click('[data-cross]');
  await waitFor(() => expect(gameplayLedger(useGameStore.getState().gameplayModState['folded-desk'])?.revision).toBe(2));
  await waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-story]')!.disabled).toBe(false));
  expect(useGameStore.getState().gameplayModState['folded-desk'].crossed).toBe(false);
});
