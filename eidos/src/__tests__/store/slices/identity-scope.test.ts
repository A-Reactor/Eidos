// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { IdentityOption } from "@/lib/game/types";
import { loadIdentityOptions, saveIdentityOptions } from "@/store/slices/save-slice";

const options = [
  {
    id: "observer",
    name: "观测员",
    description: "在沙箱中观察世界的人。",
    startingScene: "lab",
    openingNarrative: "灯亮了。",
  },
] satisfies IdentityOption[];

afterEach(() => {
  localStorage.clear();
});

describe("identity option storage scope", () => {
  it("keeps sandbox identity options separate from ordinary world identity options", () => {
    saveIdentityOptions("same-world", [{ ...options[0], id: "ordinary" }]);
    saveIdentityOptions("same-world", options, {
      sandboxMode: true,
      sandboxDossierId: "002",
    });

    expect(localStorage.getItem("eidos_identity_same-world")).toContain("ordinary");
    expect(localStorage.getItem("sandbox_002_eidos_identity_same-world")).toContain("observer");
    expect(loadIdentityOptions("same-world")?.[0]?.id).toBe("ordinary");
    expect(loadIdentityOptions("same-world", {
      sandboxMode: true,
      sandboxDossierId: "002",
    })?.[0]?.id).toBe("observer");
  });
});
