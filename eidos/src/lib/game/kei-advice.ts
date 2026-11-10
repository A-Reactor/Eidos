import type { StoreApi } from 'zustand';
import type { GameStore } from '@/store/game-store';
import type { KeiReviewResult, KeiStateProposal } from '@/lib/ai/types';
import { archiveScopeSessionValue } from './archive-scope';
import { createStreamContinuationScope, isCurrentKeiReview, isKeiReviewOnCurrentBranch } from './stream-lifecycle';
import { buildKeiValidationContext, submitKeiStateVerification } from '@/lib/ai/kei-review';
import { appendKeiReviewAudit } from '@/lib/ai/kei-review-audit';
import { buildMetaRealityPromptContext } from '@/lib/meta-reality/artifacts';
import { loadSettings } from './settings';

interface Advice { result: KeiReviewResult; receivedAtAction: string | undefined; npcBehaviorsAtReceipt: GameStore['npcBehaviors']; promptActivated: boolean }
interface Inbox {
  scope: string; newest: number; blockingWatermark: number; blockingChangedFacts: boolean;
  pending: Map<string, Advice>; proposals: Map<string, Advice>; seen: Set<string>;
}
const inboxes = new WeakMap<StoreApi<GameStore>, Inbox>();
export function clearKeiAdvice(store: StoreApi<GameStore>): void { inboxes.delete(store); }
function inboxFor(store: StoreApi<GameStore>): Inbox {
  const s = store.getState();
  const scope = JSON.stringify([s.currentWorld?.id, s.currentPlaythroughId, archiveScopeSessionValue(s)]);
  let inbox = inboxes.get(store);
  if (!inbox || inbox.scope !== scope) {
    inbox = { scope, newest: 0, blockingWatermark: 0, blockingChangedFacts: false, pending: new Map(), proposals: new Map(), seen: new Set() };
    inboxes.set(store, inbox);
  }
  return inbox;
}
function validAdvice(result: KeiReviewResult, s: GameStore): boolean {
  if (!result._reviewOrigin || !isKeiReviewOnCurrentBranch(result._reviewOrigin, s) || result._reviewSceneId !== s.currentSceneId) return false;
  const index = s.history.findIndex(h => h.id === result._reviewOrigin!.actionId);
  return index >= 0 && s.history.length - 1 - index <= 2;
}
function audit(result: KeiReviewResult, phase: 'staged' | 'activated' | 'discarded', reason?: 'context_changed' | 'newer_review') {
  if (result._reviewOrigin) appendKeiReviewAudit({ timestamp: Date.now(), origin: result._reviewOrigin, mode: result._reviewMode, level: result._reviewLevel, phase, reason });
}
function stateProposal(result: KeiReviewResult): KeiStateProposal | null {
  const raw = result.correctedUpdates;
  // Old in-flight reviews may still carry retired fields; only current corrections can trigger work.
  const cu = raw ? { encyclopediaUpdates: raw.encyclopediaUpdates, criticalFactsDiscovered: raw.criticalFactsDiscovered,
    questsDiscovered: raw.questsDiscovered, encyclopediaDeletions: raw.encyclopediaDeletions } : undefined;
  const corrections = !result.approved && cu && Object.values(cu).some(a => Array.isArray(a) && a.length) ? cu : undefined;
  const npcBehaviorUpdates = !result.approved && result.npcBehaviorUpdates?.length ? result.npcBehaviorUpdates : undefined;
  if (!corrections && !npcBehaviorUpdates && !result.projectionVerifications?.length) return null;
  return { correctedUpdates: corrections, npcBehaviorUpdates, projectionVerifications: result.projectionVerifications };
}

