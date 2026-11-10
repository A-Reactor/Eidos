import { describe, expect, it } from "vitest";
import {
  DEFAULT_EIDOS_THEME,
  resolveThemeForWorld,
  resolveWorldTheme,
} from "@/lib/ui/theme";

function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = color
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );

    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };

  const luminances = [luminance(first), luminance(second)];
  return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
}

describe("resolveWorldTheme", () => {
  it("returns the Eidos defaults without input", () => {
    expect(resolveWorldTheme()).toEqual(DEFAULT_EIDOS_THEME);
  });

  it("keeps a valid world accent", () => {
    expect(resolveWorldTheme({ accent: "#7357ff" }).accent).toBe("#7357ff");
  });

  it("normalizes uppercase hex colors", () => {
    expect(resolveWorldTheme({ accent: "#ABCDEF" }).accent).toBe("#abcdef");
  });

  it("rejects invalid color input", () => {
    expect(resolveWorldTheme({ accent: "purple" }).accent).toBe(
      DEFAULT_EIDOS_THEME.accent,
    );
  });

  it.each(["#fff", "#12345678"])("rejects non-six-digit hex color %s", (accent) => {
    expect(resolveWorldTheme({ accent }).accent).toBe(DEFAULT_EIDOS_THEME.accent);
  });

  it("corrects unreadable paper and ink combinations", () => {
    const theme = resolveWorldTheme({ paper: "#ffffff", ink: "#fefefe" });
    expect(theme.ink).toBe("#181a1d");
  });

  it("selects readable ink for dark paper", () => {
    const theme = resolveWorldTheme({ paper: "#181a1d", ink: "#181a1d" });

    expect(theme.ink).not.toBe("#181a1d");
    expect(contrastRatio(theme.paper, theme.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    { input: -0.1, expected: 0 },
    { input: 1.1, expected: 1 },
  ])("clamps motion intensity $input to $expected", ({ input, expected }) => {
    expect(resolveWorldTheme({ motionIntensity: input }).motionIntensity).toBe(
      expected,
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "uses the default motion intensity for non-finite input %s",
    (motionIntensity) => {
      expect(resolveWorldTheme({ motionIntensity }).motionIntensity).toBe(
        DEFAULT_EIDOS_THEME.motionIntensity,
      );
    },
  );
});

describe("resolveThemeForWorld", () => {
  it("normalizes generated palette colors and uses the world id as its sigil seed", () => {
    expect(resolveThemeForWorld({
      id: "paper-city",
      visualConfig: {
        artDirection: {
          colorPalette: ["#ABCDEF", "not-a-color"],
        },
      },
    })).toMatchObject({
      accent: "#abcdef",
      accentMuted: DEFAULT_EIDOS_THEME.accentMuted,
      sigilSeed: "paper-city",
    });
  });

  it("returns the default theme when there is no active world", () => {
    expect(resolveThemeForWorld(null)).toEqual(DEFAULT_EIDOS_THEME);
  });
});
