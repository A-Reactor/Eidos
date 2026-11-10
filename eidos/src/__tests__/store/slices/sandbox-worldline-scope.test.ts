import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  saveMeta: vi.fn(),
  loadMeta: vi.fn(),
}));

vi.mock("@/lib/game/storage", () => storage);

import { createWorldLineSlice, type WorldLineSlice } from "@/store/slices/worldline-slice";

type TestState = WorldLineSlice & {
  sandboxMode: boolean;
  sandboxDossierId: string | null;
};

function createTestStore() {
  const state: Partial<TestState> = {
    sandboxMode: true,
    sandboxDossierId: "002",
  };
  const set = (
    partial:
      | Record<string, unknown>
      | ((current: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    Object.assign(state, typeof partial === "function" ? partial(state as Record<string, unknown>) : partial);
  };
  const get = () => state;
  Object.assign(state, createWorldLineSlice(set, get));
  return state as TestState;
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.loadMeta.mockResolvedValue(null);
  storage.saveMeta.mockResolvedValue(undefined);
});

describe("WorldLineSlice sandbox storage scope", () => {
  it("initializes worldline data inside the sandbox dossier", async () => {
    const store = createTestStore();

    const worldLineId = await store.initWorldLine("pt_sandbox", "sandbox-world");

    expect(worldLineId).toMatch(/^worldline_/);
    expect(storage.loadMeta).toHaveBeenCalledWith("sandbox_002_worldline_index_sandbox-world");
    expect(storage.saveMeta).toHaveBeenCalledWith(
      `sandbox_002_worldline_data_${worldLineId}`,
      expect.objectContaining({
        meta: expect.objectContaining({
          id: worldLineId,
          playthroughId: "pt_sandbox",
          worldId: "sandbox-world",
        }),
      }),
    );
    expect(storage.saveMeta).toHaveBeenCalledWith(
      "sandbox_002_worldline_index_sandbox-world",
      expect.arrayContaining([expect.objectContaining({ id: worldLineId })]),
    );
    expect(storage.loadMeta).not.toHaveBeenCalledWith("worldline_index_sandbox-world");
    expect(storage.saveMeta).not.toHaveBeenCalledWith(
      expect.stringMatching(/^worldline_data_/),
      expect.anything(),
    );
  });
});
