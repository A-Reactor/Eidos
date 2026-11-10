import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import engine from '../../sdk/dist/index.js';

const { createEngineSession, restoreEngineSession, buildEngineContext } = engine;
let game = JSON.parse(await readFile(new URL('./courtyard.json', import.meta.url), 'utf8'));
const executed = new Map();
let executions = 0;

// Replace this port with createHttpNarrator to use a configured model.
const narrator = { async generate({ context, input }) {
  if (input.text === '用铜钥匙开门') return { segments: [], commands: [{ commandId: 'unlock', args: { key: 'brass' } }] };
  const last = context.receipts.at(-1);
  return { segments: [{ type: 'narration', text: `${context.scene.name}：${last?.message ?? '等待交互'}。` }] };
} };
const session = createEngineSession({ id: 'my-game-save', world: game, narrator });

// The game controls execution and validates parameters again at the actual action boundary.
function execute(request) {
  if (executed.has(request.id)) return structuredClone(executed.get(request.id));
  executions++;
  let result;
  if (request.commandId === 'unlock') {
    if (request.args.key !== 'brass' || game.state.keys < 1) {
      result = { requestId: request.id, status: 'failed', message: '钥匙不匹配，门仍锁着', output: { reason: 'wrong_key' } };
    } else {
      game.state.keys--; game.components.door.state.open = true; game.map.edges.path.blocked = false;
      result = { requestId: request.id, status: 'completed', message: '门锁打开，通路可通行', output: { unlocked: true },
        changes: { state: game.state, components: [game.components.door], map: game.map } };
    }
  } else if (request.commandId === 'travel' && !game.map.edges.path.blocked) {
    game.currentSceneId = 'garden';
    result = { requestId: request.id, status: 'completed', message: '玩家沿通路进入庭院', output: { sceneId: 'garden', path: ['entrance', 'yard'] }, changes: { currentSceneId: 'garden' } };
  } else result = { requestId: request.id, status: 'denied', message: '游戏程序不允许本次操作' };
  const captured = structuredClone(result); executed.set(request.id, captured);
  return structuredClone(captured);
}

// A UI button can request a command directly, without a model call.
const first = await session.requestCommands({ id: 'wrong-key', expectedRevision: 0, commands: [{ commandId: 'unlock', args: { key: 'wrong' } }] });
await session.report({ id: 'wrong-key-result', expectedRevision: 1, results: first.commands.map(execute) });
assert.equal(session.getSnapshot().world.components.door.state.open, false);

// A free-text action can propose the same declared command.
const proposal = await session.act({ id: 'open-door', expectedRevision: 2, text: '用铜钥匙开门', target: { kind: 'component', id: 'door' } });
const report = { id: 'door-result', expectedRevision: 3, results: proposal.commands.map(execute) };
const accepted = await session.report(report);
const reaction = await session.narrateReceipts({ id: 'reaction', expectedRevision: 4 });
assert.match(reaction.segments[0].text, /门锁打开/);

// A map click uses the now-available route, with the same program-result protocol.
const travel = await session.requestCommands({ id: 'map-click', expectedRevision: 5, commands: [{ commandId: 'travel' }] });
await session.report({ id: 'travel-result', expectedRevision: 6, results: travel.commands.map(execute) });

// Physics, combat, inventory or other programs may also publish their own completed results.
await session.synchronize({ id: 'physics-step', expectedRevision: 7, source: 'physics', summary: '玩家停在庭院树旁', output: { grounded: true, velocity: 0 },
  changes: { components: [{ ...game.components.player, state: { position: { x: 10, y: 0 } } }] } });

// Store the game's own state and its side-effect deduplication journal alongside Eidos.
const save = JSON.parse(JSON.stringify({ engine: session.getSnapshot(), game, executed: [...executed] }));
const restored = restoreEngineSession(save.engine, { narrator });
assert.deepEqual(await restored.report(report), accepted);
const snapshot = restored.getSnapshot(), context = buildEngineContext(snapshot);
assert.equal(snapshot.revision, 8); assert.equal(snapshot.world.currentSceneId, 'garden');
assert.equal(snapshot.world.state.keys, 0); assert.equal(snapshot.world.map.edges.path.blocked, false);
assert.equal(snapshot.world.components.door.state.open, true); assert.equal(executions, 3);
assert.deepEqual(context.components.player.state.position, { x: 10, y: 0 });
console.log(JSON.stringify({ scene: context.scene.name, revision: snapshot.revision, keys: snapshot.world.state.keys,
  doorOpen: snapshot.world.components.door.state.open, routeBlocked: snapshot.world.map.edges.path.blocked,
  programStatuses: snapshot.receipts.map(r => r.status), executions, saveRestored: true, duplicateReportAcceptedOnce: true }, null, 2));
