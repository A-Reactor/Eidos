import { describe, expect, it } from 'vitest';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { buildGameplayRuntimePrompt, buildGameplayStaticPrompt, evaluateGameplayEvents, normalizeGameplayResources } from '@/lib/game/plugins/runtime';
import { event, resourcePluginDraft as draft, resourceWorld } from './gameplay-resource-fixtures';

describe('v2 numeric resource declarations', () => {
  it('accepts resource-only rules and normalizes bounded resources', () => {
    const p = parseGameplayPlugins([draft])[0];
    expect(p.version).toBe(2);
    expect(p.resources?.stamina).toEqual({ name: '体力', initial: 3, min: 0, max: 5, unit: '点', visible: true });
    expect(p.rules[1]).toMatchObject({ requires: {}, sets: {}, once: false, resourceChanges: { food: -1, stamina: 2 } });
  });
  it('keeps v1 semantics and rejects numeric fields in v1', () => {
    const v1 = { ...draft, version: 1, resources: undefined, rules: [{ id: 'find', description: '找到', sets: { found: true } }] };
    delete v1.resources;
    expect(parseGameplayPlugins([v1])[0]).not.toHaveProperty('resources');
    expect(() => parseGameplayPlugins([{ ...v1, resources: draft.resources }])).toThrow();
    expect(() => parseGameplayPlugins([{ ...v1, rules: [{ ...v1.rules[0], resourceChanges: { food: 1 } }] }])).toThrow();
  });
  it.each([
    { initial: 6 }, { min: 4 }, { max: -1 }, { initial: 1.1 }, { max: Infinity }, { min: -1_000_001 }, { initial: '3' }, { visible: 'false' }, { execute: 'alert()' },
  ])('rejects invalid resource declaration %j', invalid => {
    expect(() => parseGameplayPlugins([{ ...draft, resources: { ...draft.resources, stamina: { ...draft.resources.stamina, ...invalid } } }])).toThrow();
  });
  it.each([
    { resourceChanges: { unknown: 1 } }, { resourceChanges: { stamina: 0 } }, { resourceChanges: { stamina: 0.1 } },
    { resourceChanges: { stamina: 1_000_001 } }, { resourceChanges: { stamina: NaN } },
    { resourceRequires: { unknown: { min: 0 } } }, { resourceRequires: { stamina: { min: 4, max: 1 } } },
    { resourceRequires: { stamina: {} } }, { resourceRequires: { stamina: { equals: 1 } } },
    { resourceChanges: {}, sets: {} },
  ])('rejects unknown references and invalid rule arithmetic %j', invalid => {
    expect(() => parseGameplayPlugins([{ ...draft, rules: [{ id: 'invalid', description: '无效', ...invalid }] }])).toThrow();
  });
  it('rejects unsafe identifiers, too many resources and unknown resource fields', () => {
    expect(() => parseGameplayPlugins([{ ...draft, resources: JSON.parse('{"__proto__":{"name":"x","initial":0,"min":0,"max":1}}') }])).toThrow();
    const resources = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`r${i}`, draft.resources.stamina]));
    expect(() => parseGameplayPlugins([{ ...draft, resources }])).toThrow();
  });
});

