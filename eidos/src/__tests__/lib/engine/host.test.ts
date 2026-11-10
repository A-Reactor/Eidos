import { expect, it, vi } from 'vitest';
import { createEngineHost, createEngineSession, restoreEngineHost, type EngineHostOptions, type EngineHostSnapshot, type JsonValue } from '@/lib/engine';
import { courtyardWorld } from './fixtures';

interface Game { keys: number; open: boolean; privateNote?: string }
const initialGame = { keys: 1, open: false };
const request = { id: 'unlock', expectedRevision: 0, commands: [{ commandId: 'unlock' }] };

function fixture() {
  let disk: EngineHostSnapshot<Game> | null = null;
  let failAt = 0;
  const options: EngineHostOptions<Game> = {
    project(game) {
      const world = courtyardWorld();
      world.description = undefined;
      world.state.keys = game.keys;
      world.components.door.state.open = game.open;
      world.map.edges.path.blocked = !game.open;
      return world;
    },
    execute: vi.fn<EngineHostOptions<Game>['execute']>(({ game, request }) => {
      if (request.commandId === 'talk') return { status: 'denied', message: `Keys: ${game.keys}` };
      return { status: 'completed', game: { keys: game.keys - 1, open: true }, output: { unlocked: true } };
    }),
    persistence: {
      async save(next, expected) {
        expect(expected).toBe(disk?.revision ?? null);
        if (next.revision === failAt) throw new Error('disk full');
        disk = structuredClone(next);
      },
    },
  };
  return {
    options,
    create: (overrides: Partial<EngineHostOptions<Game>> = {}) =>
      createEngineHost<Game>({ ...options, ...overrides, id: 'courtyard-host', game: initialGame }),
    read: () => structuredClone(disk!),
    failOn: (revision: number) => { failAt = revision; },
  };
}

it('restores an executed batch before its report without replaying it and rejects a mismatched world', async () => {
  const f = fixture(), host = f.create();
  await host.requestCommands({ ...request, commands: [...request.commands, { commandId: 'talk' }] });
  const results = await host.executePending();
  expect(results).toMatchObject([{ status: 'completed' }, { status: 'denied', message: 'Keys: 0' }]);
  const saved = f.read();
  expect(saved).toMatchObject({ revision: 2, game: { keys: 0, open: true }, engine: { revision: 1, world: { state: { keys: 1 } } } });
  const wrong = structuredClone(saved);
  wrong.engine.world.components.guide.name = 'Wrong world';
  expect(() => restoreEngineHost(wrong, f.options)).toThrow(/projection/i);
  const restored = restoreEngineHost(JSON.parse(JSON.stringify(saved)), f.options);
  const resumed = await restored.resumePending();
  expect(resumed).toMatchObject({ operationId: request.id, results, report: { revision: 2 } });
  expect(await restored.resumePending()).toBeNull();
  expect(f.options.execute).toHaveBeenCalledTimes(2);
  expect(f.read()).toMatchObject({ revision: 3, game: { keys: 0, open: true }, engine: { revision: 2, pending: [], world: { state: { keys: 0 } } } });
});

it('retries a failed execution save and report save without rerunning the handler in the live host', async () => {
  const f = fixture(), host = f.create();
  await host.requestCommands(request);
  f.failOn(2);
  await expect(host.resumePending()).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(host.getSnapshot()).toEqual(f.read());
  expect(host.getSnapshot().game.keys).toBe(1);
  f.failOn(3);
  await expect(host.resumePending()).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(host.getSnapshot()).toEqual(f.read());
  expect(host.getSnapshot().game.keys).toBe(0);
  f.failOn(0);
  const [first, second] = await Promise.all([host.resumePending(), host.resumePending()]);
  expect(first?.report.revision).toBe(2);
  expect(second).toBeNull();
  expect(f.options.execute).toHaveBeenCalledTimes(1);
});

it('rejects a changed journal result after it has been accepted by the engine', async () => {
  const f = fixture(), host = f.create();
  await host.requestCommands(request);
  await host.resumePending();
  const invalid = f.read();
  invalid.executions[0].result.output = { unlocked: false };
  expect(() => restoreEngineHost(invalid, f.options)).toThrow(/journal/i);
});

