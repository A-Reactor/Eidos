import { useGameStore } from '@/store/game-store';
import { hashAndStore } from '@/lib/game/cas-storage';
import type { StorySegment } from '@/lib/ai/types';
import type { WorldLineNode } from '@/lib/game/types';

/** Real branch persistence with deterministic narrative responses on the isolated preview port. */
export async function seedHistoryBranch() {
  const state = useGameStore.getState(), world = state.currentWorld!;
  const pastLines: StorySegment[] = [{ type: 'narration', text: '你来到渡口，尚未决定往哪边走。' }];
  const nowLines: StorySegment[] = [{ type: 'narration', text: '你已走到旧钟楼前。回看渡口，可以另作选择。' }];
  const [snapshotHash, pastHash, nowHash] = await Promise.all([
    hashAndStore('snapshot', state.createSnapshot()), hashAndStore('segments', pastLines), hashAndStore('segments', nowLines),
  ]);
  if (useGameStore.getState().currentPlaythroughId !== 'history-branch-preview') return;
  const past: WorldLineNode = { id: 'history-dock', parentId: null, childIds: ['history-tower'], stepNumber: 3,
    playerInput: '来到渡口', aiResponse: pastLines[0].text, playerVisibleText: pastLines[0].text, summary: '渡口',
    snapshotHash, segmentHash: pastHash, createdAt: 1, gameTime: state.gameTime, dayNumber: 3,
    sceneId: state.currentSceneId, sceneName: '渡口', timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [],
    availableActions: ['询问船夫'], generationComplete: true };
  const now: WorldLineNode = { ...past, id: 'history-tower', parentId: past.id, childIds: [], stepNumber: 6,
    playerInput: '来到旧钟楼', aiResponse: nowLines[0].text, playerVisibleText: nowLines[0].text, segmentHash: nowHash };
  const real = useGameStore.getInitialState();
  useGameStore.setState({ addActionNode: real.addActionNode, tryMatchChildNode: real.tryMatchChildNode, backtrackToNode: real.backtrackToNode,
    currentNode: now, allNodes: { [past.id]: past, [now.id]: now }, savedSegments: nowLines, savedSegmentIndex: 0,
    savedIsShowingSegments: false, readingView: null, readingSegments: null, sceneNarrative: now.aiResponse, availableActions: ['询问船夫'],
    worldLine: { id: 'history-branch-preview', worldId: world.id, playthroughId: 'history-branch-preview', rootNodeId: past.id,
      currentNodeId: now.id, allNodeIds: [past.id, now.id], totalSteps: 6, branchCount: 0, createdAt: 0, updatedAt: 0 } });
}
