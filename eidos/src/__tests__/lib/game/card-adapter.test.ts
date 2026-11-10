// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { selectCardContext } from '@/lib/game/cards/selection';
import { cardCompatibility } from '@/lib/game/cards/entries';
import { cardAdapterId, cardLedger, prepareCardVariableTransition, publicCardState } from '@/lib/game/cards/adapter';
import { normalizeGameplayModState } from '@/lib/game/plugins/mod-ui';
import { authorState } from '@/lib/game/plugins/workspace';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

const id = 'c'.repeat(64);
const document = () => ({ spec: 'chara_card_v2', data: { name: '门卫', description: '守住城门', extensions: { eidos: { publicVariables: ['Hero.Trust[0]'], variableBounds: { 'Hero.Trust[0]': { min: 0, max: 100 } } } }, character_book: { entries: [
  { comment: '[InitVar]', enabled: false, content: JSON.stringify({ Hero: { Trust: [20, '信任度'], secret: '密语' } }) },
  { constant: true, content: "<% if (getvar('stat_data.Hero.Trust[0]') >= 60) { %>允许通行<% } else { %>禁止通行<% } %>" },
] } } });
const card = () => { const originalBytes = new TextEncoder().encode(JSON.stringify(document())); return { ...parseCardBytes(originalBytes, 'gate.json'), id, originalBytes, filename: 'gate.json', createdAt: 1 }; };
const world = () => mountCardWorld({ asset: card(), role: 'world', world: buildRiftCityStartState().world });
const update = (revision = 0, oldValue: unknown = 20, newValue: unknown = 65) => [{ assetId: id, expectedRevision: revision, changes: [{ path: 'Hero.Trust[0]', oldValue, newValue }] }];
beforeEach(() => { useGameStore.setState(useGameStore.getInitialState()); });

it('installs an adapter and uses disabled JSON InitVar without putting it in lore', () => {
  const w = world(), state = normalizeGameplayModState(w);
  expect(cardCompatibility(card()).blocked).toEqual([]);
  expect(cardLedger(state, id)?.variables).toEqual({ Hero: { Trust: [20, '信任度'], secret: '密语' } });
  const result = selectCardContext({ assets: [card()], bindings: w.cardBindings!, query: '', sceneNpcs: [], playerName: '我', modState: state });
  expect(result.dynamicSuffix).toContain('禁止通行'); expect(result.stablePrefix).not.toContain('禁止通行');
  expect(result.dynamicSuffix).toContain('cardVariableUpdates');
  expect(result.selected.some(t => t.pointer.endsWith('/entries/0/content'))).toBe(false);
  expect(card().document).toEqual(document());
});
it('accepts a whole proposal on copied state and drives the next template view', () => {
  const w = world(), state = normalizeGameplayModState(w);
  const next = prepareCardVariableTransition({ world: w, state, updates: update(), mode: 'action' });
  expect(cardLedger(state, id)?.variables.Hero).toEqual({ Trust: [20, '信任度'], secret: '密语' });
  expect(cardLedger(next, id)?.revision).toBe(1);
  const text = selectCardContext({ assets: [card()], bindings: w.cardBindings!, query: '', sceneNpcs: [], playerName: '我', modState: next }).dynamicSuffix;
  expect(text).toContain('允许通行'); expect(text).not.toContain('禁止通行');
});
it('rejects stale, out of bounds, changed types, foreign paths and partial batches atomically', () => {
  const w = world(), state = normalizeGameplayModState(w);
  for (const updates of [update(1), update(0, 19), update(0, 20, 101), update(0, 20, '65'), [{ ...update()[0], changes: [...update()[0].changes, { path: 'Hero.unknown', oldValue: 0, newValue: 1 }] }], [{ ...update()[0], changes: [{ path: 'Hero.Trust[1]', oldValue: '信任度', newValue: '篡改说明' }] }]]) {
    expect(() => prepareCardVariableTransition({ world: w, state, updates, mode: 'action' })).toThrow();
    expect(cardLedger(state, id)?.revision).toBe(0);
  }
  const next = prepareCardVariableTransition({ world: w, state, updates: update(), mode: 'action' });
  expect(() => prepareCardVariableTransition({ world: w, state: next, updates: update(), mode: 'action' })).toThrow(/过期/);
});
it('does not settle rejected, introspective, cutaway or speculative responses', () => {
  const w = world(), state = normalizeGameplayModState(w);
  for (const mode of ['rejected', 'introspection', 'cutaway', 'speculation'] as const) expect(prepareCardVariableTransition({ world: w, state, updates: update(), mode })).toBe(state);
});
it('restores variables with existing snapshots and saves, without corrupting the initial ledger', () => {
  const w = world(); useGameStore.getState().setCurrentWorld(w);
  const initial = useGameStore.getState().createSnapshot();
  const next = prepareCardVariableTransition({ world: w, state: useGameStore.getState().gameplayModState, updates: update(), mode: 'action' });
  useGameStore.setState({ gameplayModState: next }); const saved = useGameStore.getState().serializeState();
  useGameStore.getState().restoreSnapshot(initial); expect(cardLedger(useGameStore.getState().gameplayModState, id)?.revision).toBe(0);
  useGameStore.getState().deserializeState(saved, w); expect(cardLedger(useGameStore.getState().gameplayModState, id)?.revision).toBe(1);
  expect(() => normalizeGameplayModState(w, { ...next, [cardAdapterId(id)]: { _eidosCard: { revision: -1, variables: {} } } })).toThrow();
});
it('projects only explicit public paths and protects the ledger against iframe writes', () => {
  const w = world(), state = normalizeGameplayModState(w), plugin = w.gameplayPlugins!.find(p => p.id === cardAdapterId(id))!;
  const projection = publicCardState(plugin, state[plugin.id]);
  expect(JSON.stringify(projection)).not.toContain('密语'); expect(JSON.stringify(projection)).toContain('20');
  const changed = authorState(state[plugin.id], { _eidosCard: { variables: {}, revision: 99 }, clicked: true });
  expect(changed._eidosCard).toEqual(state[plugin.id]._eidosCard); expect(changed.clicked).toBe(true);
  expect(plugin.ui?.html).toContain('Eidos.submit'); expect(plugin.ui?.reading).toBe('inherit');
});
it('keeps author workspace stages available while removing private ledger values', () => {
  const w = world(), state = normalizeGameplayModState(w), plugin = w.gameplayPlugins![0];
  state[plugin.id]._eidosWorkspace = { stages: [{ id: 'readout', html: 'public' }], files: {}, events: [] };
  expect(publicCardState(plugin, state[plugin.id])._eidosWorkspace).toEqual(state[plugin.id]._eidosWorkspace);
});
