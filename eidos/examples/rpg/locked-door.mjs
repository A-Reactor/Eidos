import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// In another project, install @eidos/engine and run this file without arguments.
const local = process.argv.includes('--local-sdk');
const { createEngineSession, encodeEngineCheckpoint, restoreEngineSession, applyEngineChanges } = await import(local ? '../../sdk/dist/index.js' : '@eidos/engine');
const { createRpgSnapshot, prepareRpgAction, buildEidosEngineWorld, engineCommandToPlayerInput, projectNpcMemoryState } = await import(local ? '../../sdk/dist/rpg.js' : '@eidos/engine/rpg');
const world = JSON.parse(await readFile(new URL('./world.json', import.meta.url), 'utf8'));
let snapshot = createRpgSnapshot({ world, playerName: '旅人' }), history = [], executed = new Map();

function project(state = snapshot) {
  const view = buildEidosEngineWorld({ world, snapshot: state }), open = Boolean(state.worldFlags['gameplay.courtyard.open']);
  view.components.door = { id: 'door', kind: 'door', name: '庭院门', sceneId: 'hall', state: { open } };
  view.commands.unlock = { id: 'unlock', name: '打开庭院门', target: { kind: 'component', id: 'door' }, enabled: !open };
  if (!state.worldFlags['gameplay.courtyard.found']) {
    view.components.key = { id: 'key', kind: 'pickup', name: '铜钥匙', sceneId: 'hall', state: {} };
    view.commands.pickup = { id: 'pickup', name: '捡起钥匙', target: { kind: 'component', id: 'key' } };
  }
  return view;
}
const narrator = { async generate({ context }) {
  const receipt = context.receipts.at(-1);
  return { segments: [{ type: 'narration', text: receipt?.output?.text ?? receipt?.message ?? '晨光照进门厅。' }] };
} };
let session = createEngineSession({ id: 'portable-rpg-save', world: project(), narrator });

function program(request) {
  if (Object.keys(request.args).length) throw new Error('示例命令不接受额外参数');
  const response = { validity: { isPossible: true, reason: null, fantasyResponse: null }, segments: [], sceneChanges: [], discoveredSecrets: [], npcsReacted: [],
    availableActions: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [], summary: '', timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [] };
  let input;
  if (request.commandId === 'pickup') {
    input = '捡起铜钥匙'; response.segments = [{ type: 'narration', text: '你从长椅旁拾起铜钥匙。' }];
    response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'pickup' }];
    response.itemsGained = [{ id: 'brass-key', name: '铜钥匙', description: '铜门的钥匙。', quantity: 1, category: 'key', value: 0, consumable: true, acquiredFrom: 'hall', acquiredAt: snapshot.currentGameTime }];
  } else if (request.commandId === 'unlock') {
    if (!snapshot.inventory.some(item => item.id === 'brass-key' && item.quantity > 0)) throw new Error('门锁着，需要铜钥匙。');
    input = '用钥匙打开庭院门'; response.segments = [{ type: 'narration', text: '铜门打开了，通路已可行。' }];
    response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'unlock' }]; response.itemsUsed = ['铜钥匙'];
    response.mapUpdates = { routes: [{ from: 'hall', to: 'garden', status: 'open', bidirectional: true }] };
  } else {
    input = engineCommandToPlayerInput(request, { world, snapshot });
    if (request.target.kind === 'mapEdge') {
      response.sceneChanges = [session.getSnapshot().world.map.edges[request.target.id].to];
      response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'travel' }]; response.timeSpent.minute = 2;
      response.segments = [{ type: 'narration', text: '你穿过打开的铜门，走进庭院。' }];
    } else {
      response.segments = [{ type: 'dialogue', speaker: '守门人', text: '钥匙落在长椅边。' }]; response.npcsReacted = ['守门人：指向长椅'];
      response.relationshipUpdates = [{ npcName: '守门人', trustDelta: 2 }];
    }
  }
  response.summary = input;
  return { input, response };
}

function execute(request) {
  const prior = executed.get(request.id);
  if (prior) { assert.deepEqual(request, prior.request); return structuredClone(prior.result); }
  assert.deepEqual(request, session.getSnapshot().pending.find(pending => pending.id === request.id));
  let result;
  try {
    const { input, response } = program(request);
    const prepared = prepareRpgAction({ world, snapshot, response, input, actionId: request.id, timestamp: history.length, history });
    const previous = session.getSnapshot().world, next = project(prepared.snapshot);
    const changes = { state: next.state, currentSceneId: next.currentSceneId, scenes: Object.values(next.scenes), components: Object.values(next.components),
      removeScenes: Object.keys(previous.scenes).filter(id => !next.scenes[id]), removeComponents: Object.keys(previous.components).filter(id => !next.components[id]), map: next.map, commands: next.commands };
    applyEngineChanges(previous, changes);
    result = { requestId: request.id, status: 'completed', output: { text: prepared.text }, changes };
    snapshot = prepared.snapshot; history.push(prepared.record);
  } catch (error) { result = { requestId: request.id, status: 'failed', message: error.message }; }
  executed.set(request.id, structuredClone({ request, result }));
  return structuredClone(result);
}
const request = async (id, commandId) => (await session.requestCommands({ id, expectedRevision: session.getSnapshot().revision, commands: [{ commandId }] })).commands[0];
const narrate = id => session.narrateReceipts({ id, expectedRevision: session.getSnapshot().revision, instruction: '描述实际程序结果。' });
async function interact(id, commandId) {
  const command = await request(id, commandId), result = execute(command);
  await session.report({ id: `${id}-result`, expectedRevision: session.getSnapshot().revision, results: [result] });
  await narrate(`${id}-prose`);
  return result;
}

const before = structuredClone(snapshot);
assert.equal((await interact('failed-open', 'unlock')).status, 'failed');
assert.deepEqual(snapshot, before);
await interact('talk', Object.values(project().commands).find(command => command.id.startsWith('talk/')).id);
const pickup = await request('pickup', 'pickup'), pickupResult = execute(pickup);
const report = { id: 'pickup-result', expectedRevision: session.getSnapshot().revision, results: [pickupResult] };

// Replace this JSON boundary with one atomic save of host state, journal and engine checkpoint.
const save = JSON.parse(JSON.stringify({ snapshot, history, executed: [...executed], engine: encodeEngineCheckpoint(session.getSnapshot()), report }));
snapshot = save.snapshot; history = save.history; executed = new Map(save.executed); session = restoreEngineSession(save.engine, { narrator });
assert.deepEqual(execute(session.getSnapshot().pending[0]), save.report.results[0]);
const accepted = await session.report(save.report);
assert.deepEqual(await session.report(save.report), accepted);
await narrate('pickup-prose');
await interact('unlock', 'unlock');
await interact('travel', Object.values(project().commands).find(command => command.target.kind === 'mapEdge').id);

const final = session.getSnapshot();
assert.equal(snapshot.currentSceneId, 'garden'); assert.equal(snapshot.gameplayResources['gameplay.courtyard.keys'], 0);
assert.equal(snapshot.gameplayResources['gameplay.courtyard.stamina'], 4); assert.equal(final.revision, 15); assert.equal(executed.size, 5);
assert.deepEqual(history[0].snapshot, before);
assert.equal(projectNpcMemoryState(snapshot.npcMemory).relationships.守门人.trust, 2);
console.log(JSON.stringify({ scene: final.world.scenes[final.world.currentSceneId].name, keys: 0, stamina: 4, revision: final.revision,
  executions: executed.size, saveRestored: true, duplicateReportAcceptedOnce: true, rollbackSnapshotClean: true }, null, 2));
