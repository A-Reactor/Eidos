import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const server = await createServer({ configFile: fileURLToPath(new URL('./vite.config.mjs', import.meta.url)),
  server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
try {
  const { createCourtyardGame, restoreCourtyardGame } = await server.ssrLoadModule('/game.ts');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.indexedDB, 'undefined');
  let disk;
  const persist = (next, previous) => {
    assert.equal(previous, disk?.revision ?? null);
    disk = JSON.parse(JSON.stringify(next));
  };
  const game = createCourtyardGame(persist);
  await game.persist();
  assert.equal((await game.interact('unlock-door')).result.status, 'failed');
  const talk = Object.values(game.getSnapshot().engine.world.commands).find(c => c.target.kind === 'component' && c.id.startsWith('talk/'));
  await game.interact(talk.id);
  await game.request('take-key');
  await game.executePending();
  assert.equal(disk.engine.format, 'eidos-engine-compact');
  assert.equal(disk.engine.pending, undefined);
  const restored = restoreCourtyardGame(disk, persist);
  await restored.resumePending();
  await restored.resumePending();
  assert.equal(restored.getSnapshot().game.snapshot.inventory[0].quantity, 1);
  await restored.interact('unlock-door');
  const travel = Object.values(restored.getSnapshot().engine.world.commands).find(c => c.target.kind === 'mapEdge');
  await restored.interact(travel.id);
  const save = restored.getSnapshot(), { snapshot } = save.game;
  assert.equal(snapshot.currentSceneId, 'garden');
  assert.equal(snapshot.gameplayResources['gameplay.courtyard.keys'], 0);
  assert.equal(snapshot.gameplayResources['gameplay.courtyard.stamina'], 4);
  assert.equal(save.executions.length, 5);
  assert.deepEqual(restoreCourtyardGame(disk).getSnapshot(), save);
  console.log(`PASS: offline courtyard game via EngineHost; compact save ${Buffer.byteLength(JSON.stringify(disk))} UTF-8 bytes.`);
} finally { await server.close(); }
