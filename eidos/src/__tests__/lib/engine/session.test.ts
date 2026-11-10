import { describe, expect, it } from 'vitest';
import { buildEngineContext, createEngineSession, parseEngineNarrationInput, restoreEngineSession, EngineSession, type EngineNarrator, type EnginePersistence, type EngineProposal, type EngineEvent, type JsonValue } from '@/lib/engine';
import { canonical } from '@/lib/engine/validation';
import { courtyardWorld } from './fixtures';

const request = { id: 'open-door', expectedRevision: 0, commands: [{ commandId: 'unlock', args: { key: 'brass' } }] };

it('replays completed synchronization with either spelling before and after restore, including old explicit fingerprints', async () => {
  const session = createEngineSession({ id: 'defaults', world: courtyardWorld() });
  const input = { id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick' };
  const completed = { ...input, status: 'completed' as const };
  const accepted = await session.synchronize(input);
  expect(await session.synchronize(completed)).toEqual(accepted);
  const saved = session.getSnapshot();
  saved.operations[0].fingerprint = canonical({ kind: 'sync', input: completed });
  const restored = restoreEngineSession(saved);
  expect(await restored.synchronize(input)).toEqual(accepted);
  expect(await restored.synchronize(completed)).toEqual(accepted);
  await expect(restored.synchronize({ ...input, status: 'failed' })).rejects.toMatchObject({ code: 'operation_conflict' });
  expect(restored.getSnapshot().revision).toBe(1);
});

it('uses a custom receipt instruction while retaining the command guard and operation idempotency', async () => {
  let calls = 0;
  const instruction = 'Describe the observed result in English.';
  const session = createEngineSession({ id: 'localized-receipts', world: courtyardWorld(), narrator: {
    async generate({ input }) {
      expect(input.text).toBe(instruction);
      calls++;
      return calls === 1 ? { segments: [], commands: [{ commandId: 'unlock' }] }
        : { segments: [{ type: 'narration', text: 'The clock advanced.' }] };
    },
  } });
  await session.synchronize({ id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick' });
  const input = { id: 'prose', expectedRevision: 1, instruction };
  await expect(session.narrateReceipts({ ...input, instruction: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(session.narrateReceipts(input)).rejects.toMatchObject({ code: 'invalid_proposal' });
  expect(session.getSnapshot()).toMatchObject({ revision: 1, pending: [] });
  const result = await session.narrateReceipts(input);
  const restored = restoreEngineSession(session.getSnapshot());
  expect(await restored.narrateReceipts(input)).toEqual(result);
  await expect(restored.narrateReceipts({ ...input, instruction: 'Summarize in Spanish.' })).rejects.toMatchObject({ code: 'operation_conflict' });
  expect(calls).toBe(2);
});

it('narrates receipts without accepting new commands and replays the prose after restore', async () => {
  let proposes = true, calls = 0;
  const session = createEngineSession({ id: 'receipt-prose', world: courtyardWorld(), narrator: {
    async generate({ context }) {
      calls++;
      expect(context.receipts.at(-1)?.message).toBe('Tick');
      return { segments: [{ type: 'narration', text: 'The clock ticks.' }], ...(proposes ? { commands: [{ commandId: 'unlock' }] } : {}) };
    },
  } });
  const input = { id: 'prose', expectedRevision: 1 };
  await expect(session.narrateReceipts({ ...input, expectedRevision: 0 })).rejects.toMatchObject({ code: 'missing_receipts' });
  expect(calls).toBe(0);
  await session.synchronize({ id: 'clock', expectedRevision: 0, source: 'clock', summary: 'Tick' });
  await expect(session.narrateReceipts(input)).rejects.toMatchObject({ code: 'invalid_proposal' });
  expect(session.getSnapshot()).toMatchObject({ revision: 1, pending: [] });
  proposes = false;
  const result = await session.narrateReceipts(input);
  expect(result.segments[0].text).toBe('The clock ticks.');
  expect(await restoreEngineSession(session.getSnapshot()).narrateReceipts(input)).toEqual(result);
  expect(calls).toBe(2);
});

it('restores accepted deep receipts and can send them through the narration transport', async () => {
  let output: JsonValue = 1;
  for (let i = 0; i < 60; i++) output = { item: output };
  const session = createEngineSession({ id: 'deep', world: courtyardWorld() });
  const pending = await session.requestCommands(request);
  const input = { id: 'result', expectedRevision: 1, results: [{ requestId: pending.commands[0].id, status: 'completed' as const, output }] };
  const accepted = await session.report(input);
  const saved = JSON.parse(JSON.stringify(session.getSnapshot()));
  expect(await restoreEngineSession(saved).report(input)).toEqual(accepted);
  expect(parseEngineNarrationInput({ context: buildEngineContext(saved), input: { text: 'Look' } }).context.receipts[0].output).toEqual(output);
});

it('reports an invalid_input error for malformed IDs, receipts and saved fingerprints', async () => {
  const session = createEngineSession({ id: 'strict', world: courtyardWorld() });
  await expect(session.requestCommands({ ...request, id: '\ud800' })).rejects.toMatchObject({ code: 'invalid_input' });
  await session.requestCommands({ ...request, id: '😀' });
  const saved = session.getSnapshot();
  const result = { requestId: saved.pending[0].id, status: ['completed'] };
  await expect(session.report({ id: 'result', expectedRevision: 1, results: [result] } as never))
    .rejects.toMatchObject({ code: 'invalid_input' });
  expect(session.getSnapshot()).toEqual(saved);
  saved.operations[0].fingerprint = '{';
  expect(() => restoreEngineSession(saved)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});

it('normalizes optional world fields at session creation without omitting opaque data', () => {
  const world = courtyardWorld();
  world.description = undefined;
  world.scenes.hall.visible = undefined;
  world.components.door.description = undefined;
  world.commands.unlock.parameters = undefined;
  world.map.nodes.entrance.position!.z = undefined;
  const actual = createEngineSession({ id: 'world', world }).getSnapshot().world;
  expect(actual).toEqual(courtyardWorld());
  expect(() => createEngineSession({ id: 'world', world: { ...world, state: { broken: undefined } } } as never))
    .toThrow(/world\.state\.broken/);
});

it('treats explicit undefined on optional SDK fields as omission before computing the retry fingerprint', async () => {
  const session = createEngineSession({ id: 'optional', world: courtyardWorld(), narrator: {
    async generate() { return { segments: [{ type: 'narration', text: '门还锁着。', speakerId: undefined }], commands: undefined }; },
  } });
  const action = { id: 'look', expectedRevision: 0, text: '看门' };
  const first = await session.act({ ...action, target: undefined });
  expect(await session.act(action)).toEqual(first);
  const requested = await session.requestCommands({ id: 'unlock', expectedRevision: 1, commands: [{ commandId: 'unlock', args: undefined }] });
  const result = { requestId: requested.commands[0].id, status: 'completed' as const };
  const report = { id: 'report', expectedRevision: 2, results: [{ ...result, output: undefined, changes: { state: undefined } }] };
  await session.report(report);
  const restored = restoreEngineSession(session.getSnapshot());
  expect(await restored.report({ ...report, results: [{ ...result, changes: {} }] })).toMatchObject({ revision: 3 });
});

it('reports the invalid JSON field without stripping data or accepting unknown fields', async () => {
  const session = createEngineSession({ id: 'strict', world: courtyardWorld() });
  const requested = await session.requestCommands(request);
  const result = { requestId: requested.commands[0].id, status: 'completed' as const };
  const report = { id: 'report', expectedRevision: 1 };
  for (const [entry, path] of [
    [{ ...result, output: { contents: [undefined] } }, 'results[0].output.contents[0]'],
    [{ ...result, output: { contents: { message: undefined } } }, 'results[0].output.contents.message'],
    [{ ...result, invented: undefined }, 'results[0].invented'],
    [{ ...result, requestId: undefined }, 'results[0].requestId'],
  ] as const) {
    await expect(session.report({ ...report, results: [entry] } as unknown as Parameters<typeof session.report>[0]))
      .rejects.toMatchObject({ code: 'invalid_input', message: expect.stringContaining(path) });
  }
  expect(session.getSnapshot().revision).toBe(1);
});

describe('headless game session', () => {
  it('accepts actual program results before narrating their effects', async () => {
    const observed: unknown[] = [];
    const narrator: EngineNarrator = { async generate(input) {
      observed.push(input);
      return { segments: [{ type: 'dialogue', speakerId: 'guide', text: '门已经打开了。' }] };
    } };
    const session = createEngineSession({ id: 'game', world: courtyardWorld(), narrator });
    const requested = await session.requestCommands(request);
    expect(session.getSnapshot().world.components.door.state.open).toBe(false);
    expect(requested.events[0].type).toBe('command.requested');
    const map = courtyardWorld().map; map.edges.path.blocked = false;
    const result = await session.report({ id: 'program-one', expectedRevision: 1,
      results: [{ requestId: requested.commands[0].id, status: 'completed', output: { unlocked: true } }],
      changes: { state: { keys: 0 }, components: [{ ...courtyardWorld().components.door, state: { open: true } }], map },
    });
    expect(result.revision).toBe(2);
    expect(session.getSnapshot().world.state.keys).toBe(0);
    expect(session.getSnapshot().pending).toEqual([]);
    const prose = await session.act({ id: 'reaction', expectedRevision: 2, text: '描述开门后的反应' });
    expect(prose.segments[0].text).toBe('门已经打开了。');
    expect(observed).toMatchObject([{ context: { scene: { id: 'hall' }, components: { door: { state: { open: true } } }, receipts: [{ output: { unlocked: true } }] } }]);
    expect(session.getSnapshot().world.components.door.state.open).toBe(true);
  });

  it('supports model-proposed commands without executing a game program', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld(), narrator: {
      async generate() { return { segments: [], commands: [{ commandId: 'unlock', args: { key: 'brass' } }] }; },
    } });
    const result = await session.act({ id: 'action', expectedRevision: 0, text: '用钥匙开门' });
    expect(result.commands).toMatchObject([{ commandId: 'unlock', operationId: 'action', target: { kind: 'component', id: 'door' } }]);
    expect(session.getSnapshot().world.state.keys).toBe(1);
    await expect(session.act({ id: 'next', expectedRevision: 1, text: '继续' })).rejects.toMatchObject({ code: 'pending_commands' });
  });

  it('preserves failed output as evidence without changing the game', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const result = await session.requestCommands(request);
    await session.report({ id: 'failure', expectedRevision: 1, results: [{ requestId: result.commands[0].id, status: 'failed', message: '钥匙不匹配', output: { error: 'wrong_key' } }] });
    expect(session.getSnapshot().world.state.keys).toBe(1);
    expect(session.getSnapshot().receipts[0]).toMatchObject({ status: 'failed', message: '钥匙不匹配' });
  });

  it('accepts successful effects in a mixed result batch while retaining failures', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const requested = await session.requestCommands({ ...request, commands: [{ commandId: 'unlock' }, { commandId: 'talk' }] });
    await session.report({ id: 'mixed', expectedRevision: 1, results: [
      { requestId: requested.commands[0].id, status: 'completed', changes: { state: { keys: 0 } } },
      { requestId: requested.commands[1].id, status: 'failed', message: '向导正忙' },
    ] });
    expect(session.getSnapshot().world.state.keys).toBe(0);
    expect(session.getSnapshot().receipts.map(r => r.status)).toEqual(['completed', 'failed']);
  });

  it('reports a failed independent program without fabricating a completed outcome', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.synchronize({ id: 'combat', expectedRevision: 0, source: 'combat', status: 'failed', summary: '战斗程序未完成', output: { error: 'timeout' } });
    expect(session.getSnapshot().receipts[0].status).toBe('failed');
    expect(session.getSnapshot().world.state.keys).toBe(1);
  });

  it('rejects effects attached to a failed result', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const result = await session.requestCommands(request), before = session.getSnapshot();
    await expect(session.report({ id: 'bad', expectedRevision: 1, results: [{ requestId: result.commands[0].id, status: 'denied' }], changes: { state: { keys: 0 } } })).rejects.toThrow();
    expect(session.getSnapshot()).toEqual(before);
  });

  it('restores pending commands and deduplicates both command and result after saving', async () => {
    const first = createEngineSession({ id: 'one', world: courtyardWorld() });
    const command = await first.requestCommands(request);
    const restored = restoreEngineSession(JSON.parse(JSON.stringify(first.getSnapshot())));
    expect(await restored.requestCommands(request)).toEqual(command);
    const report = { id: 'reported', expectedRevision: 1, results: [{ requestId: command.commands[0].id, status: 'completed' as const }], changes: { state: { keys: 0 } } };
    const accepted = await restored.report(report);
    const again = restoreEngineSession(restored.getSnapshot());
    expect(await again.report(report)).toEqual(accepted);
    expect(again.getSnapshot().revision).toBe(2);
    expect(again.getSnapshot().receipts).toHaveLength(1);
  });

  it('refuses a reused operation ID with different content before stale-version handling', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.requestCommands(request);
    await expect(session.requestCommands({ ...request, commands: [{ commandId: 'talk' }] })).rejects.toMatchObject({ code: 'operation_conflict' });
  });

  it('rejects incomplete, duplicate and foreign program receipts atomically', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const result = await session.requestCommands({ ...request, commands: [{ commandId: 'unlock' }, { commandId: 'talk' }] });
    const before = session.getSnapshot();
    for (const ids of [[], [result.commands[0].id], ['foreign', result.commands[1].id], [result.commands[0].id, result.commands[0].id]]) {
      await expect(session.report({ id: 'bad', expectedRevision: 1, results: ids.map(requestId => ({ requestId, status: 'completed' as const })) })).rejects.toThrow();
      expect(session.getSnapshot()).toEqual(before);
    }
  });

  it('reports independent game programs and scene transitions through the same checkpoint', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const map = courtyardWorld().map; map.edges.path.blocked = false;
    await session.synchronize({ id: 'combat', expectedRevision: 0, source: 'combat-system', summary: '战斗结束，玩家进入庭院。', output: { winner: 'player', damage: 0 }, changes: { currentSceneId: 'garden', state: { health: 100 }, map } });
    expect(session.getSnapshot()).toMatchObject({ revision: 1, world: { currentSceneId: 'garden', state: { health: 100 } }, receipts: [{ source: 'combat-system', output: { winner: 'player', damage: 0 } }] });
  });

  it('serializes simultaneous calls using the same expected revision', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const results = await Promise.allSettled([session.synchronize({ id: 'a', expectedRevision: 0, source: 'clock', summary: '时间推进', changes: { state: { hour: 9 } } }), session.synchronize({ id: 'b', expectedRevision: 0, source: 'clock', summary: '旧时间推进', changes: { state: { hour: 10 } } })]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(session.getSnapshot().world.state).toEqual({ hour: 9 });
  });

  it('isolates concurrently running game sessions', async () => {
    const a = createEngineSession({ id: 'a', world: courtyardWorld() }), b = createEngineSession({ id: 'b', world: courtyardWorld() });
    await Promise.all([a.requestCommands(request), b.synchronize({ id: 'clock', expectedRevision: 0, source: 'clock', summary: '时间推进', changes: { state: { hour: 9 } } })]);
    expect(a.getSnapshot().pending).toHaveLength(1);
    expect(a.getSnapshot().world.state.keys).toBe(1);
    expect(b.getSnapshot().pending).toHaveLength(0);
    expect(b.getSnapshot().world.state.hour).toBe(9);
  });

  it('retries only persistence after an accepted model candidate failed to save', async () => {
    let calls = 0, writes = 0;
    const persistence: EnginePersistence = { async save() { if (++writes === 1) throw new Error('disk full'); } };
    const session = createEngineSession({ id: 'one', world: courtyardWorld(), persistence, narrator: { async generate() { calls++; return { segments: [{ type: 'narration', text: '门还锁着。' }] }; } } });
    const action = { id: 'look', expectedRevision: 0, text: '看门' };
    await expect(session.act(action)).rejects.toMatchObject({ code: 'persistence_failed' });
    expect(session.getSnapshot().revision).toBe(0);
    await expect(session.requestCommands(request)).rejects.toMatchObject({ code: 'persistence_pending' });
    const accepted = await session.act(action);
    expect(accepted.revision).toBe(1);
    expect(calls).toBe(1); expect(writes).toBe(2);
  });

  it('does not let a persistence adapter mutate the accepted checkpoint', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld(), persistence: { async save(checkpoint, previous) {
      expect(previous).toBe(0); checkpoint.world.state.keys = 99;
    } } });
    await session.requestCommands(request);
    expect(session.getSnapshot().world.state.keys).toBe(1);
  });

  it('captures queued caller input before the caller can mutate it', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const input = { id: 'click', expectedRevision: 0, commands: [{ commandId: 'unlock', args: { key: 'brass' } }] };
    const work = session.requestCommands(input);
    input.commands[0].commandId = 'secret'; input.commands[0].args.key = 'changed';
    const result = await work;
    expect(result.commands[0]).toMatchObject({ commandId: 'unlock', args: { key: 'brass' } });
  });

  it('discards late generation after cancellation even if a narrator ignores AbortSignal', async () => {
    let finish!: (value: { segments: { type: 'narration'; text: string }[] }) => void;
    const session = createEngineSession({ id: 'one', world: courtyardWorld(), narrator: { generate: () => new Promise(resolve => { finish = resolve; }) } });
    const controller = new AbortController();
    const work = session.act({ id: 'look', expectedRevision: 0, text: '看门' }, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
    await expect(work).rejects.toMatchObject({ code: 'aborted' });
    finish({ segments: [{ type: 'narration', text: '迟到结果' }] });
    expect(session.getSnapshot().revision).toBe(0);
  });

  it.each(['secret', 'travel', 'unknown'])('rejects unavailable commands without a state change: %s', async commandId => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await expect(session.requestCommands({ ...request, commands: [{ commandId }] })).rejects.toThrow();
    expect(session.getSnapshot().revision).toBe(0);
  });

  it('rejects model state writes and unknown speakers', async () => {
    for (const proposal of [{ segments: [{ type: 'narration', text: '开门' }], state: { keys: 0 } }, { segments: [{ type: 'dialogue', speakerId: 'secret', text: '答案' }] }]) {
      const session = createEngineSession({ id: 'one', world: courtyardWorld(), narrator: { async generate() { return proposal as EngineProposal; } } });
      await expect(session.act({ id: 'bad', expectedRevision: 0, text: '开门' })).rejects.toThrow();
      expect(session.getSnapshot().revision).toBe(0);
    }
  });

  it('rejects malformed or mismatched pending checkpoints', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.requestCommands(request);
    const saved = session.getSnapshot(); saved.pending[0].commandId = 'talk';
    expect(() => restoreEngineSession(saved)).toThrow();
    expect(() => restoreEngineSession({ ...session.getSnapshot(), version: 2 })).toThrow();
  });

  it('rejects a coordinated change to a pending command target before resuming it', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.requestCommands(request);
    const saved = JSON.parse(JSON.stringify(session.getSnapshot()));
    const target = { kind: 'component', id: 'guide' };
    saved.pending[0].target = target;
    saved.operations[0].result.commands[0].target = target;
    saved.operations[0].result.events[0].request.target = target;
    expect(() => restoreEngineSession(saved)).toThrow(/pending.*world/i);
  });

  it('round-trips maximum-length Unicode IDs in generated program references', async () => {
    const session = createEngineSession({ id: '庭'.repeat(256), world: courtyardWorld() });
    const requested = await session.requestCommands({ ...request, id: '门'.repeat(256) });
    const restored = restoreEngineSession(session.getSnapshot());
    await restored.report({ id: 'result', expectedRevision: 1, results: [{ requestId: requested.commands[0].id, status: 'completed' }] });
    expect(restoreEngineSession(restored.getSnapshot()).getSnapshot().revision).toBe(2);
  });
  it('rejects a checkpoint that lost accepted narrative history', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld(), narrator: { async generate() { return { segments: [{ type: 'narration', text: '门厅很安静。' }] }; } } });
    await session.act({ id: 'look', expectedRevision: 0, text: '观察' });
    const checkpoint = session.getSnapshot(); checkpoint.turns = [];
    expect(() => restoreEngineSession(checkpoint)).toThrow();
  });
  it('rejects malformed saved commit events before exposing a duplicate-operation result', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.requestCommands(request);
    const checkpoint = session.getSnapshot();
    checkpoint.operations[0].result.events = [42] as unknown as EngineEvent[];
    expect(() => restoreEngineSession(checkpoint)).toThrow();
  });
  it('keeps receipt IDs unique across reports and independent program operations', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const command = await session.requestCommands(request);
    await session.report({ id: 'result', expectedRevision: 1, results: [{ requestId: command.commands[0].id, status: 'completed' }] });
    await session.synchronize({ id: 'result/0', expectedRevision: 2, source: 'clock', summary: '时间推进' });
    const ids = session.getSnapshot().receipts.map(r => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(restoreEngineSession(session.getSnapshot()).getSnapshot().receipts).toHaveLength(2);
  });
  it('rejects a fingerprint whose arguments contradict its saved command result', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    await session.requestCommands(request);
    const checkpoint = session.getSnapshot(), original = JSON.parse(checkpoint.operations[0].fingerprint);
    original.input.commands[0].args.key = 'wrong';
    checkpoint.operations[0].fingerprint = JSON.stringify(original);
    expect(() => restoreEngineSession(checkpoint)).toThrow();
  });
  it('rejects a fingerprint whose output contradicts its saved program receipt', async () => {
    const session = createEngineSession({ id: 'one', world: courtyardWorld() });
    const command = await session.requestCommands(request);
    await session.report({ id: 'result', expectedRevision: 1, results: [{ requestId: command.commands[0].id, status: 'completed', output: { delivered: true } }] });
    const checkpoint = session.getSnapshot(), original = JSON.parse(checkpoint.operations[1].fingerprint);
    original.input.results[0].output.delivered = false;
    // Preserve canonical key order; this is a semantic contradiction, not a JSON formatting test.
    checkpoint.operations[1].fingerprint = JSON.stringify(original);
    expect(() => restoreEngineSession(checkpoint)).toThrow();
  });
  it('owns a validated checkpoint even when constructed directly', () => {
    const checkpoint = createEngineSession({ id: 'one', world: courtyardWorld() }).getSnapshot();
    const session = new EngineSession(checkpoint, {});
    checkpoint.world.state.keys = 900;
    expect(session.getSnapshot().world.state.keys).toBe(1);
  });
});
