import { expect, it } from 'vitest';
import { contrastRatio, readableColor, resolveTextColors } from '@/lib/ui/text-contrast';
import { DEFAULT_CUSTOM_PALETTE, INTERFACE_PALETTES, interfaceColors } from '@/lib/ui/interface-palette';

it('uses linear sRGB luminance and keeps colors that already have enough contrast', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
  expect(readableColor('#9e0000', '#ffffff')).toBe('#9e0000');
});

it.each(INTERFACE_PALETTES.flatMap(palette => ['light', 'dark'].map(mode => ({ palette: palette.id, mode: mode as 'light' | 'dark' }))))('keeps text readable for $palette / $mode', ({ palette, mode }) => {
  const colors = interfaceColors(mode, palette);
  for (const [ink, muted, accent, background] of [
    [colors.ink, colors.muted, colors.accentText, colors.background],
    [colors.surfaceInk, colors.surfaceMuted, colors.surfaceAccentText, colors.surface],
  ]) {
    for (const text of [ink, muted, accent]) expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(colors.onAccent, colors.accentText)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.onSurfaceAccent, colors.surfaceAccentText)).toBeGreaterThanOrEqual(4.5);
});

it.each([['#000000', '#ffffff'], ['#ffffff', '#000000'], ['#808080', '#777777']])('resolves the actual background and surface separately: %s / %s', (background, surface) => {
  const custom = { ...DEFAULT_CUSTOM_PALETTE, dark: { background, surface, accent: background } };
  const colors = interfaceColors('dark', 'custom', custom);
  expect(colors.background).toBe(background);
  expect(colors.surface).toBe(surface);
  for (const [text, bg] of [[colors.ink, background], [colors.muted, background], [colors.surfaceInk, surface], [colors.surfaceMuted, surface], [colors.accentText, background], [colors.surfaceAccentText, surface]]) {
    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(4.5);
  }
});

it.each(['#101010', '#404040', '#777777', '#aaaaaa', '#eeeeee'])('keeps subdued text readable even on a midtone surface %s', background => {
  const colors = resolveTextColors(background, '#191919', background);
  expect(contrastRatio(colors.muted, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.accentText, background)).toBeGreaterThanOrEqual(4.5);
});
