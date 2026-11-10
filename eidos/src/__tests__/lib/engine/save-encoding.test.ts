import { expect, it, vi } from 'vitest';
import * as engine from '@/lib/engine';
import type { EngineHostOptions, EngineReport, JsonObject } from '@/lib/engine';
import { courtyardWorld } from './fixtures';

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

it('round-trips the engine journal and exact responses through compact JSON', async () => {
  const generate = vi.fn(async () => ({
    segments: [{ type: 'narration' as const, text: '门开了。' }],
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  }));
  const session = engine.createEngineSession({ id: 'courtyard', world: courtyardWorld(), narrator: { generate } });
  const action = { id: 'look', expectedRevision: 0, text: '看门', target: { kind: 'component' as const, id: 'door' } };
  const accepted = await session.act(action);
  const request = { id: 'batch', expectedRevision: 1, commands: [{ commandId: 'unlock' }, { commandId: 'talk', args: { prompt: '你好' } }] };
  const requested = await session.requestCommands(request);
  const deep = Array.from({ length: 62 }).reduce<JsonObject>(output => ({ nested: output }), { leaf: '回执' });
  const report: EngineReport = { id: 'report', expectedRevision: 2, changes: { state: { alarm: false } }, results: [
    { requestId: requested.commands[1].id, status: 'completed', output: deep, changes: { state: { alarm: true } } },
    { requestId: requested.commands[0].id, status: 'completed', output: { unlocked: true }, changes: { state: { keys: 0 } } },
  ] };
  const reported = await session.report(report);
  const clock = { id: 'clock', expectedRevision: 3, source: 'clock', summary: '正午', changes: { state: { hour: 12 } } };
  const synchronized = await session.synchronize(clock);
  const narrate = { id: 'recap', expectedRevision: 4, instruction: '总结已发生的事件。' };
  const narrated = await session.narrateReceipts(narrate);
  const pending = { ...request, id: 'next-batch', expectedRevision: 5 };
  await session.requestCommands(pending);

  const full = roundTrip(session.getSnapshot());
  const compact = roundTrip(engine.encodeEngineCheckpoint(full));
  expect(compact).not.toHaveProperty('turns');
  expect(compact).not.toHaveProperty('pending');
  expect(compact).not.toHaveProperty('receipts');
  expect(compact.operations[2].result).not.toHaveProperty('events');
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length);
  const restored = engine.restoreEngineSession(compact);
  expect(restored.getSnapshot()).toEqual(full);
  expect(engine.restoreEngineSession(full).getSnapshot()).toEqual(full);
  expect(await restored.act(action)).toEqual(accepted);
  expect(await restored.report(report)).toEqual(reported);
  expect(await restored.synchronize(clock)).toEqual(synchronized);
  expect(await restored.narrateReceipts(narrate)).toEqual(narrated);
  await expect(restored.act({ ...action, text: '别的行动' })).rejects.toMatchObject({ code: 'operation_conflict' });
  expect(generate).toHaveBeenCalledTimes(2);
});

it('rejects malformed compact journals and contradictory full saves', async () => {
  const session = engine.createEngineSession({ id: 'courtyard', world: courtyardWorld() });
  await session.requestCommands({ id: 'unlock', expectedRevision: 0, commands: [{ commandId: 'unlock' }] });
  const full = session.getSnapshot();
  const compact = engine.encodeEngineCheckpoint(full);
  expect(() => engine.restoreEngineSession({ ...compact, version: 2 })).toThrow(/unsupported/i);
  expect(() => engine.restoreEngineSession({ ...compact, operations: [] })).toThrow(/missing operation history/i);
  expect(() => engine.restoreEngineSession({ ...compact, pending: [] })).toThrow(/unknown field/i);
  const withEvents = roundTrip(compact);
  Object.assign(withEvents.operations[0].result, { events: [] });
  expect(() => engine.restoreEngineSession(withEvents)).toThrow(/unknown field/i);
  const brokenFingerprint = roundTrip(compact);
  brokenFingerprint.operations[0].fingerprint = '{';
  expect(() => engine.restoreEngineSession(brokenFingerprint)).toThrow(/fingerprint JSON/i);
  const unavailable = roundTrip(compact);
  unavailable.world.commands.unlock.enabled = false;
  expect(() => engine.restoreEngineSession(unavailable)).toThrow(/pending command does not match/i);
  full.operations[0].result.events = [];
  expect(() => engine.restoreEngineSession(full)).toThrow(/events contradict/i);
});

