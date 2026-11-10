import type { WorldLineNode } from './types';

/** Only an accepted, persisted current action may launch a game ability. */
export async function applyGameRewindRequest(store: { getState: () => {
  currentNode: WorldLineNode | null;
  backtrackToNode: (id: string, request: { sourceNodeId: string; reason: string }) => Promise<void>;
  recordRewindFailure?: (nodeId: string, target: string, reason: string) => void;
} }, node: WorldLineNode | null): Promise<boolean> {
  if (!node || store.getState().currentNode?.id !== node.id || node.summary.startsWith('[旁观剧情，主角未知]')) return false;
  const impact = node.worldImpacts.find(i => /^\[BACKTRACK:[^\]]+\]/.test(i));
  if (!impact) return false;
  const match = impact.match(/^\[BACKTRACK:([^\]]+)\]\s*([\s\S]*)$/)!;
  try {
    if (!match[2].trim()) throw new Error('回溯请求缺少游戏判定的发动原因');
    await store.getState().backtrackToNode(match[1], { sourceNodeId: node.id, reason: match[2].trim() });
  } catch (error) {
    store.getState().recordRewindFailure?.(node.id, match[1], error instanceof Error ? error.message : '执行失败');
    throw error;
  }
  return store.getState().currentNode?.id !== node.id;
}
