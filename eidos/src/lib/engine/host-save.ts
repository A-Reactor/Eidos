import type { EngineHostExecution, EngineHostSnapshot, EngineHostStorageStats } from './host-types';
import type { EngineCheckpoint, EngineProgramResult, EngineWorld } from './types';
import { reportReceipts } from './operations';
import { parseEngineCheckpoint } from './checkpoint';
import { canonical, ENGINE_ENVELOPE_DEPTH, fields, invalid, isEngineDigest, json, jsonObject, list, object, revision } from './validation';
import { applyEngineChanges, parseEngineWorld } from './world';
import { captureEngineOperation, worldShape } from './input';

function indexHostJournal(engine: EngineCheckpoint) {
  const accepted = new Map<string, EngineProgramResult>();
  const syncs = new Map<string, string | undefined>();
  for (const operation of engine.operations) {
    const entry = JSON.parse(operation.fingerprint);
    if (entry.kind === 'sync') syncs.set(operation.id, entry.hostInputDigest);
    if (entry.kind === 'report') {
      for (const result of entry.input.results as EngineProgramResult[]) accepted.set(result.requestId, result);
    }
  }
  return { accepted, syncs };
}

function readExecutions(raw: unknown, engine: EngineCheckpoint, version: 1 | 2, accepted: Map<string, EngineProgramResult>): EngineHostExecution[] {
  const requests = new Map(engine.operations.flatMap(op => op.result.commands).map(request => [request.id, request]));
  const pending = new Set(engine.pending.map(request => request.id));
  const seen = new Set<string>();
  const executions = list(raw, 'execution journal').map(value => {
    const entry = object(value, 'execution journal entry');
    fields(entry, ['request', 'result']);
    const id = object(entry.request).id as string;
    const request = requests.get(id);
    if (!request || seen.has(id) || canonical(entry.request) !== canonical(request)) invalid('Execution journal contains an unknown or duplicate request');
    seen.add(id);
    const result = object(entry.result) as unknown as EngineProgramResult;
    reportReceipts({ sessionId: engine.id, worldId: engine.world.id, pending: [request] }, 'validate', { results: [result] });
    if (!pending.has(id) && (!accepted.has(id) || canonical(result) !== canonical(accepted.get(id)))) {
      invalid('Execution journal contradicts the accepted engine result');
    }
    return { request, result };
  });
  if (version === 1 && [...accepted.keys()].some(id => !seen.has(id))) invalid('Execution journal is missing accepted results');
  return executions;
}

function readSynchronizations(raw: unknown, operations: Map<string, string | undefined>): Record<string, string> {
  const saved = object(raw, 'host synchronizations');
  for (const [id, fingerprint] of Object.entries(saved)) {
    if (!operations.has(id) || !isEngineDigest(fingerprint)) invalid('Invalid host synchronization fingerprint');
  }
  const verified: Array<[string, string]> = [];
  for (const [id, expected] of operations) {
    // Older saves carried unbound hashes. Keep their accepted state but never use those hashes to authorize replay.
    if (expected === undefined) continue;
    if (!Object.hasOwn(saved, id) || saved[id] !== expected) invalid('Host synchronization fingerprint does not match the engine journal');
    verified.push([id, expected]);
  }
  return Object.fromEntries(verified);
}

export function retainExecutions<Game>(snapshot: EngineHostSnapshot<Game>, limit: number): EngineHostSnapshot<Game> {
  if (snapshot.executions.length <= limit) return snapshot;
  const pending = new Set(snapshot.engine.pending.map(request => request.id));
  const recorded = new Set(snapshot.executions.map(entry => entry.request.id));
  const settled = snapshot.engine.receipts.flatMap(receipt =>
    receipt.requestId && recorded.has(receipt.requestId) ? [receipt.requestId] : []);
  const keep = new Set(settled.slice(Math.max(0, settled.length - limit)));
  const executions = snapshot.executions.filter(entry => pending.has(entry.request.id) || keep.has(entry.request.id));
  if (executions.length === snapshot.executions.length) return snapshot;
  return { ...snapshot, version: 2, synchronizations: snapshot.synchronizations ?? {}, executions };
}

export function hostStorageStats<Game>(snapshot: EngineHostSnapshot<Game>): EngineHostStorageStats {
  const encoder = new TextEncoder();
  const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  const pendingExecutions = pendingEngineResults(snapshot.engine, snapshot.executions).length;
  const synchronizations = snapshot.synchronizations;
  return {
    snapshotBytes: size(snapshot), checkpointBytes: size(snapshot.engine), executionJournalBytes: size(snapshot.executions),
    ...(synchronizations && Object.keys(synchronizations).length ? { synchronizationBytes: size(synchronizations) } : {}),
    operations: snapshot.engine.operations.length, settledExecutions: snapshot.executions.length - pendingExecutions, pendingExecutions,
  };
}

export function pendingEngineResults(engine: EngineCheckpoint, executions: EngineHostExecution[]): EngineProgramResult[] {
  const recorded = new Map(executions.map(entry => [entry.request.id, entry.result]));
  const results = engine.pending.flatMap(request => {
    const result = recorded.get(request.id);
    return result ? [result] : [];
  });
  if (results.length && results.length !== engine.pending.length) invalid('Execution journal contains a partial pending batch');
  return results;
}

export function readEngineHostSnapshot<Game>(raw: unknown, project: (game: Game) => EngineWorld): EngineHostSnapshot<Game> {
  const data = jsonObject(raw, { maxDepth: ENGINE_ENVELOPE_DEPTH, shape: { fields: { engine: { fields: { world: worldShape } } } } });
  const { version } = data;
  if (data.format !== 'eidos-engine-host' || (version !== 1 && version !== 2) || !Object.hasOwn(data, 'game')) invalid('Unsupported engine host save');
  fields(data, ['format', 'version', 'revision', 'game', 'executions', 'engine', ...(version === 2 ? ['synchronizations'] : [])]);
  const engine = parseEngineCheckpoint(data.engine), saveRevision = revision(data.revision);
  if (saveRevision < engine.revision) invalid('Host save revision precedes the engine revision');
  const { accepted, syncs } = indexHostJournal(engine);
  const synchronizations = readSynchronizations(version === 2 ? data.synchronizations : {}, syncs);
  const executions = readExecutions(data.executions, engine, version, accepted);
  const results = pendingEngineResults(engine, executions);
  if (results.length && saveRevision === engine.revision) invalid('Pending execution was not recorded in a separate save');
  const game = json(data.game, { label: 'game' }) as Game;
  if (results.length) captureEngineOperation('report', { id: 'validate', expectedRevision: engine.revision, results });
  // An executed, unreported batch changes the game before the engine accepts the results.
  let expected = engine.world;
  for (const result of results) if (result.changes) expected = applyEngineChanges(expected, result.changes);
  if (canonical(expected) !== canonical(parseEngineWorld(project(structuredClone(game))))) {
    invalid('Game projection does not match the engine checkpoint and execution journal');
  }
  const snapshot = { format: data.format, revision: saveRevision, game, engine, executions } as const;
  return version === 2 ? { ...snapshot, version, synchronizations } : { ...snapshot, version };
}
