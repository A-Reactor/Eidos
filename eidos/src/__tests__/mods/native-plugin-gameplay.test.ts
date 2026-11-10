// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { loadModPackage } from '../../../scripts/mod-package.mjs';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { nativeGameplayActions } from '@/lib/game/plugins/native-actions';
import { commitGameplayRule } from '@/lib/game/plugins/gameplay-commit';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { useGameStore } from '@/store/game-store';
import { loadBlob } from '@/lib/game/cas-storage';
import { nativeReadingActions } from '@/lib/game/plugins/native-reading';
import { protectNarrativeResponse } from '@/lib/game/narrative';
import type { AIGameResponse } from '@/lib/ai/types';
import { evaluateGameplayEvents } from '@/lib/game/plugins/runtime';
import { applyGameplayRuleEffects } from '@/lib/game/plugins/rule-effects';
import { migratePluginProgress } from '@/lib/game/plugins/upgrade-progress';
interface PostalStory { passages: Record<string, { segments: unknown }> }
interface TestimonyCase { testimony: Array<{ original: string }> }

afterEach(() => vi.unstubAllGlobals());
async function boot(name: string) {
  vi.stubGlobal('crypto', webcrypto);
  const plugin = parsePluginFile(await loadModPackage('mods/' + name))[0], { world, snapshot } = buildRiftCityStartState();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: [plugin] }, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot({ ...snapshot, gameplayModState: undefined });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
  return plugin;
}
async function choose(ruleId: string) {
  const action = nativeGameplayActions(useGameStore.getState()).find(a => a.ruleId === ruleId);
  expect(action, ruleId).toBeDefined();
  return commitGameplayRule(useGameStore, action!.pluginId, { ruleId, narrate: false });
}
it('keeps exact author prose and mutually exclusive postal decisions through save and rewind', async () => {
  const plugin = await boot('last-post'), network = vi.fn(); vi.stubGlobal('fetch', network);
  expect(nativeGameplayActions(useGameStore.getState()).map(a => a.ruleId)).toEqual(['n-begin']);
  await choose('n-begin'); const arrival = useGameStore.getState().currentNode!.id;
  expect(useGameStore.getState().savedSegments).toEqual((plugin.data!.story as unknown as PostalStory).passages.arrival.segments);
  await choose('n-inspect'); await choose('n-send');
  expect(nativeGameplayActions(useGameStore.getState())).toEqual([]);
  expect(gameplayLedger(useGameStore.getState().gameplayModState[plugin.id])?.facts.decision).toBe('send');
  expect(await loadBlob(useGameStore.getState().currentNode!.segmentHash!)).toEqual((plugin.data!.story as unknown as PostalStory).passages.send.segments);
  await useGameStore.getState().backtrackToNode(arrival); await choose('n-hold');
  expect(gameplayLedger(useGameStore.getState().gameplayModState[plugin.id])?.facts.decision).toBe('hold');
  expect(useGameStore.getState().currentNode!.playerInput).toBe('暂时保留原信'); expect(network).not.toHaveBeenCalled();
});
it('requires an actual discovered clue and revised statement, keeping wrong evidence available', async () => {
  const plugin = await boot('cross-examination'); await choose('n-start');
  await expect(commitGameplayRule(useGameStore, plugin.id, { ruleId: 'n-check-0-breaker-card-present' })).rejects.toThrow(/前提/);
  await choose('n-find-breaker-card'); await choose('n-find-salted-key');
  expect(nativeGameplayActions(useGameStore.getState()).some(a => a.ruleId.startsWith('n-check-'))).toBe(false);
  await choose('n-press-0'); const before = useGameStore.getState().currentNode!.id;
  expect(nativeGameplayActions(useGameStore.getState()).filter(a => a.ruleId.startsWith('n-check-')).map(a => a.ruleId)).toContain('n-check-0-salted-key-present');
  await choose('n-check-0-salted-key-present');
  expect(useGameStore.getState().worldFlags['gameplay.' + plugin.id + '.n-done-0']).not.toBe(true);
  await choose('n-check-0-breaker-card-present');
  expect(useGameStore.getState().savedSegments.at(-1)?.text).toBe((plugin.data!.case as unknown as TestimonyCase).testimony[1].original);
  await useGameStore.getState().backtrackToNode(before);
  expect(useGameStore.getState().worldFlags['gameplay.' + plugin.id + '.n-done-0']).not.toBe(true);
});
it('checks debate evidence and relation deterministically in the native flow', async () => {
  const plugin = await boot('debate-room'); await choose('n-start'); await choose('n-find-bell-ledger');
  await choose('n-check-0-bell-ledger-support');
  expect(useGameStore.getState().worldFlags['gameplay.' + plugin.id + '.n-done-0']).not.toBe(true);
  await choose('n-check-0-bell-ledger-rebut'); await choose('n-find-handover-slip'); await choose('n-check-1-handover-slip-support');
  expect(gameplayLedger(useGameStore.getState().gameplayModState[plugin.id])?.facts.completed).toBe(true);
});
it('offers symmetric accusations only after a complete evidence chain and keeps protected letter content private', async () => {
  const plugin = await boot('secrets-trial'); await choose('n-start');
  expect(nativeGameplayActions(useGameStore.getState()).some(a => a.ruleId.startsWith('n-verdict-'))).toBe(false);
  await choose('discover-wick-fiber'); await choose('discover-bell-thread'); await choose('n-hear-maker-denial'); await choose('n-check-maker-denial-wick-fiber');
  expect(nativeGameplayActions(useGameStore.getState()).filter(a => a.ruleId.startsWith('n-verdict-'))).toHaveLength(3);
  await choose('n-verdict-keeper');
  expect(gameplayLedger(useGameStore.getState().gameplayModState[plugin.id])?.facts.verdict).toBeUndefined();
  await choose('n-verdict-lampmaker'); await choose('n-privacy-protect');
  const facts = gameplayLedger(useGameStore.getState().gameplayModState[plugin.id])!.facts;
  expect(facts.verdict).toBe('guilty'); expect(facts.disclosedLetter).toBeUndefined(); expect(facts.privacyChoice).toBe('protect');
});
it('all distributed packages declare intentional player presentation, including alternate cases', async () => {
  for (const name of ['continuous-novel', 'last-post', 'cross-examination', 'debate-room', 'secrets-trial', 'social-minds']) {
    expect(parsePluginFile(await loadModPackage('mods/' + name))[0].ui?.presentation).toBe('native');
  }
  for (const content of ['cases/station-clock.json', 'cases/harbor-hearing.json']) expect(parsePluginFile(await loadModPackage('mods/cross-examination', { content }))[0].ui?.presentation).toBe('native');
  expect(parsePluginFile(await loadModPackage('mods/folded-desk'))[0].ui?.presentation).toBe('tool');
  expect(parsePluginFile(await loadModPackage('mods/chinese-room'))[0].ui?.presentation).toBe('scene-map');
});
it('uses the same canonical discovery for free-input model events and native evidence checks', async () => {
  const plugin = await boot('secrets-trial');
  const live = useGameStore.getState(), events = [{ pluginId: plugin.id, ruleId: 'discover-wick-fiber' }];
  const transition = evaluateGameplayEvents(live.currentWorld!, live.worldFlags, live.gameplayResources, events);
  const state = applyGameplayRuleEffects({ world: live.currentWorld!, state: live.gameplayModState, flags: live.worldFlags, events, receiptId: 'free-input-discovery', createdAt: Date.now(), sceneId: live.currentSceneId });
  useGameStore.setState({ worldFlags: { ...live.worldFlags, ...transition.flags }, gameplayResources: transition.resources, gameplayModState: state });
  expect(useGameStore.getState().gameplayModState[plugin.id].foundClues).toContain('wick-fiber');
  expect(nativeGameplayActions(useGameStore.getState()).some(a => a.ruleId === 'discover-wick-fiber')).toBe(false);
  await choose('n-hear-maker-denial');
  expect(nativeGameplayActions(useGameStore.getState()).some(a => a.ruleId === 'n-check-maker-denial-wick-fiber')).toBe(true);
});
it('upgrades a completed old postal branch without reopening or changing its accepted decision', async () => {
  const target = await boot('last-post'), current = useGameStore.getState();
  const old = structuredClone(target); old.release = '0.1.0'; delete old.ui!.presentation; delete old.ui!.actions; old.rules = [];
  const state = { started: true, examined: true, resolution: 'hold', _eidosGameplay: { revision: 1, facts: { decision: 'hold' }, last: { id: 'old-choice', revision: 1, summary: '保留原信', createdAt: 1, narration: 'complete' } } };
  const upgraded = migratePluginProgress({ ...current, currentWorld: { ...current.currentWorld!, gameplayPlugins: [old] }, gameplayModState: { [old.id]: state } }, target);
  expect(upgraded.pluginState).toEqual(state);
  expect(nativeGameplayActions({ ...current, currentWorld: upgraded.world, gameplayModState: { [old.id]: upgraded.pluginState }, worldFlags: upgraded.flags })).toEqual([]);
  expect(upgraded.flags['gameplay.' + old.id + '.n-resolved']).toBe(true);
});
it('keeps native cutaway choices as actor decisions and preserves the protagonist knowledge boundary', () => {
  const segments = [{ type: 'narration' as const, text: '她独自拿起信。', view: { kind: 'cutaway' as const, actor: '白槿', location: '车厢' }, choices: [{ id: 'send', label: '将信转寄' }] }];
  const actions = nativeReadingActions(segments);
  expect(actions.map(a => a.label)).toEqual(['将信转寄', '回到主角']);
  expect(actions[0].request).toMatchObject({ kind: 'choice', frame: { actor: '白槿' } });
  const time = { day: 1, hour: 8, minute: 0 };
  const response = protectNarrativeResponse({ segments, sceneChanges: [{ field: 'currentScene', value: '车厢' }], itemsGained: [{ name: '陌生信件', quantity: 1 }] } as unknown as AIGameResponse, time, actions[0].request);
  expect(response.sceneChanges).toEqual([]); expect(response.itemsGained).toEqual([]); expect(response.timeAfter).toEqual(time);
  expect(nativeReadingActions([{ type: 'narration', text: '结束。', beat: { boundary: 'ending' } }])[0]).toMatchObject({ label: '继续故事', request: { kind: 'continue' } });
});
