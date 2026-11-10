import type { EngineCheckpoint, EngineChanges, EngineCommandRequest, EngineCommit, EngineProgramReceipt, EngineReport, EngineSync } from './types';
import { applyEngineChanges } from './world';
import { fields, identifier, invalid, jsonObject, list, object, reference, string } from './validation';

export function makeEngineCommit(operationId: string, revision: number): EngineCommit {
  return { operationId, revision, segments: [], commands: [], receipts: [], events: [] };
}
export function commandReference(sessionId: string, operationId: string, index: number): string {
  return `${encodeURIComponent(sessionId)}/${encodeURIComponent(operationId)}/${index}`;
}
function receiptReference(sessionId: string, kind: string, operationId: string, index = ''): string {
  return `${encodeURIComponent(sessionId)}/receipt/${kind}/${encodeURIComponent(operationId)}/${index}`;
}
export function stageEngineCommands(state: EngineCheckpoint, result: EngineCommit, calls: Array<{ commandId: string; args?: import('./types').JsonObject }>) {
  result.commands = calls.map((call, i): EngineCommandRequest => ({
    id: commandReference(state.id, result.operationId, i),
    operationId: result.operationId, commandId: call.commandId,
    target: structuredClone(state.world.commands[call.commandId].target), args: structuredClone(call.args ?? {}),
  }));
  state.pending = structuredClone(result.commands);
  result.events.push(...result.commands.map(request => ({ type: 'command.requested' as const, request })));
}
export function parseEngineReceipt(raw: unknown, label?: string): EngineProgramReceipt {
  const r = jsonObject(raw, { label }); fields(r, ['id', 'source', 'status', 'requestId', 'commandId', 'output', 'message']);
  reference(r.id); string(r.source, 'source');
  if (r.status !== 'completed' && r.status !== 'failed' && r.status !== 'denied') invalid('Invalid program status');
  if (r.requestId !== undefined) reference(r.requestId);
  if (r.commandId !== undefined) identifier(r.commandId);
  if (r.message !== undefined) string(r.message, 'program message');
  return r as unknown as EngineProgramReceipt;
}
function recordReceipts(state: EngineCheckpoint, result: EngineCommit, receipts: EngineProgramReceipt[]) {
  state.receipts = [...state.receipts, ...receipts]; result.receipts = receipts;
  result.events.push(...receipts.map(receipt => ({ type: 'program.reported' as const, receipt })));
}
function updateWorld(state: EngineCheckpoint, result: EngineCommit, changes?: EngineChanges) {
  if (changes === undefined) return;
  state.world = applyEngineChanges(state.world, changes);
  result.events.push({ type: 'world.updated', changes: structuredClone(changes) });
}
export function reportReceipts(source: { sessionId: string; worldId: string; pending: EngineCommandRequest[] }, operationId: string, input: Pick<EngineReport, 'results' | 'changes'>): EngineProgramReceipt[] {
  const results = list(input.results, 'program results'), pendingById = new Map(source.pending.map(request => [request.id, request]));
  if (!source.pending.length || results.length !== source.pending.length) invalid('Report must cover all pending commands');
  const receipts = results.map((raw, i) => {
    const r = object(raw); fields(r, ['requestId', 'status', 'output', 'message', 'changes']);
    const requestId = string(r.requestId, 'requestId'), pending = pendingById.get(requestId);
    if (!pending) invalid('Unknown or duplicate program request');
    pendingById.delete(requestId);
    if (r.changes !== undefined && r.status !== 'completed') invalid('Failed or denied results cannot change game state');
    const { changes: _changes, ...reported } = r;
    return parseEngineReceipt({ ...reported, id: receiptReference(source.sessionId, 'report', operationId, String(i)), source: pending.target.kind === 'world' ? source.worldId : pending.target.id, commandId: pending.commandId }, `results[${i}]`);
  });
  if (input.changes !== undefined && receipts.some(r => r.status !== 'completed')) invalid('Failed or denied results cannot change game state');
  return receipts;
}
export function acceptEngineReport(state: EngineCheckpoint, result: EngineCommit, input: EngineReport) {
  const receipts = reportReceipts({ sessionId: state.id, worldId: state.world.id, pending: state.pending }, result.operationId, input);
  for (const raw of input.results) updateWorld(state, result, raw.changes);
  updateWorld(state, result, input.changes);
  state.pending = []; recordReceipts(state, result, receipts);
}
export function synchronizeReceipt(sessionId: string, operationId: string, input: EngineSync): EngineProgramReceipt {
  const receipt = parseEngineReceipt({ id: receiptReference(sessionId, 'sync', operationId), source: string(input.source, 'source'), status: input.status === undefined ? 'completed' : input.status, message: string(input.summary, 'summary'),
    ...(input.output === undefined ? {} : { output: input.output }) });
  if (input.changes !== undefined && receipt.status !== 'completed') invalid('Failed or denied results cannot change game state');
  return receipt;
}
export function acceptEngineSync(state: EngineCheckpoint, result: EngineCommit, input: EngineSync) {
  const receipt = synchronizeReceipt(state.id, result.operationId, input);
  updateWorld(state, result, input.changes); recordReceipts(state, result, [receipt]);
}
