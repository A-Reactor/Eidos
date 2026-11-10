// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDataActions } from "@/components/game/settings/SettingsDataActions";

const { state } = vi.hoisted(() => ({ state: { currentWorld: null as { name: string } | null, playerName: "", history: [] as unknown[] } }));
vi.mock("@/store/game-store", () => ({ useGameStore: () => state }));
vi.mock("@/components/shell/LocaleProvider", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }) }));
afterEach(cleanup);
describe("settings exports", () => {
  it("does not offer game exports before entering a world", () => {
    state.currentWorld = null; state.playerName = "";
    render(React.createElement(SettingsDataActions));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/进入世界并选择身份后/)).toBeTruthy();
  });
  it("offers the importable game record instead of the old storage dump", () => {
    state.currentWorld = { name: "世界" }; state.playerName = "玩家"; state.history = [{}];
    render(React.createElement(SettingsDataActions));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "settings.exportRecords" })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "settings.exportSaves" })).toBeNull();
  });
});
