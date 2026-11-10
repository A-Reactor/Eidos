import { resolveTextColors } from './text-contrast';

export interface PaletteColors { background: string; surface: string; accent: string }
export type CustomPalette = Record<'light' | 'dark', PaletteColors>;
export const INTERFACE_PALETTES = [
  { id: 'classic', name: '经典红黑白', en: 'Classic', light: { background: '#fafafa', surface: '#ffffff', accent: '#9e0000' }, dark: { background: '#151515', surface: '#1b1b1b', accent: '#ef6363' } },
  { id: 'warm', name: '暖灰书页', en: 'Warm paper', light: { background: '#f6f3ec', surface: '#efede6', accent: '#9d4334' }, dark: { background: '#1b211e', surface: '#222a25', accent: '#e69b86' } },
  { id: 'ocean', name: '深海蓝', en: 'Ocean', light: { background: '#edf3f8', surface: '#f8fbff', accent: '#215f88' }, dark: { background: '#111e2a', surface: '#1a2a39', accent: '#8cc9ed' } },
  { id: 'violet', name: '暮色紫', en: 'Twilight', light: { background: '#f2eff7', surface: '#fcfaff', accent: '#70478e' }, dark: { background: '#211b2a', surface: '#2c2537', accent: '#c9a5ed' } },
  { id: 'forest', name: '苔原绿', en: 'Forest', light: { background: '#eff3ed', surface: '#f9fcf6', accent: '#426a46' }, dark: { background: '#18221b', surface: '#223027', accent: '#a6cca3' } },
] as const;
export type InterfacePalette = typeof INTERFACE_PALETTES[number]['id'] | 'custom';
export const DEFAULT_CUSTOM_PALETTE: CustomPalette = { light: { ...INTERFACE_PALETTES[0].light }, dark: { ...INTERFACE_PALETTES[0].dark } };
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function normalizeCustomPalette(value: unknown): CustomPalette {
  const result = structuredClone(DEFAULT_CUSTOM_PALETTE);
  if (!value || typeof value !== 'object') return result;
  for (const mode of ['light', 'dark'] as const) {
    const colors = (value as Record<string, unknown>)[mode];
    if (!colors || typeof colors !== 'object') continue;
    for (const key of ['background', 'surface', 'accent'] as const) {
      const color = (colors as Record<string, unknown>)[key];
      if (isColor(color)) result[mode][key] = color.toLowerCase();
    }
  }
  return result;
}
export function normalizeInterfacePalette(value: unknown): InterfacePalette {
  return value === 'custom' || INTERFACE_PALETTES.some(p => p.id === value) ? value as InterfacePalette : 'classic';
}
export function interfaceColors(mode: 'light' | 'dark', palette: InterfacePalette, custom: CustomPalette = DEFAULT_CUSTOM_PALETTE) {
  const colors = palette === 'custom' ? normalizeCustomPalette(custom)[mode] : (INTERFACE_PALETTES.find(p => p.id === palette) ?? INTERFACE_PALETTES[0])[mode];
  const preferredInk = mode === 'dark' ? '#eeeeee' : '#191919';
  const text = resolveTextColors(colors.background, preferredInk, colors.accent);
  const surface = resolveTextColors(colors.surface, preferredInk, colors.accent);
  return { ...colors, ...text, surfaceInk: surface.ink, surfaceMuted: surface.muted,
    surfaceAccentText: surface.accentText, onSurfaceAccent: surface.onAccent };
}
