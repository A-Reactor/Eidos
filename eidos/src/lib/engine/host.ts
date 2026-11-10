import type { EngineHostExecution, EngineHostOptions, EngineHostResolution, EngineHostSnapshot, EngineHostStorageStats, EngineHostSync } from './host-types';
import type { EngineAction, EngineCheckpoint, EngineCommandInput, EngineCommit, EngineProgramResult, EngineReceiptNarrationInput, EngineSync } from './types';
import { hostStorageStats, pendingEngineResults, readEngineHostSnapshot, retainExecutions } from './host-save';
import { createEngineSession, restoreEngineSession, type EngineSession } from './session';
import { reportReceipts } from './operations';
import { canonical, EngineError, fields, identifier, invalid, json, jsonObject, revision } from './validation';
import { captureEngineOperation, captureReceiptNarration } from './input';
import { diffEngineWorld, parseEngineWorld } from './world';

type HostGameUpdate<Game> = Pick<EngineHostSnapshot<Game>, 'game' | 'executions'>;
interface PreparedSync<Game> { input: EngineSync; fingerprint: string; game: Game }

async function syncFingerprint(input: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== 'function') {
    throw new EngineError('crypto_unavailable', 'Host synchronization requires Web Crypto in a secure context');
  }
  const bytes = new TextEncoder().encode(canonical(input));
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Coordinates an isolated game reducer and the engine through one durable save boundary. */
export class EngineHost<Game> {
  private readonly engine: EngineSession;
  private snapshot: EngineHostSnapshot<Game>;
  private queue: Promise<unknown> = Promise.resolve();
  private staged?: HostGameUpdate<Game>;
  private reportUpdate?: HostGameUpdate<Game>;
  private preparedSync?: PreparedSync<Game>;
  private readonly maxSettledExecutions: number;
  private readonly reportSave: 'separate' | 'atomic';

  private constructor(private readonly options: EngineHostOptions<Game>, start: { id: string; game: Game } | { snapshot: EngineHostSnapshot<Game> }) {
    this.reportSave = options.reportSave ?? 'separate';
    if (this.reportSave !== 'separate' && this.reportSave !== 'atomic') invalid('Invalid host report save mode');
    this.maxSettledExecutions = options.maxSettledExecutions ?? Infinity;
    if (options.maxSettledExecutions !== undefined &&
      (!Number.isSafeInteger(options.maxSettledExecutions) || options.maxSettledExecutions < 0)) {
      invalid('maxSettledExecutions must be a non-negative safe integer');
    }
    const sessionOptions = {
      narrator: options.narrator,
      context: options.context,
      persistence: { save: (engine: EngineCheckpoint) => this.saveEngine(engine) },
    };
    if ('snapshot' in start) {
      this.snapshot = start.snapshot;
      this.engine = restoreEngineSession(this.snapshot.engine, sessionOptions);
    } else {
      const game = json(start.game, { label: 'game' }) as Game;
      this.engine = createEngineSession({ ...sessionOptions, id: start.id, world: options.project(structuredClone(game)) });
      this.snapshot = { format: 'eidos-engine-host', version: 1, revision: 0, game, executions: [], engine: this.engine.getSnapshot() };
    }
  }

  static create<Game>(options: EngineHostOptions<Game> & { id: string; game: Game }): EngineHost<Game> {
    return new EngineHost(options, options);
  }

  static restore<Game>(raw: unknown, options: EngineHostOptions<Game>): EngineHost<Game> {
    return new EngineHost(options, { snapshot: readEngineHostSnapshot(raw, options.project) });
  }

  getSnapshot(): EngineHostSnapshot<Game> {
    return structuredClone(this.snapshot);
  }

  getStorageStats(): EngineHostStorageStats {
    return hostStorageStats(this.snapshot);
  }

  /** Save the currently accepted state, including a new game before its first operation. */
  persist(): Promise<void> {
    return this.enqueue(() => this.save(this.snapshot));
  }

