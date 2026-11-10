import { createEngineHost, encodeEngineHostSnapshot, restoreEngineHost, restoreEngineSession } from '@/lib/engine';
import type { CompactEngineHostSnapshot, EngineCheckpoint, EngineCommandRequest, EngineHost, EngineHostOptions, EngineHostOutcome, EngineHostSnapshot, EngineNarrator, JsonObject } from '@/lib/engine';
import { buildEidosEngineWorld, engineCommandToPlayerInput } from '@/lib/game/engine-world';
import { prepareRpgAction } from '@/lib/game/action-runtime';
import type { ActionRecord, WorldSnapshot } from '@/lib/game/types';
import type { AIGameResponse } from '@/lib/ai/types';
import { courtyardSnapshot, courtyardWorld } from './world';

interface CourtyardState { snapshot: WorldSnapshot; history: ActionRecord[] }
type CourtyardView = EngineHostSnapshot<CourtyardState>;
export type CourtyardSave = CompactEngineHostSnapshot<CourtyardState>;
export type CourtyardPersistence = (save: CourtyardSave, previousRevision: number | null) => void | Promise<void>;

const narrator: EngineNarrator = {
  async generate({ context }) {
    const receipt = context.receipts.at(-1), output = receipt?.output;
    const text = output && typeof output === 'object' && !Array.isArray(output) && typeof output.text === 'string' ? output.text : receipt?.message ?? '晨光照进门厅。';
    return { segments: [{ type: 'narration', text }] };
  },
};

function jsonGame(state: CourtyardState): CourtyardState {
  // RPG snapshots contain optional undefined fields. The demo stores the same JSON shape it would export.
  return JSON.parse(JSON.stringify(state));
}

function migrateSave(saved: unknown): unknown {
  if (!saved || typeof saved !== 'object' || !('format' in saved) || saved.format !== 'eidos-courtyard-demo') return saved;
  const legacy = saved as Partial<CourtyardState & { version: number; sequence: number; engine: unknown; executions: CourtyardView['executions'] }>;
  const { snapshot, history, executions, sequence } = legacy;
  if (legacy.version !== 1 || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0 || !snapshot ||
      !Array.isArray(history) || snapshot.historyLength !== history.length || !Array.isArray(executions)) {
    throw new Error('演示存档格式无效');
  }
  const engine = restoreEngineSession(legacy.engine).getSnapshot();
  const pending = new Set(engine.pending.map(request => request.id));
  const journal = executions.map(({ request, result }) => ({ request, result }));
  const revision = engine.revision + Number(journal.some(({ request }) => pending.has(request.id)));
  return { format: 'eidos-engine-host', version: 1, revision, engine, game: jsonGame({ snapshot, history }), executions: journal } satisfies CourtyardView;
}

export function hasUnfinishedWork(engine: EngineCheckpoint) {
  return engine.pending.length > 0 || Boolean(engine.operations.at(-1)?.result.receipts.length);
}

/** The demo owns RPG rules and delegates save, execution and report ordering to EngineHost. */
export class CourtyardGame {
  private readonly world = courtyardWorld();
  private readonly host: EngineHost<CourtyardState>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(saved?: unknown, persist?: CourtyardPersistence) {
    const options: EngineHostOptions<CourtyardState> = {
      narrator,
      context: { maxHistory: 24, maxReceipts: 12, maxBytes: 128_000 },
      project: game => this.project(game),
      execute: ({ game, request }) => this.execute(game, request),
      persistence: { async save(next, previous) { await persist?.(encodeEngineHostSnapshot(next), previous); } },
    };
    this.host = saved === undefined
      ? createEngineHost({ ...options, id: this.world.id, game: jsonGame({ snapshot: courtyardSnapshot(this.world), history: [] }) })
      : restoreEngineHost(migrateSave(saved), options);
  }

  getSnapshot() { return this.host.getSnapshot(); }
  exportSave() { return encodeEngineHostSnapshot(this.getSnapshot()); }
  persist() { return this.host.persist(); }

  private project({ snapshot, history }: CourtyardState) {
    if (!snapshot || snapshot.worldId !== this.world.id || !Array.isArray(history) || snapshot.historyLength !== history.length) {
      throw new Error('庭院存档的世界或行动记录无效');
    }
    const world = buildEidosEngineWorld({ world: this.world, snapshot });
    const open = Boolean(snapshot.worldFlags['gameplay.courtyard.open']);
    world.components['courtyard-door'] = { id: 'courtyard-door', kind: 'door', name: '庭院门', sceneId: 'hall', state: { locked: !open } };
    world.commands['unlock-door'] = { id: 'unlock-door', name: '打开庭院门', target: { kind: 'component', id: 'courtyard-door' }, enabled: !open };
    if (!snapshot.worldFlags['gameplay.courtyard.key-found']) {
      world.components['brass-key'] = { id: 'brass-key', kind: 'pickup', name: '铜钥匙', sceneId: 'hall', state: {} };
      world.commands['take-key'] = { id: 'take-key', name: '捡起铜钥匙', target: { kind: 'component', id: 'brass-key' } };
    }
    return world;
  }

