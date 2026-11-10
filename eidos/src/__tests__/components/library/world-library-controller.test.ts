import { describe, expect, it, vi } from "vitest";

import { createWorldContinuity } from "@/components/library/world-library-controller";
import type { WorldDefinition } from "@/lib/game/types";

const world = { id: "world-a" } as WorldDefinition;

function dependencies() {
  return {
    setCurrentWorld: vi.fn(),
    createPlaythrough: vi.fn().mockResolvedValue("pt-a"),
    setCurrentPlaythrough: vi.fn<(playthroughId: string | null) => void>(),
    initWorldLine: vi.fn().mockResolvedValue(undefined),
    deletePlaythrough: vi.fn().mockResolvedValue(undefined),
    enterIdentityPhase: vi.fn(),
  };
}

describe("createWorldContinuity", () => {
  it("enters identity only after world-line initialization succeeds", async () => {
    const deps = dependencies();

    await expect(createWorldContinuity(world, deps)).resolves.toBe(true);

    expect(deps.setCurrentWorld).toHaveBeenCalledWith(world);
    expect(deps.setCurrentPlaythrough).toHaveBeenCalledWith("pt-a");
    expect(deps.initWorldLine).toHaveBeenCalledWith("pt-a", world.id);
    expect(deps.deletePlaythrough).not.toHaveBeenCalled();
    expect(deps.enterIdentityPhase).toHaveBeenCalledTimes(1);
  });

  it("rolls back the playthrough and does not enter identity when initialization fails", async () => {
    const deps = dependencies();
    deps.initWorldLine.mockRejectedValue(new Error("world-line unavailable"));

    await expect(createWorldContinuity(world, deps)).resolves.toBe(false);

    expect(deps.deletePlaythrough).toHaveBeenCalledWith("pt-a");
    expect(deps.setCurrentPlaythrough).toHaveBeenLastCalledWith(null);
    expect(deps.enterIdentityPhase).not.toHaveBeenCalled();
  });
});