it('persists a new game before its first command and restores it with the correct save revision', async () => {
  const f = fixture(), host = f.create();
  expect(f.read()).toBeNull();
  f.failOn(1);
  await expect(host.persist()).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(host.getSnapshot().revision).toBe(0);
  f.failOn(0);
  await host.persist();
  expect(f.read()).toMatchObject({ revision: 1, engine: { revision: 0 } });
  await restoreEngineHost(f.read(), f.options).requestCommands(request);
  expect(f.read()).toMatchObject({ revision: 2, engine: { revision: 1 } });
});

it('synchronizes game state and its program receipt atomically and binds retries to the private input', async () => {
  const f = fixture(), host = f.create();
  const event = { id: 'combat', expectedRevision: 0, source: 'combat', summary: 'Battle ended',
    game: { keys: 2, open: true, privateNote: 'private battle result' }, output: { reward: 1 } };
  f.failOn(1);
  await expect(host.synchronize(event)).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(host.getSnapshot().game).toEqual(initialGame);
  await expect(host.synchronize({ ...event, game: { ...event.game, privateNote: 'different' } }))
    .rejects.toMatchObject({ code: 'persistence_pending' });
  f.failOn(0);
  const commit = await host.synchronize(event);
  expect(f.read()).toMatchObject({ revision: 1, game: event.game, engine: { revision: 1,
    world: { state: { keys: 2 } }, receipts: [{ source: 'combat', output: { reward: 1 } }] } });
  expect(JSON.stringify(f.read().engine)).not.toContain(event.game.privateNote);
  const restored = restoreEngineHost(f.read(), f.options);
  expect(await restored.synchronize(event)).toEqual(commit);
  expect(f.read().revision).toBe(1);
  await expect(restored.synchronize({ ...event, game: { ...event.game, privateNote: 'different' } }))
    .rejects.toMatchObject({ code: 'operation_conflict' });
  await restored.requestCommands({ ...request, expectedRevision: 1 });
  await expect(restored.synchronize({ ...event, id: 'clock', expectedRevision: 2 }))
    .rejects.toMatchObject({ code: 'pending_commands' });
});

