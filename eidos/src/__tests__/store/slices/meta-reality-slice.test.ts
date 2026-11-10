// @vitest-environment jsdom

// ============================================================
// Eidos · Meta Reality Slice tests
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMetaRealitySlice } from "@/store/slices/meta-reality-slice";
import type { BoundaryEvent, MetaChannelManifest, RealityArtifact } from "@/lib/meta-reality/types";
import type { WorldDefinition } from "@/lib/game/types";

function createHarness() {
  let state: Record<string, any> = {};
  const set = (partial: any) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = { ...state, ...createMetaRealitySlice(set, get) };
  return {
    get state() {
      return state;
    },
  };
}

function makeArtifact(id = "ra_1"): RealityArtifact {
  return {
    id,
    kind: "image",
    label: "sea.png",
    consent: { grantedAt: 100, scope: "summary_only", revocable: true },
    summary: "一张来自边界外的海面图像。",
    visibleTo: ["Niko"],
    introducedAtWorldLineNodeId: "node_1",
    safetyNotes: [],
    createdAt: 100,
  };
}

function makeBoundaryEvent(id = "be_1"): BoundaryEvent {
  return {
    id,
    type: "artifact_introduced",
    actor: "player",
    artifactId: "ra_1",
    worldLineNodeId: "node_1",
    visibleConsequences: ["Niko 第一次看见了海。"],
    hiddenAudit: [],
    createdAt: 101,
  };
}

function makeManifest(): MetaChannelManifest {
  return {
    id: "manifest_gentle",
    title: "温柔同行",
    tone: "gentle",
    channels: [],
    forbiddenMoves: ["不得读取未授权桌面"],
  };
}

describe("createMetaRealitySlice", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts with empty meta reality state", () => {
    const harness = createHarness();

    expect(harness.state.realityArtifacts).toEqual([]);
    expect(harness.state.boundaryEvents).toEqual([]);
    expect(harness.state.metaChannelManifest).toBeNull();
  });

  it("records artifacts, boundary events, and creator manifest", () => {
    const harness = createHarness();

    harness.state.addRealityArtifact(makeArtifact());
    harness.state.addBoundaryEvent(makeBoundaryEvent());
    harness.state.setMetaChannelManifest(makeManifest());

    expect(harness.state.realityArtifacts).toHaveLength(1);
    expect(harness.state.boundaryEvents).toHaveLength(1);
    expect(harness.state.metaChannelManifest.title).toBe("温柔同行");
  });

  it("clears all meta reality state", () => {
    const harness = createHarness();
    harness.state.addRealityArtifact(makeArtifact());
    harness.state.addBoundaryEvent(makeBoundaryEvent());
    harness.state.setMetaChannelManifest(makeManifest());

    harness.state.clearMetaReality();

    expect(harness.state.realityArtifacts).toEqual([]);
    expect(harness.state.boundaryEvents).toEqual([]);
    expect(harness.state.metaChannelManifest).toBeNull();
  });

  it("applies a manifest to the current player-created world and persists the world index", () => {
    const harness = createHarness();
    const world = makeWorld();
    harness.state.currentWorld = world;
    harness.state.playerWorlds = [world];
    harness.state.sandboxMode = false;

    harness.state.applyMetaChannelManifestToCurrentWorld(makeManifest());

    expect(harness.state.metaChannelManifest.title).toBe("温柔同行");
    expect(harness.state.currentWorld.metaChannelManifest.title).toBe("温柔同行");
    expect(harness.state.playerWorlds[0].metaChannelManifest.title).toBe("温柔同行");
    expect(JSON.parse(localStorage.getItem("eidos_player_worlds") ?? "[]")[0].metaChannelManifest.title)
      .toBe("温柔同行");
  });

  it("applies a manifest through the sandbox world updater when the active dossier is sandboxed", () => {
    const harness = createHarness();
    const world = makeWorld("sandbox-world");
    const addSandboxWorld = vi.fn((updatedWorld: WorldDefinition) => {
      harness.state.sandboxWorlds = [updatedWorld];
    });
    harness.state.currentWorld = world;
    harness.state.sandboxWorlds = [world];
    harness.state.sandboxMode = true;
    harness.state.sandboxDossierId = "002";
    harness.state.addSandboxWorld = addSandboxWorld;

    harness.state.applyMetaChannelManifestToCurrentWorld(makeManifest());

    expect(addSandboxWorld).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "sandbox-world",
        metaChannelManifest: expect.objectContaining({ title: "温柔同行" }),
      }),
      "002",
    );
    expect(harness.state.currentWorld.metaChannelManifest.title).toBe("温柔同行");
    expect(harness.state.sandboxWorlds[0].metaChannelManifest.title).toBe("温柔同行");
  });
});

function makeWorld(id = "player-world"): WorldDefinition {
  return {
    id,
    name: "玩家世界",
    subtitle: "",
    overview: "",
    regions: {},
    npcs: {},
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "",
    identityPrompt: "",
    isPlayerCreated: true,
    createdAt: 1,
  };
}
