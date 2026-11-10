import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { KeiReviewResult } from '@/lib/ai/types';
import { isKeiReviewOnCurrentBranch } from '../stream-lifecycle';
import { loadSettings } from '../settings';
import { persistKeiReviewSnapshot } from '../kei-snapshot-persistence';
import { chapterNarrativeEnabled } from './context';
import { parseChapterBasis, parseChapterDecision } from './validation';
import { prepareChapterDraft } from './state';

/** A scene change can be the subject of chapter advice. Keep it as a proposal;
 * the next director call must judge it again against all intervening actions. */
export function stageChapterReview(store: StoreApi<GameStore>, result: KeiReviewResult): boolean {
  const s = store.getState(), state = s.chapterState, origin = result._reviewOrigin;
  const basis = parseChapterBasis(result._chapterBasis), decision = parseChapterDecision(result.chapterDecision);
  if (!loadSettings().enableContentReview || !s.currentWorld || !state || !basis || !decision || !origin ||
      !chapterNarrativeEnabled(s.currentWorld, s.createSnapshot()) || !isKeiReviewOnCurrentBranch(origin, s) ||
      basis.worldId !== state.worldId || basis.revision !== state.revision || basis.lastActionId !== origin.actionId) return false;
  const source = state.experiences.findIndex(e => e.actionId === basis.lastActionId);
  if (source < 0) return false;
  const pendingIndex = state.pending ? state.experiences.findIndex(e => e.actionId === state.pending!.basis.lastActionId) : -1;
  if (pendingIndex >= source) return false;
  try {
    // Reject references to another branch or prose that did not exist at review time.
    prepareChapterDraft({ ...state, experiences: state.experiences.slice(0, source + 1) }, decision);
  } catch { return false; }
  store.setState({ chapterState: { ...state, pending: { basis, decision } } });
  return true;
}

/** Attach advisory memory to the current accepted node, never to an older source node. */
export function persistChapterAdvice(store: StoreApi<GameStore>, result: KeiReviewResult): Promise<void> {
  const s = store.getState(), latest = s.history.at(-1), origin = result._reviewOrigin;
  if (!origin || !latest || !s.chapterState?.pending || !isKeiReviewOnCurrentBranch(origin, s)) return Promise.resolve();
  return persistKeiReviewSnapshot(store, { ...origin, actionId: latest.id,
    parentNodeId: s.currentNode?.actionId === latest.id ? s.currentNode.parentId : s.currentNode?.id ?? null }, s.createSnapshot());
}
