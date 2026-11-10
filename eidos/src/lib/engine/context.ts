import type { EngineCheckpoint, EngineContext } from './types';
import { engineTargetAvailable, publicEngineMap } from './world';
import { EngineError, invalid } from './validation';

/** Optional follow-up input for games that narrate a previously accepted program result. */
export const ENGINE_RECEIPT_NARRATION_INPUT =
  '根据最近已确认的程序回执，简短描述玩家能观察到的实际结果。保留成功、失败或拒绝的事实，只续写叙事，不提议新命令。';

export interface EngineContextOptions {
  maxHistory?: number;
  maxReceipts?: number;
  /** UTF-8 bytes of the serialized context, excluding the action and transport envelope. */
  maxBytes?: number;
}

function limit(value: number | undefined, field: keyof EngineContextOptions): number {
  if (value === undefined) return Infinity;
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${field} must be a non-negative safe integer`);
  return value;
}

function fitContext(context: EngineContext, budget: number) {
  const encoder = new TextEncoder();
  const size = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  let bytes = size(context), historyStart = 0, receiptStart = 0;
  const { history, receipts } = context;
  // Dropping an entry saves its JSON bytes plus one separator if another entry remains.
  while (bytes > budget && historyStart < history.length) {
    bytes -= size(history[historyStart++]) + Number(historyStart < history.length);
  }
  while (bytes > budget && receiptStart < receipts.length - 1) {
    bytes -= size(receipts[receiptStart++]) + 1;
  }
  if (bytes > budget) throw new EngineError('context_budget_exceeded', 'Current world and latest retained receipt exceed the context byte budget');
  context.history = history.slice(historyStart);
  context.receipts = receipts.slice(receiptStart);
}

export function buildEngineContext(
  source: Pick<EngineCheckpoint, 'id' | 'revision' | 'world' | 'turns' | 'receipts'>,
  options: EngineContextOptions = {},
): EngineContext {
  const { world } = source;
  const map = publicEngineMap(world);
  const context: EngineContext = {
    version: 1, sessionId: source.id, revision: source.revision,
    world: { id: world.id, name: world.name, state: world.state, ...(world.description === undefined ? {} : { description: world.description }) },
    scene: world.scenes[world.currentSceneId],
    components: Object.fromEntries(Object.entries(world.components).filter(([, c]) => engineTargetAvailable(world, { kind: 'component', id: c.id }))),
    map,
    commands: Object.fromEntries(Object.entries(world.commands).filter(([, c]) => c.enabled !== false && engineTargetAvailable(world, c.target, map))),
    history: source.turns.slice(Math.max(0, source.turns.length - limit(options.maxHistory, 'maxHistory'))),
    receipts: source.receipts.slice(Math.max(0, source.receipts.length - limit(options.maxReceipts, 'maxReceipts'))),
  };
  if (options.maxBytes !== undefined) fitContext(context, limit(options.maxBytes, 'maxBytes'));
  return structuredClone(context);
}
