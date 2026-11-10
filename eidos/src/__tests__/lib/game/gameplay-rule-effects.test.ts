import { expect, it } from 'vitest';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { applyGameplayRuleEffects } from '@/lib/game/plugins/rule-effects';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';

const draft = { format: 'eidos-gameplay-plugin', version: 1, id: 'case', name: '调查', description: '测试', tags: [], prompts: { creation: '', action: '', review: '' },
  ui: { html: '<p>case</p>', reading: 'inherit', initialState: { found: [], phase: 'open' } },
  rules: [{ id: 'inspect', description: '检查后发现灯芯', sets: { wick: true }, effects: {
    state: [{ op: 'test', path: '/phase', value: 'open' }, { op: 'add', path: '/found/-', value: 'wick' }],
    facts: [{ op: 'add', path: '/wick', value: '灯芯有指纹' }] } }] };
const args = () => ({ world: { gameplayPlugins: parseGameplayPlugins([draft]) }, state: {}, flags: {}, events: [{ pluginId: 'case', ruleId: 'inspect' }], receiptId: 'turn-one', createdAt: 1, sceneId: 'room' });

it('accepts declared rule effects and exposes the same discovery to author UI and model facts', () => {
  const next = applyGameplayRuleEffects(args());
  expect(next.case.found).toEqual(['wick']);
  expect(gameplayLedger(next.case)).toMatchObject({ revision: 1, facts: { wick: '灯芯有指纹' }, last: { narration: 'complete' } });
});
it('skips repeated once rules and repeated events without incrementing progress twice', () => {
  const input = args();
  const first = applyGameplayRuleEffects({ ...input, events: [...input.events, ...input.events] });
  expect(first.case.found).toEqual(['wick']);
  const repeated = applyGameplayRuleEffects({ ...input, state: first, flags: { 'gameplay.case.done:inspect': true } });
  expect(repeated).toBe(first);
});
it('rejects a failing author condition without changing existing progress or workspace', () => {
  const input = args(), state = { case: { found: [], phase: 'closed', _eidosWorkspace: { files: {} } } };
  expect(() => applyGameplayRuleEffects({ ...input, state })).toThrow(/条件/);
  expect(state).toEqual({ case: { found: [], phase: 'closed', _eidosWorkspace: { files: {} } } });
});
it.each(['/_eidosGameplay/revision', '/_eidosWorkspace/files', '/nested/__proto__/polluted', '/constructor', '/bad~2escape'])('rejects protected or ambiguous author patch path %s at import', path => {
  expect(() => parseGameplayPlugins([{ ...draft, rules: [{ ...draft.rules[0], effects: { state: [{ op: 'add', path, value: true }] } }] }])).toThrow();
});
it('supports an escaped JSON key and a rule with only author-state effects', () => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, rules: [{ id: 'inspect', description: '发现', effects: { state: [{ op: 'add', path: '/a~1b', value: '原文' }] } }] }]);
  expect(applyGameplayRuleEffects(input).case['a/b']).toBe('原文');
});
it('initializes the author state in the same event that activates a dormant stage', () => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, activation: { requires: { hearing: true } }, rules: [{ ...draft.rules[0], sets: { hearing: true } }] }]);
  expect(applyGameplayRuleEffects(input).case.found).toEqual(['wick']);
});
it.each(['01', '1e0', ' '])('rejects ambiguous intermediate array index %s without mutating author state', index => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, rules: [{ id: 'inspect', description: '发现', effects: { state: [{ op: 'replace', path: `/items/${index}/value`, value: 9 }] } }] }]);
  const state = { case: { items: [{ value: 1 }, { value: 2 }] } };
  expect(() => applyGameplayRuleEffects({ ...input, state })).toThrow(/位置/);
  expect(state.case.items[1].value).toBe(2);
});
it('keeps literal whitespace in object keys instead of changing the author pointer', () => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, rules: [{ id: 'inspect', description: '发现', effects: { state: [{ op: 'add', path: '/name ', value: '尾部空格' }] } }] }]);
  expect(applyGameplayRuleEffects(input).case['name ']).toBe('尾部空格');
});
it('rejects an array masquerading as an operation name', () => {
  expect(() => parseGameplayPlugins([{ ...draft, rules: [{ ...draft.rules[0], effects: { state: [{ op: ['add'], path: '/found', value: [] }] } }] }])).toThrow();
});
it('preserves the complete result when its receipt and facts cross the former state limit', () => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, rules: [{ id: 'inspect', description: '发现', effects: { facts: [{ op: 'add', path: '/description', value: 'x'.repeat(8000) }] } }] }]);
  const state = { case: { payload: 'x'.repeat(510_000) } };
  const next = applyGameplayRuleEffects({ ...input, state });
  expect(next.case.payload).toBe(state.case.payload);
  expect(gameplayLedger(next.case)?.facts.description).toBe('x'.repeat(8000));
  expect(state.case).not.toHaveProperty('_eidosGameplay');
});
it('moves and copies authored JSON values without aliasing or touching protected sources', () => {
  const input = args();
  input.world.gameplayPlugins = parseGameplayPlugins([{ ...draft, rules: [{ id: 'inspect', description: '整理', effects: { state: [
    { op: 'copy', from: '/found', path: '/backup' }, { op: 'move', from: '/phase', path: '/status' }, { op: 'add', path: '/found/-', value: 'wick' },
  ] } }] }]);
  const next = applyGameplayRuleEffects(input).case;
  expect(next.backup).toEqual([]); expect(next.found).toEqual(['wick']); expect(next.status).toBe('open'); expect(next.phase).toBeUndefined();
  expect(() => parseGameplayPlugins([{ ...draft, rules: [{ ...draft.rules[0], effects: { state: [{ op: 'copy', from: '/_eidosWorkspace', path: '/leak' }] } }] }])).toThrow();
});
it('accepts optional author release and versioned migration declarations without confusing the wire-format version', () => {
  const [plugin] = parseGameplayPlugins([{ ...draft, release: '2.0', stateVersion: 2, migrations: [{ from: 1, to: 2, patches: [
    { op: 'move', from: '/state/found', path: '/state/evidence' },
  ] }] }]);
  expect(plugin.version).toBe(1); expect(plugin.stateVersion).toBe(2); expect(plugin.migrations?.[0].from).toBe(1);
});
