// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { authorState } from '@/lib/game/plugins/workspace';
import { gameplayContextForModel, gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { commitGameplayOperation, commitGameplayRule } from '@/lib/game/plugins/gameplay-commit';
import { sourceManifest } from './source-package';
import { abortActiveStream } from '@/lib/game/stream-lifecycle';

const initial = useGameStore.getState(), manifest = sourceManifest('secrets-trial');
const html = readFileSync('mods/secrets-trial/index.html', 'utf8');
let unsubscribe: () => void = () => undefined;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); abortActiveStream();
  const { world, snapshot } = buildRiftCityStartState();
  const plugin = parseGameplayPlugins([{ ...manifest, ui: { ...manifest.ui, html } }])[0];
  useGameStore.setState({ ...initial, phase: 'playing', currentWorld: { ...world, gameplayPlugins: [plugin] }, currentPlaythroughId: crypto.randomUUID(),
    currentSceneId: snapshot.currentSceneId, history: [], gameplayModState: { [plugin.id]: plugin.ui!.initialState! }, worldFlags: {}, worldLine: null, currentNode: null, allNodes: {}, sandboxMode: false });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => { unsubscribe(); document.body.replaceChildren(); abortActiveStream(); vi.unstubAllGlobals(); });

it('plays a complete local case, restores the privacy fork and reaches either ending with shared facts', async () => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.append(document.importNode(parsed.querySelector('#mod-root')!, true));
  let listener: (value: unknown) => void = () => undefined;
  const publish = () => { const s = useGameStore.getState(); listener({ plugin: manifest, scope: s.currentNode?.id, state: s.gameplayModState[manifest.id], world: { name: s.currentWorld?.name, playerName: s.playerName, sceneName: '雾灯宿舍' }, reading: { loading: false, complete: true }, characters: [], clues: [], inventory: [] }); };
  const eidos = { onContext(fn: (value: unknown) => void) { listener = fn; },
    setState(state: Record<string, unknown>) { useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [manifest.id]: authorState(s.gameplayModState[manifest.id], state) } })); },
    submit() {}, advance() {}, gameplay: {
      perform: (ruleId: string, options: object) => commitGameplayRule(useGameStore, manifest.id, { ruleId, ...options }),
      commit: (operation: Record<string, unknown>) => commitGameplayOperation(useGameStore, manifest.id, { ...operation, id: crypto.randomUUID(), expectedRevision: gameplayLedger(useGameStore.getState().gameplayModState[manifest.id])?.revision ?? 0 }),
      narrate: async () => ({ queued: true }),
    } };
  (window as unknown as { Eidos: typeof eidos }).Eidos = eidos;
  new Function('window', 'document', parsed.querySelector('script')!.textContent!)(window, document);
  publish(); unsubscribe = useGameStore.subscribe(publish);
  const root = document.querySelector('#mod-root')!;
  const click = async (action: string, id?: string, committed = false) => {
    const count = useGameStore.getState().history.length;
    const button = root.querySelector<HTMLButtonElement>(`[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}`)!;
    expect(button).not.toBeNull(); button.click();
    if (committed) { await waitFor(() => expect(useGameStore.getState().history.length).toBe(count + 1)); await waitFor(() => expect(root.getAttribute('aria-busy')).toBe('false')); }
  };
  await click('inspect', 'wick-fiber', true);
  await click('testimony', 'maker-denial'); await click('present', 'wick-fiber', true);
  await click('inspect', 'bell-thread', true); await click('suspect', 'lampmaker', true);
  await click('screen', 'trial'); await click('convict', undefined, true);
  const privacyFork = useGameStore.getState().currentNode!.id;
  expect(gameplayContextForModel(useGameStore.getState().gameplayModState)[0].facts.verdict).toBe('resolved');
  await click('protect-secret', undefined, true);
  const anonymous = gameplayContextForModel(useGameStore.getState().gameplayModState)[0].facts;
  expect(anonymous.privacyChoice).toBe('anonymous'); expect(anonymous).not.toHaveProperty('quotedLetter');
  await useGameStore.getState().backtrackToNode(privacyFork);
  expect(root.textContent).not.toContain('你选择公开原句');
  await click('publish-secret', undefined, true);
  const quoted = gameplayContextForModel(useGameStore.getState().gameplayModState)[0].facts;
  expect(quoted.privacyChoice).toBe('quoted'); expect(quoted.quotedLetter).toContain('林杳');
});
