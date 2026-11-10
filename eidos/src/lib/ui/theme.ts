import { readableInk } from './text-contrast';

export type TextureFamily = "lines" | "dots" | "grain" | "field";
export type SceneTemperature = "warm" | "neutral" | "cool";

export interface EidosTheme {
  accent: string;
  accentMuted: string;
  paper: string;
  surface: string;
  ink: string;
  sceneTemperature: SceneTemperature;
  textureFamily: TextureFamily;
  sigilSeed: string;
  motionIntensity: number;
}

export const DEFAULT_EIDOS_THEME = {
  accent: "#dc503c",
  accentMuted: "#5b2f2a",
  paper: "#ebeae3",
  surface: "#15181c",
  ink: "#181a1d",
  sceneTemperature: "neutral",
  textureFamily: "lines",
  sigilSeed: "eidos",
  motionIntensity: 0.35,
} as const satisfies EidosTheme;

export const LIGHT_EIDOS_THEME = {
  accent: "#9e0000",
  accentMuted: "#6f1010",
  paper: "#fafcff",
  surface: "#edf2f8",
  ink: "#050505",
  sceneTemperature: "cool",
  textureFamily: "lines",
  sigilSeed: "eidos-light",
  motionIntensity: 0.28,
} as const satisfies EidosTheme;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function resolveColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

function resolveMotionIntensity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_EIDOS_THEME.motionIntensity;
  }

  return Math.min(1, Math.max(0, value));
}

export function resolveWorldTheme(
  requested: Partial<EidosTheme> = {},
): EidosTheme {
  const paper = resolveColor(requested.paper, DEFAULT_EIDOS_THEME.paper);
  const surface = resolveColor(requested.surface, DEFAULT_EIDOS_THEME.surface);
  const requestedInk = resolveColor(requested.ink, DEFAULT_EIDOS_THEME.ink);
  const ink = readableInk(paper, requestedInk);

  return {
    accent: resolveColor(requested.accent, DEFAULT_EIDOS_THEME.accent),
    accentMuted: resolveColor(
      requested.accentMuted,
      DEFAULT_EIDOS_THEME.accentMuted,
    ),
    paper,
    surface,
    ink,
    sceneTemperature:
      requested.sceneTemperature ?? DEFAULT_EIDOS_THEME.sceneTemperature,
    textureFamily: requested.textureFamily ?? DEFAULT_EIDOS_THEME.textureFamily,
    sigilSeed: requested.sigilSeed ?? DEFAULT_EIDOS_THEME.sigilSeed,
    motionIntensity: resolveMotionIntensity(requested.motionIntensity),
  };
}

export interface WorldThemeSource {
  id: string;
  visualConfig?: {
    artDirection?: {
      colorPalette?: string[];
    };
  };
}

export type InterfaceThemeMode = "dark" | "light";

/** Converts generated world art direction into trusted application tokens. */
export function resolveThemeForWorld(
  world: WorldThemeSource | null | undefined,
  mode: InterfaceThemeMode = "dark",
): EidosTheme {
  if (mode === "light") {
    return resolveWorldTheme({
      ...LIGHT_EIDOS_THEME,
      sigilSeed: world?.id ?? LIGHT_EIDOS_THEME.sigilSeed,
    });
  }

  if (!world) return resolveWorldTheme();

  const palette = world.visualConfig?.artDirection?.colorPalette;
  return resolveWorldTheme({
    accent: palette?.[0],
    accentMuted: palette?.[1],
    sigilSeed: world.id,
  });
}
