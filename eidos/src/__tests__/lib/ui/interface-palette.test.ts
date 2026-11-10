import { expect, it } from 'vitest';
import { DEFAULT_CUSTOM_PALETTE, interfaceColors, normalizeCustomPalette, normalizeInterfacePalette } from '@/lib/ui/interface-palette';
it('preserves existing palettes, validates custom colors and keeps light and dark drafts independent', () => {
  expect(normalizeInterfacePalette('warm')).toBe('warm');
  expect(normalizeInterfacePalette('unknown')).toBe('classic');
  expect(normalizeInterfacePalette('custom')).toBe('custom');
  const custom = normalizeCustomPalette({ light: { background: '#ABCDEF', surface: 'red', accent: '#112233' }, dark: null });
  expect(custom.light).toEqual({ background: '#abcdef', surface: '#ffffff', accent: '#112233' });
  expect(custom.dark).toEqual(DEFAULT_CUSTOM_PALETTE.dark);
  expect(interfaceColors('light', 'custom', custom).background).toBe('#abcdef');
  expect(interfaceColors('light', 'custom', { ...custom, light: { ...custom.light, background: '#000000' } }).ink).toBe('#ffffff');
  expect(interfaceColors('dark', 'ocean').accent).toBe('#8cc9ed');
});