describe('deterministic atomic gameplay settlement', () => {
  it('initializes missing state and preserves zero and negative values', () => {
    expect(normalizeGameplayResources(resourceWorld())).toEqual({ 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 });
    expect(normalizeGameplayResources(resourceWorld(), { 'gameplay.supplies.stamina': 0 })['gameplay.supplies.stamina']).toBe(0);
    const signed = { gameplayPlugins: parseGameplayPlugins([{ ...draft, resources: { balance: { name: '债务', min: -5, max: 5, initial: -1 } }, rules: [] }]) };
    expect(normalizeGameplayResources(signed, { 'gameplay.supplies.balance': -3 })).toEqual({ 'gameplay.supplies.balance': -3 });
  });
  it.each([null, [], { 'gameplay.other.stamina': 3 }, { 'gameplay.supplies.stamina': -1 }, { 'gameplay.supplies.stamina': 0.5 }, { 'gameplay.supplies.stamina': NaN }, { 'gameplay.supplies.stamina': '1' }])('rejects corrupted or foreign numeric state %j', input => {
    expect(() => normalizeGameplayResources(resourceWorld(), input)).toThrow();
  });
  it('settles fixed deltas and ordered dependent events without changing input', () => {
    const flags = {}, resources = { 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 1, 'gameplay.supplies.secret': 0 };
    const result = evaluateGameplayEvents(resourceWorld(), flags, resources, [event('explore'), event('open'), event('eat')]);
    expect(result.resources).toEqual({ 'gameplay.supplies.stamina': 3, 'gameplay.supplies.food': 0, 'gameplay.supplies.secret': 0 });
    expect(result.flags).toMatchObject({ 'gameplay.supplies.explored': true, 'gameplay.supplies.open': true, 'gameplay.supplies.done:open': true });
    expect(resources['gameplay.supplies.food']).toBe(1);
    expect(flags).toEqual({});
  });
  it('rejects the whole batch if a later event fails', () => {
    const flags = {}, resources = { 'gameplay.supplies.stamina': 0, 'gameplay.supplies.food': 0 };
    expect(() => evaluateGameplayEvents(resourceWorld(), flags, resources, [event('find-food'), event('explore')])).toThrow();
    expect(flags).toEqual({});
    expect(resources).toEqual({ 'gameplay.supplies.stamina': 0, 'gameplay.supplies.food': 0 });
  });
  it('rejects overflow instead of clamping or allowing free effects', () => {
    expect(() => evaluateGameplayEvents(resourceWorld(), {}, { 'gameplay.supplies.food': 5 }, [event('find-food')])).toThrow();
    expect(() => evaluateGameplayEvents(resourceWorld(), {}, { 'gameplay.supplies.stamina': 5 }, [event('eat')])).toThrow();
  });
  it('ignores duplicate batch events and persisted once-only events but repeats ordinary rules in later actions', () => {
    const first = evaluateGameplayEvents(resourceWorld(), {}, undefined, [event('find-food'), event('find-food'), event('explore'), event('explore')]);
    expect(first.resources).toMatchObject({ 'gameplay.supplies.stamina': 1, 'gameplay.supplies.food': 2 });
    const repeated = evaluateGameplayEvents(resourceWorld(), first.flags, first.resources, [event('find-food')]);
    expect(repeated.resources['gameplay.supplies.food']).toBe(2);
    const replenished = evaluateGameplayEvents(resourceWorld(), first.flags, first.resources, [event('eat')]);
    expect(evaluateGameplayEvents(resourceWorld(), { ...first.flags, ...replenished.flags }, replenished.resources, [event('explore')]).resources['gameplay.supplies.stamina']).toBe(1);
    expect(evaluateGameplayEvents(resourceWorld(), {}, undefined, [event('find-food')]).resources['gameplay.supplies.food']).toBe(2);
  });
  it.each([[{ ...event('explore'), amount: 100 }], [[event('explore')]], [event('unknown')], 'explore'])('rejects malformed events and arbitrary model amounts %j', events => {
    expect(() => evaluateGameplayEvents(resourceWorld(), {}, undefined, events)).toThrow();
  });
  it('keeps identically named resources in separate plugin namespaces', () => {
    const world = { gameplayPlugins: parseGameplayPlugins([draft, { ...draft, id: 'other' }]) };
    expect(evaluateGameplayEvents(world, {}, undefined, [event('explore')]).resources).toMatchObject({ 'gameplay.supplies.stamina': 1, 'gameplay.other.stamina': 3 });
  });
  it('places declarations in the stable prefix and current values only in the dynamic suffix', () => {
    const staticPrompt = buildGameplayStaticPrompt(resourceWorld(), 'action');
    expect(staticPrompt).toContain('resourceChanges');
    expect(staticPrompt).toContain('"initial":3');
    expect(buildGameplayRuntimePrompt(resourceWorld(), {}, { 'gameplay.supplies.stamina': 0 })).toContain('"gameplay.supplies.stamina":0');
    expect(buildGameplayStaticPrompt(resourceWorld(), 'action')).toBe(staticPrompt);
  });
});
