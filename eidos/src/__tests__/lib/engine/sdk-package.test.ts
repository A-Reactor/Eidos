import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { courtyardWorld } from '../../../../dev/engine-game/world';

const project = fileURLToPath(new URL('../../../../', import.meta.url));
let temporary: string, consumer: string, packageRoot: string;
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
beforeAll(() => {
  temporary = mkdtempSync(path.join(tmpdir(), 'eidos-sdk-package-'));
  packageRoot = path.join(temporary, 'package'); consumer = path.join(temporary, 'consumer');
  mkdirSync(packageRoot); mkdirSync(consumer);
  cpSync(path.join(project, 'sdk/package.json'), path.join(packageRoot, 'package.json'));
  cpSync(path.join(project, 'sdk/README.md'), path.join(packageRoot, 'README.md'));
  cpSync(path.join(project, 'sdk/LICENSE'), path.join(packageRoot, 'LICENSE'));
  run(process.execPath, [path.join(project, 'scripts/sdk/build.mjs'), '--out-dir', path.join(packageRoot, 'dist')], project);
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--cache', path.join(temporary, 'cache'), '--pack-destination', temporary], packageRoot));
  writeFileSync(path.join(consumer, 'package.json'), '{"name":"external-game","version":"1.0.0","private":true}');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', path.join(temporary, 'cache'), path.join(temporary, packed[0].filename)], consumer);
  writeFileSync(path.join(consumer, 'world.json'), JSON.stringify(courtyardWorld()));
}, 60000);
afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); });

const hostProgram = `
const fs = require('node:fs'); const assert = require('node:assert/strict');
for (const name of ['window','document','indexedDB','localStorage']) Object.defineProperty(globalThis,name,{get(){throw new Error('browser access: '+name)}});
globalThis.fetch = () => { throw new Error('network access'); };
const engine = require('@eidos/engine'); const rpg = require('@eidos/engine/rpg');
(async()=>{
 const world=JSON.parse(fs.readFileSync('world.json','utf8'));
 const snapshot=rpg.createRpgSnapshot({world,playerName:'旅人',time:{day:0,hour:0,minute:0}});
 const session=engine.createEngineSession({id:'external',world:rpg.buildEidosEngineWorld({world,snapshot})});
 const command=Object.values(session.getSnapshot().world.commands).find(c=>c.id.startsWith('talk/'));
 const requested=await session.requestCommands({id:'talk',expectedRevision:0,commands:[{commandId:command.id}]});
 const response={validity:{isPossible:true,reason:null,fantasyResponse:null},segments:[{type:'dialogue',speaker:'守门人',text:'请拿好钥匙。'}],sceneChanges:[],discoveredSecrets:[],npcsReacted:['守门人'],availableActions:[],summary:'交谈后取得钥匙',timeSpent:{day:0,hour:0,minute:1},worldImpacts:[],itemsGained:[{id:'key',name:'铜钥匙',description:'钥匙',category:'key',quantity:1,value:0}],itemsUsed:[],cluesDiscovered:[],pluginEvents:[{pluginId:'courtyard',ruleId:'take-key'}]};
 const prepared=rpg.prepareRpgAction({world,snapshot,response,input:rpg.engineCommandToPlayerInput(requested.commands[0],{world,snapshot}),actionId:requested.commands[0].id,timestamp:1});
 assert.equal(prepared.snapshot.gameplayResources['gameplay.courtyard.keys'],1);
 assert.equal(prepared.snapshot.inventory[0].quantity,1); assert.deepEqual(prepared.record.snapshot,snapshot);
 const next=rpg.buildEidosEngineWorld({world:prepared.world,snapshot:prepared.snapshot});
 const report={id:'report',expectedRevision:1,results:[{requestId:requested.commands[0].id,status:'completed',output:{text:prepared.text},changes:{state:next.state,components:Object.values(next.components),commands:next.commands,map:next.map}}]};
 const committed=await session.report(report); const restored=engine.restoreEngineSession(JSON.parse(JSON.stringify(session.getSnapshot())));
 assert.deepEqual(await restored.report(report),committed);
 assert.equal(restored.getSnapshot().revision,2);
 try { rpg.buildEidosEngineWorld({world,snapshot:{...snapshot,worldId:'wrong'}}); assert.fail('invalid world accepted'); } catch(error) { assert(error instanceof engine.EngineError); }
 console.log(JSON.stringify({keys:1,revision:2,isolated:true}));
})().catch(error=>{console.error(error);process.exitCode=1});
`;

it('runs a real CommonJS game with no source aliases, browser APIs or runtime dependencies', () => {
  writeFileSync(path.join(consumer, 'host.cjs'), hostProgram);
  expect(JSON.parse(run(process.execPath, ['host.cjs'], consumer))).toEqual({ keys: 1, revision: 2, isolated: true });
  const installed = path.join(consumer, 'node_modules/@eidos/engine');
  const pkg = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
  expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  expect(pkg.license).toBe('MIT');
  expect(readFileSync(path.join(installed, 'LICENSE'), 'utf8')).toBe(readFileSync(path.join(project, '../LICENSE'), 'utf8'));
}, 20000);

