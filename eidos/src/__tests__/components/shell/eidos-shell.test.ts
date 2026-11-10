// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EidosShell } from "@/components/shell/EidosShell";
import { useI18n } from "@/components/shell/LocaleProvider";
import { saveSettings } from "@/lib/game/settings";
import { DEFAULT_SETTINGS } from "@/lib/game/types";
import type { WorldDefinition } from "@/lib/game/types";
import { useGameStore } from "@/store/game-store";
import { contrastRatio } from '@/lib/ui/text-contrast';

function LocaleProbe() {
  const { locale } = useI18n();
  return React.createElement("output", null, locale);
}

beforeEach(() => {
  localStorage.clear();
  useGameStore.setState({ currentWorld: null });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EidosShell", () => {
  it.each(['light', 'dark'] as const)('updates shared foreground tokens independently for custom surfaces in %s mode', async mode => {
    render(React.createElement(EidosShell, null, React.createElement(LocaleProbe)));
    const colors = { background: '#000000', surface: '#ffffff', accent: '#000000' };
    act(() => saveSettings({ ...DEFAULT_SETTINGS, interfaceTheme: mode, interfacePalette: 'custom', interfaceCustomColors: { light: colors, dark: colors } }));
    await waitFor(() => expect(document.documentElement.dataset.palette).toBe('custom'));
    const style = document.documentElement.style;
    expect(contrastRatio(style.getPropertyValue('--eidos-palette-ink'), colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.getPropertyValue('--eidos-palette-surfaceInk'), colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style.getPropertyValue('--eidos-palette-surfaceMuted'), colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(style.getPropertyValue('--background')).toBe(colors.background);
    expect(style.getPropertyValue('--foreground')).toBe(style.getPropertyValue('--eidos-palette-ink'));
  });
  it("keeps the player palette stable when changing worlds", async () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      interfaceTheme: "dark",
    });

    render(React.createElement(EidosShell, null, React.createElement(LocaleProbe)));

    act(() => {
      useGameStore.setState({
        currentWorld: {
          id: "glass-garden",
          visualConfig: {
            artDirection: {
              colorPalette: ["#7357FF", "invalid"],
            },
          },
        } as WorldDefinition,
      });
    });

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--eidos-accent")).toBe("#ef6363"),
    );
    expect(document.documentElement.style.getPropertyValue("--eidos-accent-muted")).toBe("color-mix(in srgb, #ef6363 45%, #151515)");
  });

  it("updates locale and document motion from the shared settings event", async () => {
    render(React.createElement(EidosShell, null, React.createElement(LocaleProbe)));

    act(() => {
      saveSettings({
        ...DEFAULT_SETTINGS,
        interfaceLanguage: "en",
        reduceMotion: true,
      });
    });

    await waitFor(() => expect(screen.getByText("en")).not.toBeNull());
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("uses the light composition theme by default", async () => {
    render(React.createElement(EidosShell, null, React.createElement(LocaleProbe)));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.style.getPropertyValue("--eidos-accent")).toBe("#9e0000");
    expect(document.documentElement.style.getPropertyValue("--eidos-paper")).toBe("#fafafa");
  });

  it("reacts to settings storage and media changes and removes subscriptions", async () => {
    const addMediaListener = vi.fn();
    const removeMediaListener = vi.fn();
    const mediaQuery = {
      matches: false,
      addEventListener: addMediaListener,
      removeEventListener: removeMediaListener,
    };
    vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const rendered = render(
      React.createElement(EidosShell, null, React.createElement(LocaleProbe)),
    );

    localStorage.setItem("eidos_settings", JSON.stringify({
      ...DEFAULT_SETTINGS,
      interfaceLanguage: "en",
    }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "eidos_settings" }));
    });
    await waitFor(() => expect(screen.getByText("en")).not.toBeNull());

    mediaQuery.matches = true;
    const changeListener = addMediaListener.mock.calls[0][1] as () => void;
    act(() => changeListener());
    expect(document.documentElement.dataset.motion).toBe("reduced");

    rendered.unmount();
    expect(removeMediaListener).toHaveBeenCalledWith("change", changeListener);
    expect(removeWindowListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});