it('records a failed independent program as a receipt without accepting state changes', async () => {
  const f = fixture(), host = f.create();
  const event = { id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Clock unavailable', status: 'failed' as const };
  await expect(host.synchronize({ ...event, game: { keys: 99, open: false } })).rejects.toMatchObject({ code: 'invalid_input' });
  expect(f.read()).toBeNull();
  await host.synchronize({ ...event, output: undefined });
  expect(f.read()).toMatchObject({ game: initialGame, engine: { receipts: [{ status: 'failed', message: 'Clock unavailable' }] } });
});

it('rejects substituted or missing sync digests and keeps old unbound snapshots recoverable', async () => {
  const f = fixture(), host = f.create();
  const event = { id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick', game: initialGame };
  const result = await host.synchronize(event);
  const saved = f.read();
  if (saved.version !== 2) throw new Error('Expected a v2 host save');
  expect(host.getStorageStats().synchronizationBytes).toBe(new TextEncoder().encode(JSON.stringify(saved.synchronizations)).byteLength);
  const substituted = structuredClone(saved);
  substituted.synchronizations!.clock = 'f'.repeat(64);
  expect(() => restoreEngineHost(substituted, f.options)).toThrow(/synchronization/i);
  const missing = structuredClone(saved);
  delete missing.synchronizations!.clock;
  expect(() => restoreEngineHost(missing, f.options)).toThrow(/synchronization/i);
  expect(await restoreEngineHost(saved, f.options).synchronize({ ...event, status: 'completed' })).toEqual(result);

  const legacy = structuredClone(saved);
  const old = JSON.parse(legacy.engine.operations[0].fingerprint);
  delete old.hostInputDigest;
  legacy.engine.operations[0].fingerprint = JSON.stringify(old);
  const restored = restoreEngineHost(legacy, f.options);
  expect(restored.getSnapshot().game).toEqual(initialGame);
  await expect(restored.synchronize(event)).rejects.toMatchObject({ code: 'operation_conflict' });
  expect(restored.getSnapshot().engine.revision).toBe(1);
});

it('returns a stable error and leaves the save untouched when Web Crypto is unavailable', async () => {
  const f = fixture(), host = f.create();
  vi.stubGlobal('crypto', undefined);
  try {
    await expect(host.synchronize({ id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick' }))
      .rejects.toMatchObject({ name: 'EngineError', code: 'crypto_unavailable' });
    expect(host.getSnapshot().engine.revision).toBe(0);
    expect(f.read()).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('restores legacy snapshots containing independent engine results saved before host synchronization existed', async () => {
  const { options } = fixture();
  const engine = createEngineSession({ id: 'legacy', world: options.project(initialGame) });
  await engine.synchronize({ id: 'old-clock', expectedRevision: 0, source: 'clock', summary: 'Old clock tick' });
  let saved: EngineHostSnapshot<Game> = {
    format: 'eidos-engine-host', version: 1, revision: 1, game: initialGame, executions: [], engine: engine.getSnapshot(),
  };
  const ports: EngineHostOptions<Game> = { ...options, persistence: { async save(next) { saved = next; } } };
  const input = { id: 'new-clock', expectedRevision: 1, source: 'clock', summary: 'New clock tick' };
  const accepted = await restoreEngineHost(saved, ports).synchronize(input);
  expect(saved.version).toBe(2);
  expect(await restoreEngineHost(saved, ports).synchronize(input)).toEqual(accepted);
});

it('keeps only the requested settled executions while retaining durable pending results and engine retries', async () => {
  const f = fixture(), host = f.create({ maxSettledExecutions: 0 });
  const first = await host.requestCommands(request);
  await host.executePending();
  expect(f.read().executions).toHaveLength(1);
  const restored = restoreEngineHost(f.read(), { ...f.options, maxSettledExecutions: 0 });
  await restored.resumePending();
  const saved = f.read();
  expect(saved).toMatchObject({ version: 2, executions: [], engine: { revision: 2, receipts: [{ requestId: first.commands[0].id }] } });
  expect(f.options.execute).toHaveBeenCalledTimes(1);
  const compact = restoreEngineHost(saved, f.options);
  expect(await compact.requestCommands(request)).toEqual(first);
  expect(await compact.resumePending()).toBeNull();
  expect(compact.getStorageStats()).toMatchObject({ operations: 2, settledExecutions: 0, pendingExecutions: 0,
    snapshotBytes: new TextEncoder().encode(JSON.stringify(saved)).byteLength,
    checkpointBytes: new TextEncoder().encode(JSON.stringify(saved.engine)).byteLength });
});

it('can combine execution and report in one write, retaining the staged result across a failed save', async () => {
  const f = fixture(), host = f.create({ reportSave: 'atomic', maxSettledExecutions: 0 });
  await host.requestCommands(request);
  const before = f.read();
  f.failOn(2);
  await expect(host.resumePending()).rejects.toMatchObject({ code: 'persistence_failed' });
  expect(host.getSnapshot()).toEqual(before);
  expect(f.read()).toEqual(before);
  f.failOn(0);
  const accepted = await host.resumePending();
  expect(accepted?.report.revision).toBe(2);
  expect(f.options.execute).toHaveBeenCalledTimes(1);
  expect(f.read()).toMatchObject({ revision: 2, game: { keys: 0, open: true }, executions: [],
    engine: { revision: 2, pending: [], receipts: [{ status: 'completed' }] } });
  expect(await restoreEngineHost(f.read(), f.options).resumePending()).toBeNull();
});

it('rejects an unreportable result before saving its staged game state and allows a corrected result to resume', async () => {
  const f = fixture();
  let output: JsonValue = 1;
  for (let i = 0; i < 64; i++) output = { item: output };
  const host = f.create({ execute: ({ game }) => ({ status: 'completed', game: { ...game, keys: 0 }, output }) });
  await host.requestCommands(request);
  await expect(host.executePending()).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining('results[0].output') });
  expect(f.read()).toMatchObject({ revision: 1, game: initialGame, executions: [] });
  output = { key: true };
  expect((await host.resumePending())?.report.revision).toBe(2);
  expect(restoreEngineHost(f.read(), f.options).getSnapshot().game.keys).toBe(0);
});

it('restores a durable deep host result and submits it without rerunning the handler', async () => {
  const f = fixture();
  let output: JsonValue = 1;
  for (let i = 0; i < 63; i++) output = { item: output };
  const host = f.create({ execute: ({ game }) => ({ status: 'completed', game, output }) });
  await host.requestCommands(request);
  await host.executePending();
  const saved = JSON.parse(JSON.stringify(f.read()));
  const restored = restoreEngineHost(saved, f.options);
  expect((await restored.resumePending())?.report.receipts[0].output).toEqual(output);
  expect(f.options.execute).not.toHaveBeenCalled();
});