/** Background results never mutate live facts or invalidate an already generated response. */
export function stageKeiAdvice(store: StoreApi<GameStore>, result: KeiReviewResult): boolean {
  if (!loadSettings().enableContentReview) { clearKeiAdvice(store); return false; }
  const s = store.getState(); const inbox = inboxFor(store); const seq = result._reviewSequence;
  if (result._reviewMode !== 'background' || !Number.isSafeInteger(seq) || !seq || !validAdvice(result, s)) {
    audit(result, 'discarded', 'context_changed'); return false;
  }
  const key = `${seq}:${result._reviewLevel ?? 'quality'}`;
  const sameBlockingBatch = seq === inbox.blockingWatermark && result._reviewLevel === 'causal' && !inbox.blockingChangedFacts;
  if (seq < inbox.newest || seq < inbox.blockingWatermark || (seq === inbox.blockingWatermark && !sameBlockingBatch) || inbox.seen.has(key)) {
    audit(result, 'discarded', 'newer_review'); return false;
  }
  if (seq > inbox.newest) {
    inbox.pending.forEach(a => audit(a.result, 'discarded', 'newer_review'));
    inbox.pending.clear(); inbox.proposals.clear(); inbox.seen.clear(); inbox.newest = seq;
  }
  inbox.seen.add(key);
  const advice = { result, receivedAtAction: s.history.at(-1)?.id, npcBehaviorsAtReceipt: s.npcBehaviors, promptActivated: false };
  inbox.pending.set(key, advice);
  if (stateProposal(result)) inbox.proposals.set(key, advice);
  audit(result, 'staged'); return true;
}

function applyPromptAdvice(advice: Advice, s: GameStore): boolean {
  const result = advice.result;
  // Causal replies share a sequence with quality; they cannot replace its director frame.
  // An omitted field keeps existing guidance; explicit null lets KEI withdraw it.
  if (advice.promptActivated || result._reviewLevel === 'causal' || result.directorFrame === undefined) return false;
  s.setDirectorFrame(result.directorFrame, result._reviewOrigin); advice.promptActivated = true;
  return true;
}

/** Load ready guidance before capturing a new request's snapshot. Existing requests stay immutable. */
export function activateKeiPromptAdvice(store: StoreApi<GameStore>): boolean {
  if (!loadSettings().enableContentReview) { clearKeiAdvice(store); return false; }
  const inbox = inboxFor(store); const s = store.getState(); let activated = false;
  for (const [key, advice] of inbox.pending) {
    if (!validAdvice(advice.result, s)) { inbox.pending.delete(key); audit(advice.result, 'discarded', 'context_changed'); continue; }
    if (applyPromptAdvice(advice, s)) { audit(advice.result, 'activated'); activated = true; }
  }
  return activated;
}

/** Called after committing a new action's state, before storing its snapshot and predicting another. */
export function activateKeiAdvice(store: StoreApi<GameStore>, npcsInNewResponse: string[] = []): boolean {
  if (!loadSettings().enableContentReview) { clearKeiAdvice(store); return false; }
  const inbox = inboxFor(store); const s = store.getState(); let activated = false;
  for (const [key, advice] of inbox.pending) {
    if (!validAdvice(advice.result, s)) { inbox.pending.delete(key); audit(advice.result, 'discarded', 'context_changed'); continue; }
    if (advice.receivedAtAction === s.history.at(-1)?.id) continue;
    inbox.pending.delete(key);
    const result = advice.result;
    const promptWasActivated = advice.promptActivated;
    applyPromptAdvice(advice, s);
    if (result.approved) {
      result.npcBehaviorUpdates?.forEach(u => {
        // A newer response involving this NPC owns its behavior; an old suggestion cannot overwrite it.
        if (npcsInNewResponse.includes(u.npcName) || JSON.stringify(s.npcBehaviors[u.npcName]) !== JSON.stringify(advice.npcBehaviorsAtReceipt[u.npcName])) return;
        s.setNpcBehavior(u.npcName, { currentScene: s.currentSceneId, currentActivity: u.currentActivity, currentMood: u.currentMood,
          interactingWith: u.interactingWith ?? [], source: 'kei_update' });
      });
    }
    const ripples = result.causalProjections?.filter(r => typeof r.confidence === 'number' && r.confidence >= 0.4);
    if (ripples?.length) {
      s.setCausalProjections([{ actionDescription: s.history.at(-1)?.playerInput ?? '', generatedAt: { ...s.gameTime }, rippleEffects: ripples.map((r, i) => ({
        ...r, id: `ripple_${result._reviewSequence}_${result._reviewLevel}_${i}`, status: 'pending' as const, createdAt: Date.now(), resolvedAt: null, resolutionNote: '',
      })) }]);
    }
    if (!promptWasActivated) audit(result, 'activated');
    activated = true;
  }
  return activated;
}

