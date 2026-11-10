import { beforeEach, describe, expect, it } from "vitest";

import {
  abortActiveStream,
  createStreamRequestScope,
  setActiveStream,
  setPendingResult,
  hasActiveStream,
  takePendingResult,
  storePendingKeiApplication,
  takePendingKeiApplication,
  isCurrentKeiReview,
} from "@/lib/game/stream-lifecycle";

function currentScope(
  worldId: string,
  playthroughId: string,
  sandboxMode = false,
  sandboxDossierId: string | null = null,
) {
  return createStreamRequestScope({
    currentWorld: { id: worldId },
    currentPlaythroughId: playthroughId,
    sandboxMode,
    sandboxDossierId,
  });
}

describe("stream lifecycle scoped pending results", () => {
  beforeEach(() => {
    abortActiveStream();
  });

  it("does not deliver a completed stream result to a different world/playthrough", () => {
    const oldScope = currentScope("rift-city", "pt_rift");
    setActiveStream(new AbortController(), oldScope);
    setPendingResult({
      event: { type: "done", narrative: "旧世界对话" },
      input: "旧世界行动",
      scope: oldScope,
    });

    const leaked = takePendingResult(currentScope("sandbox-world", "pt_sandbox", true, "002"));

    expect(leaked).toBeNull();
    expect(takePendingResult(oldScope)).toBeNull();
  });

  it("delivers a pending result when returning to the same scoped playthrough", () => {
    const scope = currentScope("rift-city", "pt_rift");
    setActiveStream(new AbortController(), scope);
    setPendingResult({
      event: { type: "done", narrative: "同一世界结果" },
      input: "继续行动",
      scope,
    });

    expect(takePendingResult(currentScope("rift-city", "pt_rift"))).toEqual({
      event: { type: "done", narrative: "同一世界结果" },
      input: "继续行动",
      scope,
    });
  });

  it("drops stale completion from a superseded request in the same playthrough", () => {
    const oldScope = currentScope("rift-city", "pt_rift");
    setActiveStream(new AbortController(), oldScope);

    const newScope = currentScope("rift-city", "pt_rift");
    setActiveStream(new AbortController(), newScope);

    setPendingResult({
      event: { type: "done", narrative: "被新请求覆盖的旧结果" },
      input: "旧请求",
      scope: oldScope,
    });

    expect(takePendingResult(newScope)).toBeNull();
  });

  it("reports active streams only for the matching scoped playthrough", () => {
    const oldScope = currentScope("rift-city", "pt_rift");
    setActiveStream(new AbortController(), oldScope);

    expect(hasActiveStream(currentScope("rift-city", "pt_rift"))).toBe(true);
    expect(hasActiveStream(currentScope("sandbox-world", "pt_sandbox", true, "002"))).toBe(false);
  });
});

const origin = { worldId: 'rift-city', playthroughId: 'pt_rift', worldLineId: 'wl_1', archiveScope: 'ordinary', parentNodeId: 'parent', actionId: 'new_action' };
function keiSource() {
  return { currentWorld: { id: 'rift-city' }, currentPlaythroughId: 'pt_rift', worldLine: { id: 'wl_1' }, currentNode: { id: 'child', actionId: 'new_action' }, history: [{ id: 'new_action' }] };
}
function pendingKei() {
  storePendingKeiApplication({ origin, aliceResponse: {}, world: {}, snapshot: {}, validationContext: '' } as never);
}
describe('committed KEI application scope', () => {
  beforeEach(() => { takePendingKeiApplication(); });
  it('consumes an application once for its accepted action', () => {
    pendingKei();
    expect(takePendingKeiApplication(keiSource())?.origin.actionId).toBe('new_action');
    expect(takePendingKeiApplication(keiSource())).toBeNull();
  });
  it.each([
    ['world', { currentWorld: { id: 'other' } }],
    ['playthrough', { currentPlaythroughId: 'other' }],
    ['world line', { worldLine: { id: 'other' } }],
    ['archive', { sandboxMode: true, sandboxDossierId: '002' }],
    ['branch', { currentNode: { id: 'sibling', actionId: 'other' } }],
    ['backtrack', { currentNode: { id: 'parent' }, history: [] }],
  ])('discards an application after switching %s', (_label, changes) => {
    pendingKei();
    expect(takePendingKeiApplication({ ...keiSource(), ...changes })).toBeNull();
    expect(takePendingKeiApplication(keiSource())).toBeNull();
  });
  it('keeps the accepted action reviewable while its child node is saving', () => {
    pendingKei();
    expect(takePendingKeiApplication({ ...keiSource(), currentNode: { id: 'parent' } })?.origin.actionId).toBe('new_action');
  });
  it('keeps a direct fork reviewable at its captured live head, including a viewed side branch',()=>{
    const fork={...origin,parentNodeId:'viewed-source',expectedHeadId:'live-head'};
    const source={...keiSource(),currentNode:{id:'live-head'},allNodes:{'live-head':{id:'live-head',parentId:null},'viewed-source':{id:'viewed-source',parentId:null}}};
    expect(isCurrentKeiReview(fork,source)).toBe(true);
    expect(isCurrentKeiReview(fork,{...source,currentNode:{id:'other-head'}})).toBe(false);
    expect(isCurrentKeiReview(fork,{...source,history:[]})).toBe(false);
    expect(isCurrentKeiReview(fork,{...source,allNodes:{...source.allNodes,accepted:{id:'accepted',parentId:'viewed-source',actionId:origin.actionId}}})).toBe(false);
  });
  it('keeps the first action reviewable after auto-initialization creates its root', () => {
    storePendingKeiApplication({ origin: { ...origin, worldLineId: null, parentNodeId: null }, aliceResponse: {}, world: {}, snapshot: {}, validationContext: '' } as never);
    expect(takePendingKeiApplication({ ...keiSource(), worldLine: { id: 'new_line', rootNodeId: 'new_root', worldId: origin.worldId, playthroughId: origin.playthroughId }, currentNode: { id: 'new_root' } })?.origin.actionId).toBe('new_action');
  });
  it('rejects a different node during auto-initialization', () => {
    storePendingKeiApplication({ origin: { ...origin, worldLineId: null, parentNodeId: null }, aliceResponse: {}, world: {}, snapshot: {}, validationContext: '' } as never);
    expect(takePendingKeiApplication({ ...keiSource(), worldLine: { id: 'new_line', rootNodeId: 'new_root', worldId: origin.worldId, playthroughId: origin.playthroughId }, currentNode: { id: 'other' } })).toBeNull();
  });
  it('clears an unsubmitted application when leaving the pipeline', () => {
    pendingKei(); abortActiveStream();
    expect(takePendingKeiApplication(keiSource())).toBeNull();
  });
});
