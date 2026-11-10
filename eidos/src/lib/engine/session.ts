import type { EngineAction, EngineCheckpoint, EngineCommandInput, EngineCommit, EngineNarrator, EngineOperation, EngineOperationInput, EnginePersistence, EngineReceiptNarrationInput, EngineReport, EngineSync, EngineWorld } from './types';
import { parseEngineTarget, engineTargetAvailable } from './world';
import { buildEngineContext, ENGINE_RECEIPT_NARRATION_INPUT, type EngineContextOptions } from './context';
import { parseEngineCalls, parseEngineProposal } from './proposal';
import { acceptEngineReport, acceptEngineSync, makeEngineCommit, stageEngineCommands } from './operations';
import { parseEngineCheckpoint } from './checkpoint';
import { canonical, EngineError, fields, identifier, invalid, isEngineDigest, revision, string } from './validation';
import { captureEngineOperation, captureReceiptNarration, type EngineOperationKind } from './input';

export interface EngineSessionOptions { narrator?: EngineNarrator; persistence?: EnginePersistence; context?: EngineContextOptions }
interface Prepared { next: EngineCheckpoint; operation: EngineOperation }
interface OperationOptions { signal?: AbortSignal; narration?: 'receipts'; hostInputDigest?: string }
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new EngineError('aborted', 'Engine operation was canceled');
}
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new EngineError('aborted', 'Engine operation was canceled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export class EngineSession {
  private queue: Promise<unknown> = Promise.resolve();
  private prepared?: Prepared;
  private state: EngineCheckpoint;
  private readonly operationsById: Map<string, EngineOperation>;
  constructor(checkpoint: unknown, private readonly options: EngineSessionOptions = {}) {
    this.state = parseEngineCheckpoint(checkpoint);
    this.operationsById = new Map(this.state.operations.map(operation => [operation.id, operation]));
  }
  getSnapshot(): EngineCheckpoint { return structuredClone(this.state); }

  act(input: EngineAction, options: { signal?: AbortSignal } = {}): Promise<EngineCommit> {
    return this.narrate(input, { signal: options.signal });
  }

  /** Continue from actual receipts and reject any proposal that would start another command batch. */
  async narrateReceipts(input: EngineReceiptNarrationInput, options: { signal?: AbortSignal } = {}): Promise<EngineCommit> {
    const { instruction, ...operation } = captureReceiptNarration(input);
    return this.narrate({ ...operation, text: instruction ?? ENGINE_RECEIPT_NARRATION_INPUT },
      { signal: options.signal, narration: 'receipts' });
  }

  private narrate(input: EngineAction, options: OperationOptions): Promise<EngineCommit> {
    return this.operate('action', input, ['text', 'target'], async (next, result, operation) => {
      this.requireSettled(next);
      if (!this.options.narrator) throw new EngineError('narrator_unavailable', 'No narrator configured');
      const context = buildEngineContext(next, this.options.context), action = { text: string(operation.text), ...(operation.target === undefined ? {} : { target: parseEngineTarget(operation.target, next.world) }) };
      if (action.target && !engineTargetAvailable(next.world, action.target, context.map)) invalid('Interaction target is unavailable');
      if (options.narration === 'receipts' && !context.receipts.length) throw new EngineError('missing_receipts', 'No program receipts are available for narration');
      const requestOptions = { signal: options.signal };
      const proposal = parseEngineProposal(await abortable(this.options.narrator.generate(structuredClone({ context, input: action }), requestOptions), options.signal), context);
      checkAbort(options.signal);
      if (options.narration === 'receipts' && proposal.commands?.length) {
        const error = new EngineError('invalid_proposal', 'Receipt narration cannot request new commands');
        error.usage = proposal.usage;
        throw error;
      }
      result.segments = proposal.segments;
      if (proposal.usage) result.usage = proposal.usage;
      if (proposal.segments.length) result.events.push({ type: 'narrative.committed', segments: proposal.segments });
      stageEngineCommands(next, result, proposal.commands ?? []);
      next.turns = [...next.turns, { operationId: operation.id, input: action, segments: proposal.segments }];
    }, options);
  }

  requestCommands(input: EngineCommandInput): Promise<EngineCommit> {
    return this.operate('request', input, ['commands'], (next, result, operation) => {
      this.requireSettled(next);
      const calls = parseEngineCalls(operation.commands, buildEngineContext(next, { maxHistory: 0, maxReceipts: 0 }));
      if (!calls.length) invalid('At least one command is required');
      stageEngineCommands(next, result, calls);
    });
  }
  report(input: EngineReport): Promise<EngineCommit> {
    return this.operate('report', input, ['results', 'changes'], (next, result, operation) => acceptEngineReport(next, result, operation));
  }
  synchronize(input: EngineSync, options: { hostInputDigest?: string } = {}): Promise<EngineCommit> {
    return this.operate('sync', input, ['source', 'summary', 'status', 'output', 'changes'], (next, result, operation) => {
      this.requireSettled(next); acceptEngineSync(next, result, operation);
    }, { hostInputDigest: options.hostInputDigest });
  }
  private requireSettled(state: EngineCheckpoint) {
    if (state.pending.length) throw new EngineError('pending_commands', 'Report pending program results before another interaction');
  }
  private operate<T extends EngineOperationInput>(kind: EngineOperationKind, raw: T, allowed: string[], run: (next: EngineCheckpoint, result: EngineCommit, input: T) => void | Promise<void>, options: OperationOptions = {}): Promise<EngineCommit> {
    // Capture before entering the queue so callers cannot mutate queued arguments.
    let input: T;
    try {
      input = captureEngineOperation(kind, raw);
      if (kind === 'sync') {
        const sync = input as unknown as EngineSync;
        if (sync.status === 'completed') delete sync.status;
      }
    }
    catch (error) { return Promise.reject(error); }
    const { signal, narration, hostInputDigest } = options;
    const work = this.queue.then(async () => {
      checkAbort(signal); fields(input as unknown as Record<string, unknown>, ['id', 'expectedRevision', ...allowed]);
      identifier(input.id); revision(input.expectedRevision);
      if (hostInputDigest !== undefined && !isEngineDigest(hostInputDigest)) invalid('Invalid host synchronization fingerprint');
      const policy = { kind, ...(narration ? { narration } : {}), ...(hostInputDigest ? { hostInputDigest } : {}) };
      const fingerprint = canonical({ ...policy, input });
      const prior = this.operationsById.get(input.id);
      if (prior) {
        // Older saves can contain an explicit default. Compare it without rewriting the stored journal.
        const matchesLegacySync = prior.fingerprint !== fingerprint && kind === 'sync' && !Object.hasOwn(input, 'status') &&
          prior.fingerprint === canonical({ ...policy, input: { ...input, status: 'completed' } });
        if (prior.fingerprint !== fingerprint && !matchesLegacySync) throw new EngineError('operation_conflict', 'Operation ID was already used with different input');
        return structuredClone(prior.result);
      }
      if (this.prepared && this.prepared.operation.fingerprint !== fingerprint) throw new EngineError('persistence_pending', 'Retry saving the previous operation with its original input');
      if (input.expectedRevision !== this.state.revision) throw new EngineError('revision_conflict', 'Session revision has changed');
      if (!this.prepared) {
        // Reducers replace changed collections. Reuse accepted history until a snapshot crosses the public boundary.
        const next = { ...this.state }, result = makeEngineCommit(input.id, next.revision + 1);
        await run(next, result, input);
        checkAbort(signal);
        const operation = { id: input.id, fingerprint, result };
        next.revision = result.revision;
        next.operations = [...next.operations, operation];
        this.prepared = { next, operation };
      }
      return this.persistPrepared();
    });
    this.queue = work.catch(() => undefined); return work;
  }
  private async persistPrepared(): Promise<EngineCommit> {
    const prepared = this.prepared!;
    try { await this.options.persistence?.save(structuredClone(prepared.next), this.state.revision); }
    catch (error) { throw new EngineError('persistence_failed', error instanceof Error ? error.message : 'Checkpoint save failed'); }
    this.state = prepared.next;
    this.operationsById.set(prepared.operation.id, prepared.operation);
    this.prepared = undefined;
    return structuredClone(prepared.operation.result);
  }
}
export function createEngineSession(options: EngineSessionOptions & { id: string; world: EngineWorld }): EngineSession {
  return new EngineSession({ format: 'eidos-engine-session', version: 1, id: identifier(options.id), revision: 0,
    world: options.world, turns: [], pending: [], receipts: [], operations: [] }, options);
}
export function restoreEngineSession(checkpoint: unknown, options: EngineSessionOptions = {}): EngineSession {
  return new EngineSession(checkpoint, options);
}
