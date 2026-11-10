import type { CompactEngineHostSnapshot, EngineHostSnapshot } from './host-types';
import type { CompactEngineCheckpoint, EngineCheckpoint } from './types';

/** Encode a trusted SDK snapshot for storage. The full checkpoint is restored on read. */
export function encodeEngineCheckpoint(checkpoint: EngineCheckpoint): CompactEngineCheckpoint {
  return structuredClone({
    format: 'eidos-engine-compact', version: 1, id: checkpoint.id, revision: checkpoint.revision,
    world: checkpoint.world,
    operations: checkpoint.operations.map(({ id, fingerprint, result: { events: _events, ...result } }) => ({ id, fingerprint, result })),
  });
}

/** Keep the host revision and staged results intact while compacting its engine journal. */
export function encodeEngineHostSnapshot<Game>(snapshot: EngineHostSnapshot<Game>): CompactEngineHostSnapshot<Game> {
  const { engine, ...host } = snapshot;
  return { ...structuredClone(host), engine: encodeEngineCheckpoint(engine) };
}
