// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSavedNavigation } from "@/components/game/use-saved-navigation";

afterEach(cleanup);
describe("save before leaving", () => {
  it("stays on the page after a save error and retries before navigating", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("磁盘已满")).mockResolvedValue(undefined);
    const navigate = vi.fn();
    function Page() {
      const flow = useSavedNavigation(save, navigate);
      return React.createElement(React.Fragment, null, React.createElement("button", { onClick: () => flow.navigate("world_select") }, "离开"), flow.dialog);
    }
    render(React.createElement(Page));
    fireEvent.click(screen.getByText("离开"));
    await screen.findByRole("dialog");
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("world_select"));
  });
});

it('opens a tool page immediately without requesting or awaiting a recovery point', () => {
  const save = vi.fn(() => new Promise<void>(() => {})), navigate = vi.fn();
  function Page() {
    const flow = useSavedNavigation(save, navigate);
    return React.createElement('button', { onClick: () => flow.navigate('map'), disabled: flow.busy }, '地图');
  }
  render(React.createElement(Page)); fireEvent.click(screen.getByRole('button', { name: '地图' }));
  expect(navigate).toHaveBeenCalledWith('map'); expect(save).not.toHaveBeenCalled();
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
});
