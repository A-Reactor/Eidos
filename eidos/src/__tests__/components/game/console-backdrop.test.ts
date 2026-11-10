// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleBackdrop } from "@/components/game/ConsoleBackdrop";

afterEach(cleanup);

describe("ConsoleBackdrop", () => {
  it("closes the console when the non-menu area is clicked", () => {
    const onClose = vi.fn();

    render(React.createElement(ConsoleBackdrop, { open: true, onClose }));
    fireEvent.click(screen.getByRole("button", { name: "返回对话主界面" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when the console is already closed", () => {
    render(React.createElement(ConsoleBackdrop, { open: false, onClose: vi.fn() }));

    expect(screen.queryByRole("button", { name: "返回对话主界面" })).toBeNull();
  });
});
