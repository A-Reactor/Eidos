// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { commitGameplayOperation } from '@/lib/game/plugins/gameplay-commit';
import { gameplayLedger, gameplayContextForModel } from '@/lib/game/plugins/gameplay-state';
import { loadBlob } from '@/lib/game/cas-storage';
import { withWorkspace, type WorkspaceAccess } from '@/lib/game/plugins/workspace-operations';
import { runWorkspaceOperation } from '@/lib/game/plugins/workspace-host';
import { loadModPackage } from '../../../scripts/mod-package.mjs';
import { loadMetaMinds, type Operation, type StageRun, type MindRun } from './meta-minds-fixtures';
const { meta, mind } = loadMetaMinds();
const folders = ['palimpsest-stage', 'social-minds'];
afterEach(() => vi.unstubAllGlobals());
async function boot(id: string) {
  vi.stubGlobal('crypto', webcrypto);
  const { world, snapshot } = buildRiftCityStartState(), plugin = await loadModPackage('mods/' + id);
  useGameStore.setState({ ...useGameStore.getInitialState(), currentWorld: { ...world, gameplayPlugins: parsePluginFile(plugin) }, currentPlaythroughId: crypto.randomUUID() });
  useGameStore.getState().restoreSnapshot({ ...snapshot, gameplayModState: undefined });
  await useGameStore.getState().initWorldLine(useGameStore.getState().currentPlaythroughId!, world.id);
}
function accept(id: string, op: Operation, operationId: string = crypto.randomUUID()) {
  return commitGameplayOperation(useGameStore, id, { ...op, id: operationId, expectedRevision: gameplayLedger(useGameStore.getState().gameplayModState[id])?.revision ?? 0 });
}
it.each(folders)('%s ships exactly the validated current author sources', async id => {
  expect(parsePluginFile(JSON.parse(readFileSync(`mods/dist/${id}.eidos-plugin.json`, 'utf8')))).toEqual(parsePluginFile(await loadModPackage('mods/' + id)));
});
it.each(folders)('%s persists once, rewinds sibling choices and retries failed node writes without another decision', async id => {
  await boot(id);
  const initial = id === 'palimpsest-stage' ? meta.operation(meta.start(meta.sample())) : mind.operation(mind.start());
  await accept(id, initial); const root = useGameStore.getState().currentNode!.id;
  const next = id === 'palimpsest-stage' ? meta.operation(meta.act(initial.state.run as StageRun, { type: 'skip' })) : mind.operation(mind.act(initial.state.run as MindRun, { type: 'inspect', id: 'fuse' }));
  const opId = crypto.randomUUID(), original = useGameStore.getState().addActionNode; let failOnce = true;
  useGameStore.setState({ addActionNode: async (...args: Parameters<typeof original>) => { if (failOnce) { failOnce = false; throw new Error('simulated disk failure'); } return original(...args); } });
  try {
    expect(await accept(id, next, opId)).toMatchObject({ persistence: 'pending' });
    expect(await accept(id, next, opId)).toMatchObject({ persistence: 'saved' });
  } finally { useGameStore.setState({ addActionNode: original }); }
  const child = useGameStore.getState().currentNode!;
  await accept(id, next, opId); expect(gameplayLedger(useGameStore.getState().gameplayModState[id])?.revision).toBe(2);
  await useGameStore.getState().backtrackToNode(root);
  expect(useGameStore.getState().gameplayModState[id].run).toEqual(initial.state.run);
  const alternate = id === 'palimpsest-stage' ? meta.operation(meta.act(initial.state.run as StageRun, { type: 'next' })) : mind.operation(mind.act(initial.state.run as MindRun, { type: 'inspect', id: 'log' }));
  await accept(id, alternate);
  await useGameStore.getState().backtrackToNode(child.id);
  expect(useGameStore.getState().gameplayModState[id].run).toEqual(next.state.run);
  expect(await loadBlob(child.segmentHash)).toEqual(next.segments);
});
it.each(['keep', 'return', 'erase'])('completes the Meta %s ending using formal host operations and persists revealed cues', async ending => {
  const id = 'palimpsest-stage'; await boot(id); let run = meta.start(meta.sample()); await accept(id, meta.operation(run));
  for (const choice of ['enter', 'remember', ending]) {
    run = meta.act(run, { type: 'skip' }); await accept(id, meta.operation(run));
    run = meta.act(run, { type: 'choose', id: choice }); await accept(id, meta.operation(run));
  }
  run = meta.act(run, { type: 'skip' }); await accept(id, meta.operation(run));
  expect(gameplayLedger(useGameStore.getState().gameplayModState[id])?.facts.ending).toBe(ending);
  const saved = useGameStore.getState().serializeState(); useGameStore.getState().deserializeState(JSON.parse(JSON.stringify(saved)), useGameStore.getState().currentWorld!);
  expect(useGameStore.getState().gameplayModState[id].run).toEqual(run);
});
it('restores real mental states and commitments and never gives model context private evidence', async () => {
  const id = 'social-minds'; await boot(id); let run = mind.start(); await accept(id, mind.operation(run));
  for (const command of [{ type: 'inspect', id: 'fuse' }, { type: 'tell', actor: 'station', id: 'fuse' }]) { run = mind.act(run, command); await accept(id, mind.operation(run)); }
  const privateNode = useGameStore.getState().currentNode!.id, privateState = structuredClone(run);
  expect(JSON.stringify(gameplayContextForModel(useGameStore.getState().gameplayModState))).not.toContain('fuse');
  for (const command of [{ type: 'promise', actor: 'station' }, { type: 'tell', actor: 'station', id: 'fuse', public: true }, { type: 'repair' }, { type: 'leave' }]) { run = mind.act(run, command); await accept(id, mind.operation(run)); }
  expect(run.ending).toBe('cooperate'); expect(run.promises[0].outcome).toBe('kept');
  await useGameStore.getState().backtrackToNode(privateNode);
  expect(useGameStore.getState().gameplayModState[id].run).toEqual(privateState);
  expect((useGameStore.getState().gameplayModState[id].run as MindRun).actors.passenger.belief.cause).toBe('sabotage');
});
it('carries only an explicitly published visible letter across real rewind boundaries', async () => {
  const id = 'palimpsest-stage'; await boot(id); let run = meta.start(meta.sample()); await accept(id, meta.operation(run));
  const first = useGameStore.getState().currentNode!.id;
  for (const choice of ['enter', 'remember']) { run = meta.act(run, { type: 'skip' }); await accept(id, meta.operation(run)); run = meta.act(run, { type: 'choose', id: choice }); await accept(id, meta.operation(run)); }
  function access(): WorkspaceAccess {
    const origin = useGameStore.getState().currentNode!.id, play = useGameStore.getState().currentPlaythroughId;
    return { scope: origin, mailbox: 'stage-letter-' + play, storagePrefix: key => 'test-' + play + ':' + key,
      current: () => useGameStore.getState().currentNode!.id === origin,
      state: () => useGameStore.getState().gameplayModState[id], commit: workspace => useGameStore.setState(s => ({ gameplayModState: { ...s.gameplayModState, [id]: withWorkspace(s.gameplayModState[id], workspace) } })) };
  }
  const originalNode = useGameStore.getState().currentNode!.id;
  await runWorkspaceOperation('files.write', { path: 'letter.json', text: JSON.stringify(meta.letter(run)) }, access());
  await runWorkspaceOperation('files.publish', { path: 'letter.json', key: 'stage-letter' }, access());
  await useGameStore.getState().backtrackToNode(first);
  await expect(runWorkspaceOperation('files.read', { path: 'received.json' }, access())).rejects.toThrow('不存在');
  const received = await runWorkspaceOperation('files.receive', { path: 'received.json', key: 'stage-letter' }, access()) as { origin: string };
  expect(received.origin).toBe(originalNode);
  const file = await runWorkspaceOperation('files.read', { path: 'received.json' }, access()) as { text: string };
  expect(meta.parseLetter(file.text).text).toContain('署名信');
  expect((useGameStore.getState().gameplayModState[id].run as StageRun).nodeId).toBe('threshold');
});
