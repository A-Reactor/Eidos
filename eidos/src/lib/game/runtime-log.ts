export interface GameRuntimeEvent {
  engine: 'KEI' | 'ALICE';
  mode: 'review' | 'background' | 'blocking' | 'action' | 'speculation' | 'prediction_wait';
  phase: 'pending' | 'skipped' | 'queued' | 'started' | 'first_text' | 'succeeded' |
    'applied' | 'failed' | 'discarded' | 'staged' | 'activated' | 'cache_hit' | 'fallback';
  timestamp: number;
  durationMs?: number;
  level?: 'light' | 'quality' | 'causal';
  trigger?: string;
  reason?: string;
  actionId?: string;
  worldId?: string;
  playthroughId?: string | null;
  scope?: string;
  requestId?: string;
}

const modes = new Set(['review', 'background', 'blocking', 'action', 'speculation', 'prediction_wait']);
const phases = new Set(['pending', 'skipped', 'queued', 'started', 'first_text', 'succeeded',
  'applied', 'failed', 'discarded', 'staged', 'activated', 'cache_hit', 'fallback']);

export function parseGameRuntimeEvent(value: unknown): GameRuntimeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if ((input.engine !== 'KEI' && input.engine !== 'ALICE') || !modes.has(input.mode as string) ||
      !phases.has(input.phase as string) || typeof input.timestamp !== 'number' ||
      !Number.isFinite(input.timestamp) || input.timestamp < 0 || input.timestamp > 8.64e15) return null;
  const event: GameRuntimeEvent = { engine: input.engine, mode: input.mode as GameRuntimeEvent['mode'],
    phase: input.phase as GameRuntimeEvent['phase'], timestamp: input.timestamp };
  // Diagnostics contain identifiers and timings; prompts and credentials never enter the log.
  for (const key of ['trigger', 'reason', 'actionId', 'worldId', 'playthroughId', 'scope', 'requestId'] as const) {
    if (typeof input[key] === 'string') event[key] = input[key].replace(/[\r\n\t]/g, ' ').slice(0, 240);
  }
  if (input.level === 'light' || input.level === 'quality' || input.level === 'causal') event.level = input.level;
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0) {
    event.durationMs = Math.round(input.durationMs);
  }
  return event;
}

export function writeGameRuntimeEvent(event: GameRuntimeEvent): void {
  const label = { review: '审核', background: '后台审核', blocking: '关键复核', action: '生成',
    speculation: '预生成', prediction_wait: '衔接预生成' }[event.mode];
  const details = Object.entries(event).filter(([key]) => !['engine', 'mode', 'phase', 'timestamp'].includes(key))
    .map(([key, value]) => `${key}=${value}`).join(' ');
  console.info(`${new Date(event.timestamp).toISOString()} [${event.engine}] ${label} ${event.phase}${details ? ` ${details}` : ''}`);
}

export function logGameRuntimeEvent(input: GameRuntimeEvent): void {
  try {
    const event = parseGameRuntimeEvent(input);
    if (!event) return;
    if (typeof window === 'undefined') { writeGameRuntimeEvent(event); return; }
    // A beacon survives panel navigation and never makes generation wait for logging.
    // Runtimes without this optional browser API can continue playing normally.
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/game/runtime-log', new Blob([JSON.stringify(event)], { type: 'application/json' }));
    }
  } catch { /* Diagnostics must not change the outcome of a game action. */ }
}

let nextRequest = 0;
export function startGameRuntimeSpan(context: Omit<GameRuntimeEvent, 'phase' | 'timestamp' | 'durationMs' | 'requestId'>) {
  const startedAt = Date.now();
  const requestId = `${startedAt.toString(36)}-${++nextRequest}`;
  let ended = false;
  const log = (phase: GameRuntimeEvent['phase'], reason?: string) => {
    if (ended) return;
    if (phase === 'succeeded' || phase === 'failed' || phase === 'discarded') ended = true;
    const timestamp = Date.now();
    logGameRuntimeEvent({ ...context, requestId, phase, timestamp, durationMs: timestamp - startedAt, reason });
  };
  log('started');
  return log;
}
