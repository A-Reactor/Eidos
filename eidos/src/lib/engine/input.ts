import type { EngineReceiptNarrationInput } from './types';
import { ENGINE_JSON_DEPTH, fields, identifier, jsonObject, revision, string, type JsonShape } from './validation';

// These shapes only identify optional protocol fields. The existing validators still check all values.
const scene = { optional: ['description', 'visible'] };
const component = { optional: ['sceneId', 'description', 'visible', 'enabled'] };
const command = { optional: ['description', 'parameters', 'enabled'] };
const commands = { values: command };
const map = { fields: {
  nodes: { values: { optional: ['discovered', 'position'], fields: { position: { optional: ['z'] } } } },
  edges: { values: { optional: ['bidirectional', 'blocked', 'discovered'] } },
} };
const call = { optional: ['args'] };
const action = { optional: ['target'] };
const segments = { elements: { optional: ['speakerId'] } };

export const worldShape: JsonShape = {
  optional: ['description'],
  fields: { scenes: { values: scene }, components: { values: component }, map, commands },
};
export const changesShape: JsonShape = {
  optional: ['state', 'currentSceneId', 'scenes', 'removeScenes', 'components', 'removeComponents', 'map', 'commands'],
  fields: { scenes: { elements: scene }, components: { elements: component }, map, commands },
};
export const proposalShape: JsonShape = {
  optional: ['commands', 'usage'],
  fields: { segments, commands: { elements: call }, usage: { optional: ['provider', 'model', 'elapsedMs', 'estimated'] } },
};
export const narrationShape: JsonShape = { fields: {
  input: action,
  context: { fields: {
    world: { optional: ['description'] }, scene, components: { values: component }, map, commands,
    history: { elements: { fields: { input: action, segments } } },
    receipts: { elements: { optional: ['requestId', 'commandId', 'output', 'message'] } },
  } },
} };

const operationShapes = {
  action,
  request: { fields: { commands: { elements: call } } },
  report: {
    optional: ['changes'],
    fields: { changes: changesShape, results: { elements: {
      optional: ['output', 'message', 'changes'],
      fields: { changes: changesShape },
    } } },
  },
  sync: { optional: ['status', 'output', 'changes'], fields: { changes: changesShape } },
} satisfies Record<string, JsonShape>;

export type EngineOperationKind = keyof typeof operationShapes;
export function captureEngineOperation<T>(kind: EngineOperationKind, value: T): T {
  // A report wraps independently validated receipts and changes in results[index].
  const maxDepth = kind === 'report' ? ENGINE_JSON_DEPTH + 3 : ENGINE_JSON_DEPTH;
  return jsonObject(value, { shape: operationShapes[kind], maxDepth }) as unknown as T;
}

export function captureReceiptNarration(value: EngineReceiptNarrationInput): EngineReceiptNarrationInput {
  const input = jsonObject(value, { shape: { optional: ['instruction'] } });
  fields(input, ['id', 'expectedRevision', 'instruction']);
  return {
    id: identifier(input.id), expectedRevision: revision(input.expectedRevision),
    ...(input.instruction === undefined ? {} : { instruction: string(input.instruction, 'instruction') }),
  };
}
