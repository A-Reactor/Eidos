// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleRail } from "@/components/game/ConsoleRail";

afterEach(cleanup);

describe("ConsoleRail", () => {
  it("opens concrete archive tabs from every rail button", () => {
    const onOpenTab = vi.fn();

    render(React.createElement(ConsoleRail, {
      tabs: [
        { id: "status", label: "世界状态", shortcut: "M", count: 3 },
        { id: "relations", label: "角色关系", shortcut: "R", count: 2 },
      ],
      onOpenTab,
    }));

    fireEvent.click(screen.getByRole("button", { name: "打开世界状态 3" }));
    fireEvent.click(screen.getByRole("button", { name: "打开角色关系 2" }));

    expect(onOpenTab).toHaveBeenNthCalledWith(1, "status");
    expect(onOpenTab).toHaveBeenNthCalledWith(2, "relations");
    expect(screen.queryByRole("button", { name: "Narrative" })).toBeNull();
  });

  it("moves one shared cursor between hovered rail buttons", () => {
    render(React.createElement(ConsoleRail, {
      tabs: [
        { id: "status", label: "世界状态", shortcut: "M", count: 3 },
        { id: "causal", label: "因果投影", shortcut: "C", count: 1 },
        { id: "relations", label: "角色关系", shortcut: "R", count: 2 },
      ],
      onOpenTab: vi.fn(),
    }));

    const cursor = screen.getByTestId("console-rail-cursor");
    expect(cursor.getAttribute("data-active")).toBe("false");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "打开因果投影 1" }));
    expect(cursor.getAttribute("data-active")).toBe("true");
    expect(cursor.getAttribute("style")).toContain("--rail-index: 1");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "打开角色关系 2" }));
    expect(cursor.getAttribute("style")).toContain("--rail-index: 2");

    fireEvent.mouseLeave(screen.getByRole("navigation", { name: "档案快捷栏" }));
    expect(cursor.getAttribute("data-active")).toBe("false");
  });
});
