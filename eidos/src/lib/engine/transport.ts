import type { EngineContext, EngineNarrationInput, EngineScene } from './types';
import { ENGINE_ENVELOPE_DEPTH, fields, identifier, invalid, jsonObject, list, object, revision, string } from './validation';
import { engineTargetAvailable, parseEngineTarget, parseEngineWorld, publicEngineMap } from './world';
import { parseEngineSegments } from './proposal';
import { parseEngineReceipt } from './operations';
import { narrationShape } from './input';

/** Validate the public projection without requiring private or unvisited scene definitions. */
export function parseEngineNarrationInput(raw: unknown): EngineNarrationInput {
  const value = jsonObject(raw, { maxDepth: ENGINE_ENVELOPE_DEPTH, shape: narrationShape }); fields(value, ['context', 'input']);
  const c = object(value.context), input = object(value.input);
  fields(c, ['version', 'sessionId', 'revision', 'world', 'scene', 'components', 'map', 'commands', 'history', 'receipts']);
  if (c.version !== 1) invalid('Unsupported engine context version');
  identifier(c.sessionId); revision(c.revision);
  const world = object(c.world); fields(world, ['id', 'name', 'description', 'state']);
  const current = object(c.scene), currentId = identifier(current.id), map = object(c.map);
  const scenes: Record<string, unknown> = { [currentId]: current };
  for (const node of Object.values(object(map.nodes))) {
    const n = object(node), sceneId = identifier(n.sceneId);
    if (!Object.hasOwn(scenes, sceneId)) scenes[sceneId] = { id: sceneId, name: string(n.name), state: {} };
  }
  const reconstructed = parseEngineWorld({ ...world, currentSceneId: currentId, scenes, components: c.components, map: c.map, commands: c.commands });
  const visibleMap = publicEngineMap(reconstructed);
  if (Object.keys(visibleMap.nodes).length !== Object.keys(reconstructed.map.nodes).length ||
      Object.keys(visibleMap.edges).length !== Object.keys(reconstructed.map.edges).length) {
    invalid('Context contains unavailable map nodes or edges');
  }
  for (const component of Object.values(reconstructed.components)) {
    if (!engineTargetAvailable(reconstructed, { kind: 'component', id: component.id })) invalid('Context contains an unavailable component');
  }
  for (const command of Object.values(reconstructed.commands)) {
    if (command.enabled === false || !engineTargetAvailable(reconstructed, command.target, visibleMap)) invalid('Context contains an unavailable command');
  }
  fields(input, ['text', 'target']); string(input.text, 'action text');
  if (input.target !== undefined && !engineTargetAvailable(reconstructed, parseEngineTarget(input.target, reconstructed), visibleMap)) invalid('Interaction target is unavailable');
  const history = list(c.history).map(rawTurn => {
    const turn = object(rawTurn); fields(turn, ['operationId', 'input', 'segments']); identifier(turn.operationId);
    const action = object(turn.input); fields(action, ['text', 'target']); string(action.text);
    if (action.target !== undefined) parseEngineTarget(action.target);
    parseEngineSegments(turn.segments); return turn;
  });
  const receipts = list(c.receipts).map(receipt => parseEngineReceipt(receipt));
  const context = { ...c, scene: reconstructed.scenes[currentId] as EngineScene, components: reconstructed.components,
    map: reconstructed.map, commands: reconstructed.commands, history, receipts } as unknown as EngineContext;
  return { context, input: input as unknown as EngineNarrationInput['input'] };
}
