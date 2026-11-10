'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { loadSettings } from '@/lib/game/settings';
import { interfaceColors } from '@/lib/ui/interface-palette';

const fontSans = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const fontMono = '"SF Mono", SFMono-Regular, ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const serverTheme = JSON.stringify({ mode: 'light', ...interfaceColors('light', 'classic'), fontSans, fontMono, fontSize: 16, reducedMotion: false });

function snapshot() {
  const root = document.documentElement, style = getComputedStyle(root), settings = loadSettings();
  const mode = root.dataset.theme === 'dark' ? 'dark' : 'light';
  const fallback = interfaceColors(mode, settings.interfacePalette, settings.interfaceCustomColors);
  const color = (key: keyof typeof fallback) => style.getPropertyValue(`--eidos-palette-${key}`).trim() || fallback[key];
  // Only presentation tokens cross the opaque iframe boundary; never serialize settings or all root styles.
  return JSON.stringify({ mode, fontSize: parseFloat(style.fontSize) || 16, background: color('background'), surface: color('surface'), ink: color('ink'), accent: color('accent'),
    fontSans: style.getPropertyValue('--font-geist-sans').trim() || fontSans,
    fontMono: style.getPropertyValue('--font-geist-mono').trim() || fontMono,
    reducedMotion: root.dataset.motion === 'reduced' });
}

function subscribe(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'data-motion', 'style', 'class'] });
  return () => observer.disconnect();
}

export function useModTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => serverTheme);
  return useMemo(() => JSON.parse(value) as {
    mode: 'light' | 'dark'; background: string; surface: string; ink: string; accent: string;
    fontSans: string; fontMono: string; fontSize: number; reducedMotion: boolean;
  }, [value]);
}
