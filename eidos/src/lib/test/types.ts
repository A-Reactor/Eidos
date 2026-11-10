// ============================================================
// Eidos · AI 测试接口类型定义
// ============================================================

import type { AIGameResponse, TokenUsage } from "@/lib/ai/types";
import type { WorldSnapshot, WorldDefinition } from "@/lib/game/types";

export interface TestActionRequest {
  playerInput: string;
  snapshot: WorldSnapshot;
  world?: WorldDefinition | null;
  recentHistory?: Array<{ playerInput: string; summary: string }>;
  inventory?: import("@/lib/game/types").InventoryItem[];
  clues?: import("@/lib/game/types").Clue[];
  encyclopedia?: import("@/lib/game/types").EncyclopediaEntry[];
  criticalFacts?: import("@/lib/game/types").CriticalFactEntry[];
  questLog?: import("@/lib/game/types").QuestEntry[];
  introspection?: boolean;
  weather?: string;
  protagonistState?: import("@/lib/game/types").ProtagonistState | null;
  _settings?: Record<string, string> | null;
  _creativeConfig?: import("@/lib/game/types").CreativeModeConfig | null;
  _metaRealityContext?: string;
  _bias?: number;
  _debug?: boolean;
}

export interface TestDebugInfo {
  promptSent: string;
  tokenUsage: TokenUsage | null;
  elapsedMs: number;
  keiTokens: import("@/lib/ai/types").TokenUsage[];
  finishReason: string;
  modelUsed: "alice" | "kei";
}

export interface TestActionResponse extends AIGameResponse {
  _debug?: TestDebugInfo;
}

export interface ReadableGameState {
  sceneDescription: string;
  availableNpcs: string[];
  playerSummary: string;
  weather: string;
  timeOfDay: string;
  sceneName: string;
  regionName: string;
  discoveredClues: string[];
  activeQuests: string[];
  availableActions: string[];
  recentHistory: string[];
  encyclopediaCount: number;
  relationshipSummary: string[];
}

export interface TestStateResponse {
  world: WorldDefinition;
  snapshot: WorldSnapshot;
  readableView: ReadableGameState;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity: "critical" | "warning" | "info";
}

export interface TestVerification {
  scenario: string;
  playerInput: string;
  checks: VerificationCheck[];
  passRate: number;
  totalChecks: number;
  passedChecks: number;
}

export interface TestScenario {
  name: string;
  description: string;
  worldId: string;
  startSceneId: string;
  actions: TestScenarioAction[];
  expectedBehaviors: string[];
}

export interface TestScenarioAction {
  input: string;
  expectations: string[];
}
