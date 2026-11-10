import type { EngineSessionOptions } from './session';
import type { CompactEngineCheckpoint, EngineCheckpoint, EngineCommandRequest, EngineCommit, EngineProgramResult, EngineSync, EngineWorld, JsonValue } from './types';

export interface EngineHostExecution {
  request: EngineCommandRequest;
  result: EngineProgramResult;
}

interface HostSaveFields<Game, Checkpoint> {
  format: 'eidos-engine-host';
  /** Save revision. It also increases when a result is saved before being reported. */
  revision: number;
  game: Game;
  executions: EngineHostExecution[];
  engine: Checkpoint;
}

type HostSave<Game, Checkpoint> = HostSaveFields<Game, Checkpoint> & (
  | { version: 1; synchronizations?: never }
  | { version: 2; synchronizations: Record<string, string> }
);

export type EngineHostSnapshot<Game> = HostSave<Game, EngineCheckpoint>;
export type CompactEngineHostSnapshot<Game> = HostSave<Game, CompactEngineCheckpoint>;

export interface EngineHostPersistence<Game> {
  /** Atomically compare the save revision and write the entire snapshot. A rejection must leave storage untouched. */
  save(snapshot: EngineHostSnapshot<Game>, previousRevision: number | null): Promise<void>;
}

export type EngineHostOutcome<Game> = {
  output?: JsonValue;
  message?: string;
} & ({ status: 'completed'; game: Game } | { status: 'failed' | 'denied' });

export interface EngineHostOptions<Game> extends Omit<EngineSessionOptions, 'persistence'> {
  project(game: Game): EngineWorld;
  /** Stage a result using isolated inputs. Any external side effect needs its own durable request.id deduplication. */
  execute(input: { game: Game; request: EngineCommandRequest }): EngineHostOutcome<Game> | Promise<EngineHostOutcome<Game>>;
  persistence: EngineHostPersistence<Game>;
  /** Keep at most this many settled journal entries in each save. Pending results are always retained. */
  maxSettledExecutions?: number;
  /** Atomically commit staged game state and its report in one write. Default: separate durable pre-report save. */
  reportSave?: 'separate' | 'atomic';
}

export type EngineHostSync<Game> = Omit<EngineSync, 'changes'> & { game?: Game };

export interface EngineHostStorageStats {
  snapshotBytes: number;
  checkpointBytes: number;
  executionJournalBytes: number;
  /** Serialized digest table size when it has entries. */
  synchronizationBytes?: number;
  operations: number;
  settledExecutions: number;
  pendingExecutions: number;
}

export interface EngineHostResolution {
  operationId: string;
  results: EngineProgramResult[];
  report: EngineCommit;
}
