import type { EngineCheckpoint, EngineCommandRequest, EngineCommit, EngineTurn } from './types';
import { engineTargetAvailable, parseEngineTarget, parseEngineWorld, publicEngineMap } from './world';
import { parseEngineSegments, parseEngineUsage } from './proposal';
import { parseEngineReceipt } from './operations';
import { readJournalCommit, type JournalCommit } from './journal';
import { captureEngineOperation, worldShape } from './input';
import { canonical, ENGINE_ENVELOPE_DEPTH, fields, identifier, invalid, isEngineDigest, jsonObject, list, object, reference, revision, string } from './validation';

function command(raw: unknown): EngineCommandRequest {
  const c = object(raw); fields(c, ['id', 'operationId', 'commandId', 'target', 'args']);
  reference(c.id); identifier(c.operationId); identifier(c.commandId); jsonObject(c.args); parseEngineTarget(c.target);
  return c as unknown as EngineCommandRequest;
}
function readCommit(raw: unknown, compact: boolean): JournalCommit {
  const c = object(raw);
  fields(c, ['operationId', 'revision', 'segments', 'commands', 'receipts', 'usage', ...(compact ? [] : ['events'])]);
  identifier(c.operationId); revision(c.revision); parseEngineSegments(c.segments);
  list(c.commands).forEach(command); list(c.receipts).forEach(receipt => parseEngineReceipt(receipt));
  if (!compact) list(c.events);
  if (c.usage !== undefined) parseEngineUsage(c.usage);
  return c as unknown as JournalCommit;
}
/** Corruption must not silently reset idempotency or lose in-flight game requests. */
export function parseEngineCheckpoint(raw: unknown): EngineCheckpoint {
  const c = jsonObject(raw, { maxDepth: ENGINE_ENVELOPE_DEPTH, shape: { fields: { world: worldShape } } });
  const compact = c.format === 'eidos-engine-compact';
  if ((!compact && c.format !== 'eidos-engine-session') || c.version !== 1) invalid('Unsupported engine checkpoint');
  fields(c, ['format', 'version', 'id', 'revision', 'world', 'operations', ...(compact ? [] : ['turns', 'pending', 'receipts'])]);
  const id = identifier(c.id), world = parseEngineWorld(c.world);
  revision(c.revision);
  c.world = world as unknown as import('./types').JsonObject;
  const pending = new Map<string, EngineCommandRequest>(), receipts = [], committed = new Map<string, EngineCommit>();
  const expectedTurns: EngineTurn[] = [];
  const operations = list(c.operations);
  if (operations.length !== c.revision) invalid('Checkpoint is missing operation history');
  for (const [i, entry] of operations.entries()) {
    const op = object(entry); fields(op, ['id', 'fingerprint', 'result']); identifier(op.id); string(op.fingerprint, 'fingerprint');
    const saved = readCommit(op.result, compact);
    const { kind, input, narration } = readFingerprint(op.fingerprint as string);
    if (input.id !== op.id || input.expectedRevision !== i) invalid('Invalid checkpoint operation fingerprint');
    const result = readJournalCommit({ sessionId: id, worldId: world.id, pending: [...pending.values()] }, kind, input, saved);
    if (narration === 'receipts' && (!receipts.length || result.commands.length || input.target !== undefined)) invalid('Invalid saved receipt narration');
    if (kind === 'action') {
      const action = { text: string(input.text), ...(input.target === undefined ? {} : { target: parseEngineTarget(input.target) }) };
      expectedTurns.push({ operationId: String(op.id), input: action, segments: result.segments });
    }
    if (committed.has(String(op.id)) || result.operationId !== op.id || result.revision !== i + 1) invalid('Invalid checkpoint operation sequence');
    committed.set(String(op.id), result);
    if (compact) op.result = result;
    for (const req of result.commands) {
      if (pending.has(req.id) || req.operationId !== op.id) invalid('Invalid checkpoint command');
      pending.set(req.id, req);
    }
    for (const r of result.receipts) {
      if (r.requestId) {
        const req = pending.get(r.requestId);
        if (!req || req.commandId !== r.commandId) invalid('Invalid checkpoint program correlation');
        pending.delete(r.requestId);
      }
      receipts.push(r);
    }
  }
  if (pending.size) {
    const map = publicEngineMap(world);
    for (const request of pending.values()) {
      const declared = Object.hasOwn(world.commands, request.commandId) ? world.commands[request.commandId] : undefined;
      // The world cannot change until a pending batch settles. Its declared target is still authoritative.
      if (!declared || declared.enabled === false || canonical(declared.target) !== canonical(request.target) ||
          !engineTargetAvailable(world, declared.target, map)) invalid('Checkpoint pending command does not match the current world');
    }
  }
  if (compact) return {
    ...c, format: 'eidos-engine-session', turns: structuredClone(expectedTurns),
    pending: structuredClone([...pending.values()]), receipts: structuredClone(receipts),
  } as unknown as EngineCheckpoint;
  list(c.pending).forEach(command); list(c.receipts).forEach(receipt => parseEngineReceipt(receipt));
  if (canonical([...pending.values()]) !== canonical(c.pending) || canonical(receipts) !== canonical(c.receipts)) invalid('Checkpoint pending commands or receipts disagree with history');
  const turns = new Set<string>();
  for (const rawTurn of list(c.turns)) {
    const turn = object(rawTurn); fields(turn, ['operationId', 'input', 'segments']); identifier(turn.operationId);
    const input = object(turn.input); fields(input, ['text', 'target']); string(input.text);
    if (input.target !== undefined) parseEngineTarget(input.target);
    parseEngineSegments(turn.segments);
    const result = committed.get(String(turn.operationId));
    if (!result || turns.has(String(turn.operationId)) || canonical(result.segments) !== canonical(turn.segments)) invalid('Invalid checkpoint narrative');
    turns.add(String(turn.operationId));
  }
  if (canonical(expectedTurns) !== canonical(c.turns)) invalid('Checkpoint is missing accepted narrative history');
  return c as unknown as EngineCheckpoint;
}

function readFingerprint(fingerprint: string) {
  let value: unknown;
  try { value = JSON.parse(fingerprint); }
  catch { invalid('Invalid checkpoint operation fingerprint JSON'); }
  const original = object(value);
  fields(original, ['kind', 'input', 'narration', 'hostInputDigest']);
  const { kind, narration, hostInputDigest } = original;
  if (kind !== 'action' && kind !== 'request' && kind !== 'report' && kind !== 'sync') invalid('Invalid checkpoint operation kind');
  if (narration !== undefined && (narration !== 'receipts' || kind !== 'action')) invalid('Invalid checkpoint narration mode');
  if (hostInputDigest !== undefined && (kind !== 'sync' || !isEngineDigest(hostInputDigest))) invalid('Invalid checkpoint host synchronization fingerprint');
  const input = captureEngineOperation(kind, object(original.input));
  if (canonical({ ...original, input }) !== fingerprint) invalid('Invalid checkpoint operation fingerprint');
  return { kind, input, narration };
}