it('supports named and default imports from an ES module consumer', () => {
  writeFileSync(path.join(consumer, 'consumer.mjs'), "import core, {createEngineSession} from '@eidos/engine';\nimport rpg, {createRpgSnapshot,prepareRpgAction} from '@eidos/engine/rpg';\nif(core.createEngineSession!==createEngineSession || rpg.createRpgSnapshot!==createRpgSnapshot || typeof prepareRpgAction!=='function') throw new Error('exports mismatch');\nconsole.log('ok');");
  expect(run(process.execPath, ['consumer.mjs'], consumer).trim()).toBe('ok');
});

it('typechecks public inputs and outputs strictly in an external project', () => {
  writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', lib: ['ES2023', 'DOM'], types: [], strict: true, skipLibCheck: false, noEmit: true }, files: ['consumer.ts'] }));
  writeFileSync(path.join(consumer, 'consumer.ts'), `import {createRpgSnapshot,prepareRpgAction, type WorldDefinition,type AIGameResponse,type RpgActionEffect} from '@eidos/engine/rpg';
import {createEngineHost, encodeEngineHostSnapshot, restoreEngineHost, ENGINE_RECEIPT_NARRATION_INPUT, type CompactEngineHostSnapshot, type EngineHostOptions, type EngineHostSnapshot, type EngineWorld} from '@eidos/engine';
declare const world: WorldDefinition; declare const response: AIGameResponse;
declare const projection: EngineWorld;
interface Game { count: number }
const options: EngineHostOptions<Game> = {
  context: { maxHistory: 10, maxBytes: 64_000 },
  reportSave: 'atomic',
  maxSettledExecutions: 0,
  project: game => ({ ...projection, state: { count: game.count } }),
  execute: ({game}) => ({ status: 'completed', game: { count: game.count + 1 } }),
  persistence: { async save(snapshot, previous) {
    const count: number = snapshot.game.count;
    const revision: number | null = previous;
  } }
};
const host = createEngineHost({ id: 'test', game: { count: 0 }, ...options });
const saved: EngineHostSnapshot<Game> = host.getSnapshot();
const compact: CompactEngineHostSnapshot<Game> = encodeEngineHostSnapshot(saved);
const restored = restoreEngineHost(compact, options);
async function recordClock() {
  await restored.persist();
  await restored.synchronize({ id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick', game: { count: 1 } });
  const bytes: number = restored.getStorageStats().snapshotBytes;
  await restored.narrateReceipts({ id: 'narrate', expectedRevision: 1, instruction: 'Describe the result in English.' });
}
const previous = restored.getSnapshot();
// @ts-expect-error v2 snapshots require the synchronization table
const invalidV2: EngineHostSnapshot<Game> = { format: previous.format, version: 2, revision: previous.revision, game: previous.game, executions: previous.executions, engine: previous.engine };
void ENGINE_RECEIPT_NARRATION_INPUT;
// @ts-expect-error a host retains the concrete game type
const invalidGame: string = restored.getSnapshot().game.count;
const snapshot = createRpgSnapshot({world,playerName:'旅人'});
const result = prepareRpgAction({world,snapshot,response,input:'开门',actionId:'action',timestamp:0});
const id: string = result.record.sceneId; const count: number = snapshot.inventory.length;
const effects: RpgActionEffect[] = result.effects;
// @ts-expect-error time is numeric
createRpgSnapshot({world,playerName:'旅人',time:{day:0,hour:0,minute:'bad'}});
// @ts-expect-error output keeps the real scene ID type
const bad: number = result.snapshot.currentSceneId;
// @ts-expect-error player name is required
createRpgSnapshot({world});
`);
  run(process.execPath, [path.join(project, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.json'], consumer);
}, 20000);

it('replaces stale generated files only after a successful fresh build', () => {
  writeFileSync(path.join(packageRoot, 'dist/stale.js'), 'stale');
  run(process.execPath, [path.join(project, 'scripts/sdk/build.mjs'), '--out-dir', path.join(packageRoot, 'dist')], project);
  expect(readdirSync(path.join(packageRoot, 'dist'))).not.toContain('stale.js');
}, 20000);

it('runs the complete RPG example copied unchanged into the installed consumer project', () => {
  const example = path.join(consumer, 'rpg-example'); mkdirSync(example);
  cpSync(path.join(project, 'examples/rpg/locked-door.mjs'), path.join(example, 'locked-door.mjs'));
  cpSync(path.join(project, 'examples/rpg/world.json'), path.join(example, 'world.json'));
  const result = JSON.parse(run(process.execPath, ['locked-door.mjs'], example));
  expect(result).toMatchObject({ scene: '庭院', keys: 0, stamina: 4, revision: 15, executions: 5, saveRestored: true, duplicateReportAcceptedOnce: true, rollbackSnapshotClean: true });
}, 20000);