  /** Commit an independent program result and its optional game update in the same save. */
  async synchronize(raw: EngineHostSync<Game>): Promise<EngineCommit> {
    const data = jsonObject(raw, { shape: { optional: ['game', 'status', 'output'] } });
    fields(data, ['id', 'expectedRevision', 'source', 'summary', 'status', 'output', 'game']);
    const input = { ...data, status: data.status === undefined ? 'completed' : data.status } as unknown as EngineHostSync<Game>;
    identifier(input.id);
    revision(input.expectedRevision);
    if (input.game !== undefined && input.status !== undefined && input.status !== 'completed') {
      invalid('Failed or denied results cannot change game state');
    }
    return this.enqueue(() => this.synchronizeGame(input));
  }

  private async synchronizeGame(input: EngineHostSync<Game>): Promise<EngineCommit> {
    const { engine, synchronizations } = this.snapshot;
    const fingerprint = await syncFingerprint(input);
    const prior = engine.operations.find(operation => operation.id === input.id);
    if (prior) {
      if (!synchronizations || !Object.hasOwn(synchronizations, input.id) || synchronizations[input.id] !== fingerprint) {
        throw new EngineError('operation_conflict', 'Operation ID was already used with different input');
      }
      return structuredClone(prior.result);
    }
    if (this.preparedSync && this.preparedSync.fingerprint !== fingerprint) {
      throw new EngineError('persistence_pending', 'Retry saving the previous operation with its original input');
    }
    if (engine.pending.length) throw new EngineError('pending_commands', 'Report pending program results before synchronizing');
    if (input.expectedRevision !== engine.revision) throw new EngineError('revision_conflict', 'Session revision has changed');
    if (!this.preparedSync) {
      const { game, ...program } = input;
      const changes = game === undefined ? {} : diffEngineWorld(engine.world, this.options.project(structuredClone(game)));
      this.preparedSync = {
        input: { ...program, ...(Object.keys(changes).length ? { changes } : {}) },
        game: game === undefined ? this.snapshot.game : game,
        fingerprint,
      };
    }
    try {
      const result = await this.engine.synchronize(this.preparedSync.input, { hostInputDigest: fingerprint });
      this.preparedSync = undefined;
      return result;
    } catch (error) {
      if (!(error instanceof EngineError) || error.code !== 'persistence_failed') this.preparedSync = undefined;
      throw error;
    }
  }

  async act(input: EngineAction, options?: { signal?: AbortSignal }) {
    const operation = captureEngineOperation('action', input);
    const signal = options?.signal;
    return this.enqueue(() => this.engine.act(operation, { signal }));
  }

  async narrateReceipts(input: EngineReceiptNarrationInput, options?: { signal?: AbortSignal }): Promise<EngineCommit> {
    const operation = captureReceiptNarration(input);
    const signal = options?.signal;
    return this.enqueue(() => this.engine.narrateReceipts(operation, { signal }));
  }

  async requestCommands(input: EngineCommandInput) {
    const operation = captureEngineOperation('request', input);
    return this.enqueue(() => this.engine.requestCommands(operation));
  }

  /** Persist the pending batch, then return the stored results without reporting them yet. */
  executePending(): Promise<EngineProgramResult[]> {
    return this.enqueue(() => this.executePendingBatch());
  }

