"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  EIDOS_SETTINGS_CHANGE_EVENT,
  EIDOS_SETTINGS_STORAGE_KEY,
  loadSettings,
} from "@/lib/game/settings";
import type { GameSettings } from "@/lib/game/types";
import type { Locale } from "@/lib/ui/i18n";
import { shouldReduceMotion } from "@/lib/ui/motion";
import { interfaceColors, DEFAULT_CUSTOM_PALETTE } from "@/lib/ui/interface-palette";

import { GlobalPluginsHost } from "./GlobalPluginsHost";
import { LocaleProvider } from "./LocaleProvider";
import { useFileDropGuard } from './use-file-drop-guard';
import { useVisualViewport } from './use-visual-viewport';

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface ShellSnapshot {
  locale: Locale;
  interfaceTheme: GameSettings["interfaceTheme"];
  interfacePalette: GameSettings["interfacePalette"];
  interfaceCustomColors: GameSettings["interfaceCustomColors"];
  reducedMotion: boolean;
}

const SERVER_SNAPSHOT: ShellSnapshot = {
  locale: "zh-CN",
  interfaceTheme: "light",
  interfacePalette: "classic",
  interfaceCustomColors: DEFAULT_CUSTOM_PALETTE,
  reducedMotion: false,
};

let snapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let cleanupBrowserSubscriptions: (() => void) | undefined;

function emitSnapshot(nextSnapshot: ShellSnapshot): void {
  if (
    nextSnapshot.locale === snapshot.locale &&
    nextSnapshot.interfaceTheme === snapshot.interfaceTheme &&
    nextSnapshot.interfacePalette === snapshot.interfacePalette &&
    JSON.stringify(nextSnapshot.interfaceCustomColors) === JSON.stringify(snapshot.interfaceCustomColors) &&
    nextSnapshot.reducedMotion === snapshot.reducedMotion
  ) {
    return;
  }

  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function startBrowserSubscriptions(): () => void {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);

  const refresh = () => {
    const settings = loadSettings();
    emitSnapshot({
      locale: settings.interfaceLanguage,
      interfaceTheme: settings.interfaceTheme,
      interfacePalette: settings.interfacePalette,
      interfaceCustomColors: settings.interfaceCustomColors,
      reducedMotion: shouldReduceMotion(settings.reduceMotion, mediaQuery.matches),
    });
  };
  const refreshStorage = (event: StorageEvent) => {
    if (event.key === EIDOS_SETTINGS_STORAGE_KEY) refresh();
  };

  refresh();
  window.addEventListener(EIDOS_SETTINGS_CHANGE_EVENT, refresh);
  window.addEventListener("storage", refreshStorage);

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", refresh);
  } else {
    mediaQuery.addListener(refresh);
  }

  return () => {
    window.removeEventListener(EIDOS_SETTINGS_CHANGE_EVENT, refresh);
    window.removeEventListener("storage", refreshStorage);
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", refresh);
    } else {
      mediaQuery.removeListener(refresh);
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  cleanupBrowserSubscriptions ??= startBrowserSubscriptions();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      cleanupBrowserSubscriptions?.();
      cleanupBrowserSubscriptions = undefined;
    }
  };
}

function getSnapshot(): ShellSnapshot {
  return snapshot;
}

function getServerSnapshot(): ShellSnapshot {
  return SERVER_SNAPSHOT;
}

function applyDocumentPresentation(
  current: ShellSnapshot,
): void {
  const root = document.documentElement;

  root.lang = current.locale;
  root.dataset.theme = current.interfaceTheme;
  root.dataset.palette = current.interfacePalette;
  root.dataset.motion = current.reducedMotion ? "reduced" : "full";
  const colors = interfaceColors(current.interfaceTheme, current.interfacePalette, current.interfaceCustomColors);
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(`--eidos-palette-${key}`, value);
  root.style.setProperty("--eidos-accent", colors.accent);
  root.style.setProperty("--eidos-accent-muted", `color-mix(in srgb, ${colors.accent} 45%, ${colors.background})`);
  root.style.setProperty("--eidos-paper", colors.background);
  root.style.setProperty("--eidos-surface", colors.surface);
  root.style.setProperty("--eidos-ink", colors.ink);
  root.style.setProperty("--background", colors.background);
  root.style.setProperty("--foreground", colors.ink);
}

interface EidosShellProps {
  children: React.ReactNode;
}

export function EidosShell({ children }: EidosShellProps) {
  useVisualViewport();
  useFileDropGuard();
  const current = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    applyDocumentPresentation(current);
  }, [current]);

  return <LocaleProvider locale={current.locale}><GlobalPluginsHost />{children}</LocaleProvider>;
}
