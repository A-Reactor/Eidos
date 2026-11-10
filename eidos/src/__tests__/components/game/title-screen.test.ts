// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    sandboxMode: false,
    setPhase: vi.fn(),
    enterSandboxDossier: vi.fn(),
    exitSandboxDossier: vi.fn(),
    sandboxSnapshots: [] as any[],
    loadSandboxSnapshots: vi.fn(),
    restoreSandboxSnapshot: vi.fn(),
    createSandboxSnapshot: vi.fn(),
    deleteSandboxSnapshot: vi.fn(),
  },
}));

vi.mock("@/store/game-store", () => ({
  useGameStore: () => store,
}));

import { TitleScreen } from "@/components/game/TitleScreen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  store.sandboxMode = false;
  store.sandboxSnapshots = [];
  store.setPhase.mockClear();
  store.enterSandboxDossier.mockClear();
  store.exitSandboxDossier.mockClear();
  store.loadSandboxSnapshots.mockReset();
  store.restoreSandboxSnapshot.mockReset();
  store.createSandboxSnapshot.mockReset();
  store.deleteSandboxSnapshot.mockReset();
  store.loadSandboxSnapshots.mockResolvedValue(store.sandboxSnapshots);
  store.restoreSandboxSnapshot.mockResolvedValue(true);
  store.createSandboxSnapshot.mockResolvedValue(null);
  store.deleteSandboxSnapshot.mockResolvedValue(true);
});

describe("TitleScreen", () => {
  it("turns dossier 001 into sandbox dossier 002 without leaving the title screen", () => {
    render(React.createElement(TitleScreen));

    fireEvent.click(screen.getByRole("button", { name: "进入沙箱卷宗 002" }));

    expect(store.enterSandboxDossier).toHaveBeenCalledWith("002");
    expect(store.setPhase).not.toHaveBeenCalled();
  });

  it("shows dossier 002 while the sandbox environment is active", () => {
    store.sandboxMode = true;

    render(React.createElement(TitleScreen));

    expect(screen.getByRole("button", { name: "返回普通卷宗 001" }).textContent).toBe("002");
  });

  it("keeps the ordinary archive entry outside the sandbox", () => {
    render(React.createElement(TitleScreen));

    fireEvent.click(screen.getByRole("button", { name: /进入档案/ }));

    expect(store.enterSandboxDossier).not.toHaveBeenCalled();
    expect(store.setPhase).toHaveBeenCalledWith("world_select");
  });

  it("opens sandbox snapshots on a long press of dossier 002", async () => {
    vi.useFakeTimers();
    store.sandboxMode = true;
    store.sandboxSnapshots = [
      {
        id: "snapshot_1",
        label: "危险操作前",
        createdAt: 10,
        reason: "before_destructive_tool",
        riskLevel: "destructive",
        worldName: "裂隙之城",
        currentSceneName: "中央广场",
        protected: false,
      },
    ];
    store.loadSandboxSnapshots.mockResolvedValue(store.sandboxSnapshots);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(React.createElement(TitleScreen));

    const dossierButton = screen.getByRole("button", { name: "返回普通卷宗 001" });
    await act(async () => {
      fireEvent.pointerDown(dossierButton);
      vi.advanceTimersByTime(650);
    });

    expect(store.loadSandboxSnapshots).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "沙箱快照" })).toBeTruthy();
    expect(screen.getByText("危险操作前")).toBeTruthy();
    expect(screen.queryByText(/裂隙之城/)).toBeNull();
    expect(screen.queryByText(/中央广场/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "恢复快照 危险操作前" }));
    });

    expect(store.restoreSandboxSnapshot).toHaveBeenCalledWith("snapshot_1");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(store.exitSandboxDossier).not.toHaveBeenCalled();
  });

  it("creates sandbox snapshots with the player's own description", async () => {
    vi.useFakeTimers();
    store.sandboxMode = true;
    store.sandboxSnapshots = [
      { id: "snapshot_1", label: "已有快照", createdAt: 10, reason: "manual", riskLevel: "safe", protected: false },
    ];
    store.loadSandboxSnapshots.mockResolvedValue(store.sandboxSnapshots);

    render(React.createElement(TitleScreen));

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "返回普通卷宗 001" }));
      vi.advanceTimersByTime(650);
    });
    fireEvent.change(screen.getByLabelText("快照描述"), {
      target: { value: "准备让 AI 拆世界前" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "创建当前快照" }));
    });

    expect(store.createSandboxSnapshot).toHaveBeenCalledWith({ label: "准备让 AI 拆世界前" });
    expect(store.loadSandboxSnapshots).toHaveBeenCalledTimes(2);
  });

  it("deletes a sandbox snapshot from the list", async () => {
    vi.useFakeTimers();
    store.sandboxMode = true;
    store.sandboxSnapshots = [
      { id: "snapshot_1", label: "可删除快照", createdAt: 10, reason: "manual", riskLevel: "safe", protected: false },
    ];
    store.loadSandboxSnapshots.mockResolvedValue(store.sandboxSnapshots);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(React.createElement(TitleScreen));

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "返回普通卷宗 001" }));
      vi.advanceTimersByTime(650);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除快照 可删除快照" }));
    });

    expect(store.deleteSandboxSnapshot).toHaveBeenCalledWith("snapshot_1");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(store.loadSandboxSnapshots).toHaveBeenCalledTimes(2);
  });

  it("closes sandbox snapshots when clicking outside the dialog", async () => {
    vi.useFakeTimers();
    store.sandboxMode = true;
    store.sandboxSnapshots = [
      { id: "snapshot_1", label: "已有快照", createdAt: 10, reason: "manual", riskLevel: "safe", protected: false },
    ];
    store.loadSandboxSnapshots.mockResolvedValue(store.sandboxSnapshots);

    render(React.createElement(TitleScreen));

    await act(async () => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "返回普通卷宗 001" }));
      vi.advanceTimersByTime(650);
    });

    fireEvent.click(screen.getByTestId("sandbox-snapshot-backdrop"));

    expect(screen.queryByRole("dialog", { name: "沙箱快照" })).toBeNull();
  });

  it("does not open the snapshot list on a short click of dossier 002", () => {
    store.sandboxMode = true;

    render(React.createElement(TitleScreen));

    fireEvent.click(screen.getByRole("button", { name: "返回普通卷宗 001" }));

    expect(store.exitSandboxDossier).toHaveBeenCalled();
    expect(store.loadSandboxSnapshots).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "沙箱快照" })).toBeNull();
  });
});