  async request(commandId: string, args: JsonObject = {}) {
    const { revision } = this.getSnapshot().engine;
    const result = await this.host.requestCommands({ id: `courtyard-command/${revision}`, expectedRevision: revision, commands: [{ commandId, args }] });
    return result.commands[0];
  }

  executePending() { return this.host.executePending(); }

  private execute(game: CourtyardState, request: EngineCommandRequest): EngineHostOutcome<CourtyardState> {
    try {
      const { response, input } = this.program(request, game);
      const prepared = prepareRpgAction({ world: this.world, snapshot: game.snapshot, response, input,
        actionId: request.id, timestamp: Date.now(), history: game.history });
      return { status: 'completed', game: jsonGame({ snapshot: prepared.snapshot, history: [...game.history, prepared.record] }),
        output: { text: prepared.text, actionId: request.id, effects: prepared.effects.map(e => e.type) } };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : '程序执行失败' };
    }
  }

  interact(commandId: string, args: JsonObject = {}) {
    const run = this.queue.then(async () => {
      await this.request(commandId, args);
      const resolution = await this.finishPending();
      if (!resolution) throw new Error('程序没有返回结果');
      return resolution;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async resumePending() { await this.finishPending(); }

  private async finishPending() {
    const resolution = await this.host.resumePending();
    const { engine } = this.getSnapshot();
    if (!hasUnfinishedWork(engine)) return;
    const narration = await this.host.narrateReceipts({ id: `courtyard-prose/${engine.revision}`, expectedRevision: engine.revision });
    return resolution && { result: resolution.results[0], narration };
  }

  private program(request: EngineCommandRequest, state: CourtyardState): { input: string; response: AIGameResponse } {
    const { snapshot } = state, { components, map } = this.project(state);
    if (Object.keys(request.args).length) throw new Error('演示命令不接受额外参数');
    const response: AIGameResponse = { validity: { isPossible: true, reason: null, fantasyResponse: null }, segments: [],
      sceneChanges: [], discoveredSecrets: [], npcsReacted: [], availableActions: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [], summary: '', timeSpent: { day: 0, hour: 0, minute: 1 }, worldImpacts: [] };
    let input: string;
    if (request.commandId === 'take-key') {
      input = '捡起铜钥匙'; response.segments = [{ type: 'narration', text: '你从长椅旁拾起铜钥匙。齿纹与庭院门锁恰好相合。' }];
      response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'take-key' }];
      response.itemsGained = [{ id: 'brass-key', name: '铜钥匙', description: '庭院门的铜钥匙。', category: 'key', quantity: 1, value: 0, consumable: true, acquiredFrom: 'hall', acquiredAt: snapshot.currentGameTime }];
    } else {
      const component = request.target.kind === 'component' ? components[request.target.id] : undefined;
      if (request.commandId === 'unlock-door' || component?.kind === 'item') {
        if (!snapshot.inventory.some(i => i.id === 'brass-key' && i.quantity > 0)) throw new Error('门锁着，需要先找到铜钥匙。');
        input = '用铜钥匙打开庭院门'; response.segments = [{ type: 'narration', text: '铜钥匙转过半圈，锁舌轻响。庭院门打开了，门后的通路已经可行。' }];
        response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'unlock' }]; response.itemsUsed = ['铜钥匙'];
        response.mapUpdates = { routes: [{ from: 'hall', to: 'garden', status: 'open', bidirectional: true }] };
      } else if (component?.kind === 'npc') {
        input = engineCommandToPlayerInput(request, { world: this.world, snapshot: snapshot });
        response.segments = [{ type: 'dialogue', speaker: '守门人', text: '钥匙落在长椅旁。打开门，就能去庭院看看了。' }];
        response.npcsReacted = ['守门人：指向长椅']; response.relationshipUpdates = [{ npcName: '守门人', trustDelta: 2 }];
      } else {
        input = engineCommandToPlayerInput(request, { world: this.world, snapshot: snapshot });
        if (request.target.kind !== 'mapEdge') throw new Error('这个组件没有可执行的交互');
        const edge = map.edges[request.target.id];
        response.sceneChanges = [edge.to]; response.pluginEvents = [{ pluginId: 'courtyard', ruleId: 'travel' }];
        response.timeSpent.minute = 2; response.segments = [{ type: 'narration', text: edge.to === 'garden' ? '你沿着打开的门走进庭院，树叶在风中轻响。' : '你穿过铜门，回到了有长椅的门厅。' }];
      }
    }
    response.summary = input;
    return { input, response };
  }
}
export const createCourtyardGame = (persist?: CourtyardPersistence) => new CourtyardGame(undefined, persist);
export const restoreCourtyardGame = (save: unknown, persist?: CourtyardPersistence) => new CourtyardGame(save, persist);