it('rejects invalid world changes reconstructed from compact report and sync fingerprints', async () => {
  const session = engine.createEngineSession({ id: 'courtyard', world: courtyardWorld() });
  const request = await session.requestCommands({ id: 'unlock', expectedRevision: 0, commands: [{ commandId: 'unlock' }] });
  await session.report({ id: 'report', expectedRevision: 1, results: [
    { requestId: request.commands[0].id, status: 'completed', changes: { state: { keys: 0 } } },
  ] });
  await session.synchronize({ id: 'clock', expectedRevision: 2, source: 'clock', summary: '正午', changes: { state: { hour: 12 } } });
  const compact = engine.encodeEngineCheckpoint(session.getSnapshot());
  for (const [index, original, corrupted] of [
    [1, '{"state":{"keys":0}}', 'null'],
    [1, '{"state":{"keys":0}}', '{"state":false}'],
    [2, '{"state":{"hour":12}}', '{"components":[{"id":"door","kind":"door","name":false}]}'],
    [2, '{"state":{"hour":12}}', '{"unexpected":true}'],
  ] as const) {
    const save = roundTrip(compact);
    save.operations[index].fingerprint = save.operations[index].fingerprint.replace(original, corrupted);
    expect(() => engine.restoreEngineSession(save)).toThrow(engine.EngineError);
  }
});

it('uses compact saves at the host persistence boundary and resumes a staged batch without re-executing it', async () => {
  type Game = { keys: number };
  let disk: engine.CompactEngineHostSnapshot<Game> | undefined;
  let rejectReportSave = false;
  const execute = vi.fn<EngineHostOptions<Game>['execute']>(({ game }) => ({ status: 'completed', game: { keys: game.keys - 1 }, output: '已开门' }));
  const options: EngineHostOptions<Game> = {
    project: game => ({ ...courtyardWorld(), state: { keys: game.keys } }),
    execute,
    persistence: { async save(snapshot, previous) {
      expect(previous).toBe(disk?.revision ?? null);
      if (rejectReportSave) throw new Error('Disk full');
      disk = roundTrip(engine.encodeEngineHostSnapshot(snapshot));
    } },
  };
  const host = engine.createEngineHost({ id: 'courtyard', game: { keys: 1 }, ...options });
  await host.persist();
  expect(engine.restoreEngineHost(disk, options).getSnapshot()).toEqual(host.getSnapshot());
  const clock = { id: 'clock', expectedRevision: 0, source: 'clock', summary: '正午' };
  const synchronized = await host.synchronize(clock);
  await host.requestCommands({ id: 'unlock', expectedRevision: 1, commands: [{ commandId: 'unlock' }] });
  await host.executePending();
  const staged = roundTrip(disk!);
  expect(staged).toMatchObject({ revision: 4, engine: { revision: 2 }, game: { keys: 0 }, executions: [{ result: { output: '已开门' } }] });
  const corrupted = roundTrip(staged);
  if (corrupted.version !== 2) throw new Error('Expected a v2 host save');
  corrupted.synchronizations.clock = 'f'.repeat(64);
  expect(() => engine.restoreEngineHost(corrupted, options)).toThrow(/synchronization fingerprint/i);
  const restored = engine.restoreEngineHost(staged, options);
  expect(restored.getSnapshot()).toEqual(host.getSnapshot());
  expect(await restored.synchronize(clock)).toEqual(synchronized);
  rejectReportSave = true;
  await expect(restored.resumePending()).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(disk).toEqual(staged);
  expect(restored.getSnapshot()).toEqual(host.getSnapshot());
  rejectReportSave = false;
  expect((await restored.resumePending())?.report).toMatchObject({ revision: 3, receipts: [{ output: '已开门' }] });
  expect(execute).toHaveBeenCalledOnce();
  expect(disk).toMatchObject({ revision: 5, engine: { revision: 3 } });
});
