/** Portable contracts: only JSON crosses the game/runtime boundary. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
export type EngineTarget = { kind: 'world' } | { kind: 'scene' | 'component' | 'mapNode' | 'mapEdge'; id: string };
export interface EngineScene {
  id: string; name: string; description?: string; visible?: boolean; state: JsonObject;
}
export interface EngineComponent {
  id: string; kind: string; name: string; sceneId?: string; description?: string;
  visible?: boolean; enabled?: boolean; state: JsonObject;
}
export interface EngineMapNode {
  id: string; name: string; sceneId: string; discovered?: boolean;
  position?: { x: number; y: number; z?: number }; state: JsonObject;
}
export interface EngineMapEdge {
  id: string; from: string; to: string; bidirectional?: boolean; blocked?: boolean;
  discovered?: boolean; state: JsonObject;
}
export interface EngineMap { nodes: Record<string, EngineMapNode>; edges: Record<string, EngineMapEdge> }
export interface EngineCommand {
  id: string; name: string; description?: string; target: EngineTarget;
  /** Host-owned parameter documentation; execution must still validate arguments. */
  parameters?: JsonObject; enabled?: boolean;
}
export interface EngineWorld {
  id: string; name: string; description?: string; currentSceneId: string; state: JsonObject;
  scenes: Record<string, EngineScene>; components: Record<string, EngineComponent>;
  map: EngineMap; commands: Record<string, EngineCommand>;
}
export interface EngineChanges {
  state?: JsonObject; currentSceneId?: string; scenes?: EngineScene[]; removeScenes?: string[];
  components?: EngineComponent[]; removeComponents?: string[]; map?: EngineMap;
  commands?: Record<string, EngineCommand>;
}
export interface EngineSegment { type: 'narration' | 'dialogue'; text: string; speakerId?: string }
export interface EngineCommandCall { commandId: string; args?: JsonObject }
export interface EngineCommandRequest extends EngineCommandCall {
  id: string; operationId: string; target: EngineTarget; args: JsonObject;
}
export interface EngineProgramResult {
  requestId: string; status: 'completed' | 'failed' | 'denied'; output?: JsonValue; message?: string; changes?: EngineChanges;
}
export interface EngineProgramReceipt {
  id: string; source: string; status: 'completed' | 'failed' | 'denied';
  requestId?: string; commandId?: string; output?: JsonValue; message?: string;
}
export interface EngineUsage {
  inputTokens: number; outputTokens: number; totalTokens: number;
  provider?: string; model?: string; elapsedMs?: number; estimated?: boolean;
}
export interface EngineProposal { segments: EngineSegment[]; commands?: EngineCommandCall[]; usage?: EngineUsage }
export interface EngineTurn { operationId: string; input: { text: string; target?: EngineTarget }; segments: EngineSegment[] }
export interface EngineContext {
  version: 1; sessionId: string; revision: number;
  world: { id: string; name: string; description?: string; state: JsonObject };
  scene: EngineScene; components: Record<string, EngineComponent>; map: EngineMap;
  commands: Record<string, EngineCommand>; history: EngineTurn[]; receipts: EngineProgramReceipt[];
}
export interface EngineNarrationInput { context: EngineContext; input: { text: string; target?: EngineTarget } }
export interface EngineNarrator {
  generate(input: EngineNarrationInput, options?: { signal?: AbortSignal }): Promise<EngineProposal>;
}
export type EngineEvent =
  | { type: 'narrative.committed'; segments: EngineSegment[] }
  | { type: 'command.requested'; request: EngineCommandRequest }
  | { type: 'program.reported'; receipt: EngineProgramReceipt }
  | { type: 'world.updated'; changes: EngineChanges };
export interface EngineCommit {
  operationId: string; revision: number; segments: EngineSegment[];
  commands: EngineCommandRequest[]; receipts: EngineProgramReceipt[]; events: EngineEvent[]; usage?: EngineUsage;
}
export interface EngineOperation { id: string; fingerprint: string; result: EngineCommit }
export interface EngineCheckpoint {
  format: 'eidos-engine-session'; version: 1; id: string; revision: number;
  world: EngineWorld; turns: EngineTurn[]; pending: EngineCommandRequest[];
  receipts: EngineProgramReceipt[]; operations: EngineOperation[];
}
export interface CompactEngineCheckpoint extends Pick<EngineCheckpoint, 'version' | 'id' | 'revision' | 'world'> {
  format: 'eidos-engine-compact';
  operations: Array<Omit<EngineOperation, 'result'> & { result: Omit<EngineCommit, 'events'> }>;
}
export interface EnginePersistence {
  /** Must atomically compare previousRevision and write; reject without writing on failure. */
  save(checkpoint: EngineCheckpoint, previousRevision: number): Promise<void>;
}
export interface EngineOperationInput { id: string; expectedRevision: number }
export interface EngineAction extends EngineOperationInput { text: string; target?: EngineTarget }
export interface EngineReceiptNarrationInput extends EngineOperationInput { instruction?: string }
export interface EngineCommandInput extends EngineOperationInput { commands: EngineCommandCall[] }
export interface EngineReport extends EngineOperationInput { results: EngineProgramResult[]; changes?: EngineChanges }
export interface EngineSync extends EngineOperationInput {
  source: string; summary: string; status?: 'completed' | 'failed' | 'denied'; output?: JsonValue; changes?: EngineChanges;
}
