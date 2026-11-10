// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArchiveStatButton } from "@/components/game/ArchiveStatButton";

afterEach(cleanup);

describe("ArchiveStatButton", () => {
  it("treats archive metric cards as real actions", () => {
    const onClick = vi.fn();

    render(React.createElement(ArchiveStatButton, {
      value: "03",
      label: "任务",
      tone: "accent",
      hint: "打开情报墙",
      onClick,
    }));

    const button = screen.getByRole("button", { name: "任务 03 打开情报墙" });
    expect(button.className).toContain("eidos-archive-stat");
    expect(button.className).toContain("is-accent");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders disabled cards without implying action", () => {
    render(React.createElement(ArchiveStatButton, {
      value: "00",
      label: "待验证",
      tone: "muted",
      disabled: true,
    }));

    const button = screen.getByRole("button", { name: "待验证 00" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.className).toContain("is-muted");
  });
});
