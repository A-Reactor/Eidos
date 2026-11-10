import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorldSigil } from "@/components/ui/WorldSigil";
import {
  createSigilModel,
  type SigilPrimitiveKind,
} from "@/lib/ui/sigil";

const SUPPORTED_KINDS = new Set<SigilPrimitiveKind>([
  "line",
  "ring",
  "diamond",
  "bracket",
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSigilModel", () => {
  it("returns the same model for the same seed", () => {
    expect(createSigilModel("rift-city")).toEqual(
      createSigilModel("rift-city"),
    );
  });

  it("keeps the canonical rift-city model stable", () => {
    expect(createSigilModel("rift-city")).toEqual([
      {
        kind: "ring",
        x: 21.82111271098256,
        y: 83.97967973724008,
        size: 9.916965228505433,
        rotation: 24.62201633490622,
        accent: true,
      },
      {
        kind: "diamond",
        x: 36.514362240210176,
        y: 67.80482265725732,
        size: 12.163541193120182,
        rotation: 131.65073750540614,
        accent: true,
      },
      {
        kind: "ring",
        x: 27.815539628267288,
        y: 48.98809453845024,
        size: 11.241000878624618,
        rotation: 291.06769510544837,
        accent: true,
      },
      {
        kind: "diamond",
        x: 51.11631187237799,
        y: 14.607993919402361,
        size: 12.8408298259601,
        rotation: 226.2770135421306,
        accent: true,
      },
      {
        kind: "bracket",
        x: 84.73771103098989,
        y: 80.63184412755072,
        size: 12.567964257672429,
        rotation: 60.60920395888388,
        accent: false,
      },
      {
        kind: "line",
        x: 31.508301684632897,
        y: 42.67923334799707,
        size: 14.088773497380316,
        rotation: 87.32628185302019,
        accent: false,
      },
      {
        kind: "bracket",
        x: 72.72458690963686,
        y: 61.01266949623823,
        size: 8.905291839502752,
        rotation: 143.75624642707407,
        accent: false,
      },
      {
        kind: "diamond",
        x: 74.5820809584111,
        y: 66.8843741863966,
        size: 11.198874017223716,
        rotation: 357.7850952465087,
        accent: false,
      },
      {
        kind: "ring",
        x: 85.55095952004194,
        y: 38.35917052999139,
        size: 9.74777452647686,
        rotation: 191.02020593360066,
        accent: false,
      },
      {
        kind: "line",
        x: 69.55500749126077,
        y: 28.499758725985885,
        size: 17.191189035773277,
        rotation: 21.642831042408943,
        accent: false,
      },
      {
        kind: "bracket",
        x: 47.67776792682707,
        y: 59.691196059808135,
        size: 12.743281211704016,
        rotation: 50.67230209708214,
        accent: false,
      },
      {
        kind: "ring",
        x: 60.35847221314907,
        y: 61.533731227740645,
        size: 16.71794988401234,
        rotation: 116.75693334080279,
        accent: false,
      },
      {
        kind: "ring",
        x: 25.86154630407691,
        y: 31.448909966275096,
        size: 12.211502828635275,
        rotation: 137.26725979708135,
        accent: false,
      },
      {
        kind: "line",
        x: 73.76484072208405,
        y: 27.450055273249745,
        size: 14.307410990819335,
        rotation: 342.3548409808427,
        accent: false,
      },
    ]);
  });

  it("returns different models for different seeds", () => {
    expect(createSigilModel("rift-city")).not.toEqual(
      createSigilModel("floating-islands"),
    );
  });

  it("emits only supported primitive kinds", () => {
    for (const primitive of createSigilModel("kind-check")) {
      expect(SUPPORTED_KINDS.has(primitive.kind)).toBe(true);
    }
  });

  it("emits between ten and sixteen primitives", () => {
    const model = createSigilModel("count-check");

    expect(model.length).toBeGreaterThanOrEqual(10);
    expect(model.length).toBeLessThanOrEqual(16);
  });

  it("keeps geometry finite and reasonably inside the viewbox", () => {
    for (const primitive of createSigilModel("geometry-check")) {
      expect(Number.isFinite(primitive.x)).toBe(true);
      expect(Number.isFinite(primitive.y)).toBe(true);
      expect(Number.isFinite(primitive.size)).toBe(true);
      expect(Number.isFinite(primitive.rotation)).toBe(true);
      expect(primitive.x).toBeGreaterThanOrEqual(10);
      expect(primitive.x).toBeLessThanOrEqual(90);
      expect(primitive.y).toBeGreaterThanOrEqual(10);
      expect(primitive.y).toBeLessThanOrEqual(90);
      expect(primitive.size).toBeGreaterThanOrEqual(4);
      expect(primitive.size).toBeLessThanOrEqual(20);
      expect(primitive.rotation).toBeGreaterThanOrEqual(0);
      expect(primitive.rotation).toBeLessThan(360);
    }
  });

  it("keeps rendered extents inside the viewbox across many seeds", () => {
    const strokeWidth = 1.5;

    for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
      for (const primitive of createSigilModel(`bounds-${seedIndex}`)) {
        const halfExtent =
          primitive.kind === "ring"
            ? primitive.size / 2 + strokeWidth / 2
            : primitive.size / Math.SQRT2 + strokeWidth / Math.SQRT2;

        expect(primitive.x - halfExtent).toBeGreaterThanOrEqual(0);
        expect(primitive.x + halfExtent).toBeLessThanOrEqual(100);
        expect(primitive.y - halfExtent).toBeGreaterThanOrEqual(0);
        expect(primitive.y + halfExtent).toBeLessThanOrEqual(100);
      }
    }
  });

  it("keeps accent primitives to at most one third of the model", () => {
    const model = createSigilModel("accent-check");
    const accentCount = model.filter((primitive) => primitive.accent).length;

    expect(accentCount).toBeLessThanOrEqual(Math.floor(model.length / 3));
  });

  it("produces a valid deterministic model for an empty seed", () => {
    const first = createSigilModel("");

    expect(first).toEqual(createSigilModel(""));
    expect(first.length).toBeGreaterThanOrEqual(10);
  });

  it("does not depend on ambient Math.random", () => {
    const randomSpy = vi
      .spyOn(Math, "random")
      .mockImplementation(() => {
        throw new Error("ambient randomness used");
      });

    expect(() => createSigilModel("local-randomness")).not.toThrow();
    expect(randomSpy).not.toHaveBeenCalled();
  });
});