export function noteKeiReviewApplied(store: StoreApi<GameStore>, result: KeiReviewResult, factsChanged = true): void {
  const inbox = inboxFor(store); const seq = result._reviewSequence;
  if (!seq || seq < inbox.newest) return;
  inbox.newest = seq; inbox.blockingWatermark = seq; inbox.blockingChangedFacts = factsChanged;
  for (const [key, advice] of inbox.pending) {
    if (factsChanged || advice.result._reviewSequence !== seq || advice.result._reviewLevel !== 'causal') inbox.pending.delete(key);
  }
  for (const [key, advice] of inbox.proposals) {
    if (factsChanged || advice.result._reviewSequence !== seq || advice.result._reviewLevel !== 'causal') inbox.proposals.delete(key);
  }
}

/** Consume once at an input boundary; only a fresh, strictly scoped blocking reply can commit changes. */
export function submitKeiStateVerificationIfNeeded(store: StoreApi<GameStore>): boolean {
  if (!loadSettings().enableContentReview) { clearKeiAdvice(store); return false; }
  const inbox = inboxFor(store); const proposals = [...inbox.proposals.values()]; inbox.proposals.clear();
  if (!proposals.length) return false;
  const s = store.getState();
  const valid = proposals.filter(a => {
    if (validAdvice(a.result, s)) return true;
    audit(a.result, 'discarded', 'context_changed'); return false;
  });
  if (!s.currentWorld || !valid.length) return false;
  const latest = s.history.at(-1); if (!latest) return false;
  const scope = createStreamContinuationScope(s);
  const origin = { worldId: scope.worldId, playthroughId: scope.playthroughId, archiveScope: scope.archiveScope, worldLineId: scope.worldLineId,
    parentNodeId: s.currentNode?.actionId === latest.id ? s.currentNode.parentId : scope.nodeId, actionId: latest.id };
  const snapshot = s.createSnapshot();
  submitKeiStateVerification(s.currentWorld, snapshot, buildKeiValidationContext(s.inventory, s.clues, s.encyclopedia, s.criticalFacts, s.questLog), {
    origin, stateProposal: mergeProposals(valid.map(a => stateProposal(a.result)).filter((p): p is KeiStateProposal => p !== null)), continuationSceneId: s.currentSceneId,
    metaRealityContext: buildMetaRealityPromptContext({ artifacts: s.realityArtifacts, boundaryEvents: s.boundaryEvents, manifest: s.metaChannelManifest ?? s.currentWorld.metaChannelManifest ?? null }),
    narrativeContext: { playerInput: latest.playerInput, responseText: latest.aiResponse, recentHistory: s.history.slice(-5) },
    isCurrent: () => isCurrentKeiReview(origin, store.getState()),
  });
  return true;
}

function mergeProposals(proposals: KeiStateProposal[]): KeiStateProposal {
  const merged: KeiStateProposal = {};
  const correctedUpdates: NonNullable<KeiStateProposal['correctedUpdates']> = {};
  for (const p of proposals) {
    if (p.correctedUpdates) for (const key of Object.keys(p.correctedUpdates) as Array<keyof typeof correctedUpdates>) {
      const values = [...(correctedUpdates[key] ?? []), ...(p.correctedUpdates[key] ?? [])];
      Object.assign(correctedUpdates, { [key]: [...new Map(values.map(v => [JSON.stringify(v), v])).values()] });
    }
    if (p.npcBehaviorUpdates) merged.npcBehaviorUpdates = [...(merged.npcBehaviorUpdates ?? []), ...p.npcBehaviorUpdates];
    if (p.projectionVerifications) merged.projectionVerifications = [...(merged.projectionVerifications ?? []), ...p.projectionVerifications];
  }
  if (Object.keys(correctedUpdates).length) merged.correctedUpdates = correctedUpdates;
  return merged;
}
