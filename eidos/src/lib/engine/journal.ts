import type { EngineCommandRequest, EngineCommit, EngineEvent, EngineReport, EngineSync } from './types';
import { commandReference, reportReceipts, synchronizeReceipt } from './operations';
import { assertStoredEngineChanges } from './world';
import { canonical, fields, identifier, invalid, jsonObject, list, object } from './validation';

interface JournalSource { sessionId: string; worldId: string; pending: EngineCommandRequest[] }
export type JournalCommit = Omit<EngineCommit, 'events'> & { events?: EngineEvent[] };
const operationFields: Record<string, string[]> = {
  action: ['text', 'target'], request: ['commands'], report: ['results', 'changes'], sync: ['source', 'summary', 'status', 'output', 'changes'],
};
function expectedEvents(kind: string, input: Record<string, unknown>, result: JournalCommit): EngineEvent[] {
  const events: EngineEvent[] = [];
  if (kind === 'action' && result.segments.length) events.push({ type: 'narrative.committed', segments: result.segments });
  events.push(...result.commands.map(request => ({ type: 'command.requested' as const, request })));
  const resultChanges = kind === 'report' ? list(input.results).map(raw => object(raw).changes) : [];
  for (const changes of [...resultChanges, input.changes]) {
    if (changes === undefined) continue;
    assertStoredEngineChanges(changes);
    events.push({ type: 'world.updated', changes });
  }
  events.push(...result.receipts.map(receipt => ({ type: 'program.reported' as const, receipt })));
  return events;
}
function assertRequestedCommands(input: Record<string, unknown>, result: JournalCommit) {
  const calls = list(input.commands).map(raw => {
    const c = object(raw); fields(c, ['commandId', 'args']);
    return { commandId: identifier(c.commandId), args: c.args === undefined ? {} : jsonObject(c.args) };
  });
  const saved = result.commands.map(c => ({ commandId: c.commandId, args: c.args }));
  if (!calls.length || new Set(calls.map(c => c.commandId)).size !== calls.length || canonical(calls) !== canonical(saved)) invalid('Checkpoint request arguments contradict its saved commands');
}
/** Validate the journal before it can act as an idempotent response, rebuilding events for compact saves. */
export function readJournalCommit(source: JournalSource, kind: string, input: Record<string, unknown>, result: JournalCommit): EngineCommit {
  fields(input, ['id', 'expectedRevision', ...operationFields[kind]]);
  for (const [index, command] of result.commands.entries()) {
    if (command.id !== commandReference(source.sessionId, result.operationId, index)) invalid('Invalid saved command reference');
  }
  if (kind === 'request') assertRequestedCommands(input, result);
  if (kind !== 'action' && (result.segments.length || result.usage)) invalid('Only narrative operations can contain prose or usage');
  if (kind === 'action' || kind === 'request') {
    if (source.pending.length || result.receipts.length || !result.segments.length && !result.commands.length) invalid('Invalid saved interaction result');
  } else {
    if (result.commands.length) invalid('Program results cannot request commands');
    const expected = kind === 'report' ? reportReceipts(source, result.operationId, input as unknown as EngineReport)
      : [synchronizeReceipt(source.sessionId, result.operationId, input as unknown as EngineSync)];
    if (kind === 'sync' && source.pending.length) invalid('Cannot synchronize while program commands are pending');
    if (canonical(expected) !== canonical(result.receipts)) invalid('Checkpoint program output contradicts its saved receipts');
  }
  const events = expectedEvents(kind, input, result);
  if (result.events === undefined) return { ...result, events: structuredClone(events) };
  if (canonical(events) !== canonical(result.events)) invalid('Checkpoint commit events contradict their operation');
  return result as EngineCommit;
}