  /** Recover or execute the pending batch and commit its real outcomes. */
  resumePending(): Promise<EngineHostResolution | null> {
    return this.enqueue(async () => {
      const { engine, executions } = this.snapshot;
      if (!engine.pending.length) return null;
      const prior = pendingEngineResults(engine, executions);
      if (!prior.length && this.reportSave === 'atomic') {
        this.staged ??= await this.stageBatch(engine);
        this.reportUpdate = this.staged;
      }
      const results = this.reportUpdate
        ? pendingEngineResults(engine, this.reportUpdate.executions)
        : await this.executePendingBatch();
      const prefix = `eidos-host/report/${engine.revision}`;
      const used = new Set(engine.operations.map(operation => operation.id));
      let id = prefix;
      for (let index = 1; used.has(id); index++) id = `${prefix}/${index}`;
      try {
        const report = await this.engine.report({ id, expectedRevision: engine.revision, results });
        this.staged = undefined;
        return { operationId: engine.pending[0].operationId, results: structuredClone(results), report };
      } finally {
        this.reportUpdate = undefined;
      }
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const work = this.queue.then(run);
    this.queue = work.catch(() => undefined);
    return work;
  }

  private saveEngine(engine: EngineCheckpoint): Promise<void> {
    const sync = this.preparedSync;
    if (sync && engine.operations.at(-1)?.id === sync.input.id) {
      return this.save({ ...this.snapshot, version: 2, engine, game: sync.game,
        synchronizations: { ...this.snapshot.synchronizations, [sync.input.id]: sync.fingerprint } });
    }
    return this.save({ ...this.snapshot, ...this.reportUpdate, engine });
  }

  private async save(snapshot: EngineHostSnapshot<Game>): Promise<void> {
    const previous = this.snapshot.revision;
    if (!Number.isSafeInteger(previous + 1)) invalid('Host save revision exhausted');
    const next = { ...retainExecutions(snapshot, this.maxSettledExecutions), revision: previous + 1 };
    try {
      await this.options.persistence.save(structuredClone(next), previous || null);
    } catch (error) {
      throw new EngineError('persistence_failed', error instanceof Error ? error.message : 'Host save failed');
    }
    this.snapshot = next;
  }

  private async executePendingBatch(): Promise<EngineProgramResult[]> {
    const { engine, executions } = this.snapshot;
    if (!engine.pending.length) return [];
    const prior = pendingEngineResults(engine, executions);
    if (prior.length) return structuredClone(prior);
    // Keep a prepared result across transient save failures so the same process only retries the write.
    this.staged ??= await this.stageBatch(engine);
    await this.save({ ...this.snapshot, ...this.staged });
    this.staged = undefined;
    return structuredClone(pendingEngineResults(engine, this.snapshot.executions));
  }

  private async stageBatch(engine: EngineCheckpoint): Promise<HostGameUpdate<Game>> {
    let game = this.snapshot.game;
    let world = engine.world;
    const staged: EngineHostExecution[] = [];
    for (const request of engine.pending) {
      const outcome = await this.options.execute({ game: structuredClone(game), request: structuredClone(request) });
      if (!outcome || !['completed', 'failed', 'denied'].includes(outcome.status)) invalid('Invalid host program outcome');
      fields(outcome, outcome.status === 'completed' ? ['status', 'game', 'output', 'message'] : ['status', 'output', 'message']);
      const result: EngineProgramResult = {
        requestId: request.id, status: outcome.status,
        ...(outcome.output === undefined ? {} : { output: json(outcome.output, { label: 'output' }) }),
        ...(outcome.message === undefined ? {} : { message: outcome.message }),
      };
      if (outcome.status === 'completed') {
        game = json(outcome.game, { label: 'game' }) as Game;
        const projected = parseEngineWorld(this.options.project(structuredClone(game)));
        const changes = diffEngineWorld(world, projected);
        if (Object.keys(changes).length) result.changes = changes;
        world = projected;
      }
      staged.push({ request, result });
    }
    // A staged save must pass the same report boundary that will be used after a restart.
    const report = captureEngineOperation('report', { id: 'validate', expectedRevision: engine.revision, results: staged.map(entry => entry.result) });
    reportReceipts({ sessionId: engine.id, worldId: engine.world.id, pending: engine.pending }, report.id, report);
    return { game, executions: [...this.snapshot.executions, ...staged] };
  }
}

export const createEngineHost = EngineHost.create;
export const restoreEngineHost = EngineHost.restore;
