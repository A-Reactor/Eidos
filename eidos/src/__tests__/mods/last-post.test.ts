// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import { loadBlob } from '@/lib/game/cas-storage';
import { gameplayLedger } from '@/lib/game/plugins/gameplay-state';
const root = path.resolve('mods/last-post');
const logic = () => { const context = vm.createContext({}); vm.runInContext(readFileSync(path.join(root, 'logic.js'), 'utf8'), context); return context.LastPost; };
const manifest = () => JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const story = () => JSON.parse(readFileSync(path.join(root, 'story.json'), 'utf8')).data.story;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); const { world, snapshot } = buildRiftCityStartState(), plugin = manifest();
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: parsePluginFile({ ...plugin, data: { story: story() }, ui: { ...plugin.ui, html: '<main>最后一班邮车</main>' } }) }, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot({ ...snapshot, gameplayModState: undefined });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
});
afterEach(() => vi.unstubAllGlobals());
async function choose(action: string) {
  const current = useGameStore.getState().gameplayModState['last-post'];
  const operation = logic().decide(story(), current, action);
  return commitGameplayOperation(useGameStore, 'last-post', { ...operation, id: crypto.randomUUID(), expectedRevision: gameplayLedger(current)?.revision ?? 0 });
}
it('plays authored investigation and two decisions on separate branches with exact prose and no model', async () => {
  const root = useGameStore.getState().currentNode!.id;
  await choose('inspect'); expect(gameplayLedger(useGameStore.getState().gameplayModState['last-post'])?.facts.letterRead).toBe(true);
  await choose('send'); const send = useGameStore.getState().currentNode!;
  expect(await loadBlob(send.segmentHash)).toEqual(story().passages.send.segments);
  await useGameStore.getState().backtrackToNode(root); await choose('hold');
  const facts = gameplayLedger(useGameStore.getState().gameplayModState['last-post'])!.facts;
  expect(facts.decision).toBe('hold'); expect(facts.letterRead).toBe(false);
  expect(useGameStore.getState().sceneNarrative).toContain('明天');
  await useGameStore.getState().backtrackToNode(send.id);
  expect(useGameStore.getState().gameplayModState['last-post'].resolution).toBe('send');
});
it('uses replacement author content without changing mechanics and refuses repeated final decisions', () => {
  const data = story(); data.passages.inspect.segments[0].text = '作者修改后的信纸。';
  expect(logic().decide(data, {}, 'inspect').segments[0].text).toBe('作者修改后的信纸。');
  expect(() => logic().decide(data, { resolution: 'hold' }, 'send')).toThrow();
});
