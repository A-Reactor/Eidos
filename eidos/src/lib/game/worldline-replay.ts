import { matchesActionInput } from './documents/action-draft';
// ============================================================
// Eidos · 世界线重放引擎
// ============================================================
// 管理重放状态机:
//   NoBranch  — 玩家仅浏览，AI 不介入，按存储数据逐步推进
//   Branch    — 玩家可浏览，输入与存储不同时触发分歧 → AI 接管
//
// 状态机:
//   Idle → (import file) → Preview → (choose mode) → Active
//     Active (no_branch) → play through → EndReached → Finish
//     Active (branch) → play → diverged? → AI Mode (out of replay)
// ============================================================

import type {
  WorldLineNode,
  WorldLineExport,
  ReplayMode,
  ReplayState,
} from "./types";

// ============================================================
// Replay Engine (pure functions — no store dependency)
// ============================================================

export function createReplayState(): ReplayState {
  return {
    active: false,
    mode: "no_branch",
    importData: null,
    currentNodeId: null,
    hasDiverged: false,
  };
}

/**
 * Start replay: validate and initialize.
 */
export function startReplay(
  state: ReplayState,
  importData: WorldLineExport,
  mode: ReplayMode
): ReplayState {
  return {
    active: true,
    mode,
    importData,
    currentNodeId: importData.metadata.rootNodeId,
    hasDiverged: false,
  };
}

/**
 * Get the current node from replay data.
 */
export function getReplayCurrentNode(
  state: ReplayState
): WorldLineNode | null {
  if (!state.importData || !state.currentNodeId) return null;
  return (
    state.importData.nodes.find((n) => n.id === state.currentNodeId) ?? null
  );
}

/**
 * Get children of a node from replay data.
 */
export function getReplayChildren(
  state: ReplayState,
  nodeId: string
): WorldLineNode[] {
  if (!state.importData) return [];
  return state.importData.nodes.filter((n) => n.parentId === nodeId);
}

/**
 * Advance to a child node matching the player's input.
 * Returns the next node if found, null if no match (divergence).
 */
export function replayAdvance(
  state: ReplayState,
  playerInput: string,
  identity?: string
): {
  nextState: ReplayState;
  nextNode: WorldLineNode | null;
  isDiverged: boolean;
  isEndReached: boolean;
} {
  if (!state.active || !state.importData || !state.currentNodeId) {
    return {
      nextState: state,
      nextNode: null,
      isDiverged: false,
      isEndReached: true,
    };
  }

  const currentNode = getReplayCurrentNode(state);
  if (!currentNode) {
    return {
      nextState: state,
      nextNode: null,
      isDiverged: false,
      isEndReached: true,
    };
  }

  // No branch mode: find the first child (ignore player input, just advance)
  if (state.mode === "no_branch") {
    const children = getReplayChildren(state, currentNode.id);

    if (children.length === 0) {
      return {
        nextState: { ...state, currentNodeId: null },
        nextNode: null,
        isDiverged: false,
        isEndReached: true,
      };
    }

    // Follow first child (main path)
    const nextNode = children[0];

    return {
      nextState: {
        ...state,
        currentNodeId: nextNode.id,
      },
      nextNode,
      isDiverged: false,
      isEndReached: false,
    };
  }

  // Branch mode: try to match player input to a child
  if (state.mode === "branch") {
    const children = getReplayChildren(state, currentNode.id);

    // Try exact match
    const matched = children.find(
      (c) => matchesActionInput(c, playerInput, identity)
    );

    if (matched) {
      // Exact match — continue replay
      return {
        nextState: { ...state, currentNodeId: matched.id },
        nextNode: matched,
        isDiverged: false,
        isEndReached: false,
      };
    }

    // Check if there are children at all
    if (children.length === 0) {
      return {
        nextState: state,
        nextNode: null,
        isDiverged: false,
        isEndReached: true,
      };
    }

    // Player's input differs from all stored children — DIVERGENCE
    return {
      nextState: {
        ...state,
        hasDiverged: true,
        currentNodeId: null,
      },
      nextNode: null,
      isDiverged: true,
      isEndReached: false,
    };
  }

  return {
    nextState: state,
    nextNode: null,
    isDiverged: false,
    isEndReached: true,
  };
}

/**
 * Get the snapshot for the current replay node (from import data).
 */
export function getReplaySnapshot(
  state: ReplayState,
  nodeId: string
): any | null {
  if (!state.importData) return null;
  const node = state.importData.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return state.importData.snapshots[node.snapshotHash] ?? null;
}

/**
 * Get the segments for the current replay node.
 */
export function getReplaySegments(state: ReplayState, nodeId: string): any[] {
  if (!state.importData) return [];
  const node = state.importData.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  return state.importData.segments[node.segmentHash] ?? [];
}

/**
 * Exit replay.
 */
export function exitReplay(state: ReplayState): ReplayState {
  return createReplayState();
}