describe("WorldSigil", () => {
  it("server-renders an accessible SVG with caller styling", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorldSigil, {
        seed: "rift-city",
        accent: "#7357ff",
        className: "world-mark",
        label: "Rift City sigil",
      }),
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Rift City sigil"');
    expect(markup).toContain('viewBox="0 0 100 100"');
    expect(markup).toContain('class="world-mark"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke="#7357ff"');
  });

  it("renders every primitive kind as a distinct SVG shape", () => {
    const seed = Array.from({ length: 1_000 }, (_, index) => `shapes-${index}`)
      .find(
        (candidate) =>
          new Set(createSigilModel(candidate).map(({ kind }) => kind)).size ===
          SUPPORTED_KINDS.size,
      );

    expect(seed).toBeDefined();
    const markup = renderToStaticMarkup(
      React.createElement(WorldSigil, {
        seed: seed!,
        accent: "#7357ff",
        label: "Shape coverage sigil",
      }),
    );

    expect(markup).toContain("<line");
    expect(markup).toContain("<circle");
    expect(markup).toContain("<polygon");
    expect(markup).toContain("<path");
  });

  it("server-renders without unsafe identifiers or animation", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorldSigil, {
        seed: "server-safe",
        accent: "#7357ff",
        label: "Server-safe sigil",
      }),
    );

    expect(markup).not.toMatch(/\sid=/);
    expect(markup).not.toContain("<animate");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });
});
