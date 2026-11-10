import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { WorldLineNode } from '../types';

export function updateWorkspaceNode(store: StoreApi<GameStore>, node: WorldLineNode): void {
  const live = store.getState();
  store.setState({ currentNode: live.currentNode?.id === node.id ? node : live.currentNode,
    allNodes: { ...live.allNodes, [node.id]: node },
    history: live.history.map(action => action.id === node.actionId ? { ...action, workspaceBranch: node.workspaceBranch, workspaceEffects: node.workspaceEffects,
      aiResponse: node.aiResponse, availableActions: node.availableActions } : action) });
}
