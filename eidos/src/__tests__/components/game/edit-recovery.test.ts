// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditModal } from "@/components/game/EditModal";
import { InspectorPanel } from "@/components/game/worldline/InspectorPanel";

afterEach(cleanup);
describe("editable and recovery surfaces", () => {
  it("keeps a dirty edit open on Escape until explicitly discarded", () => {
    const onClose = vi.fn();
    render(React.createElement(EditModal, { category: "inventoryItem", title: "物品", data: { name: "钥匙" }, onSave: vi.fn(), onClose }));
    fireEvent.change(screen.getByDisplayValue("钥匙"), { target: { value: "银钥匙" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("shows a failed backtrack and lets the player retry", async () => {
    const onBacktrack = vi.fn().mockRejectedValue(new Error("读取存档失败"));
    render(React.createElement(InspectorPanel, { node: { id: "node", snapshotHash: "hash", stepNumber: 2, dayNumber: 1, aiResponse: "你好", worldImpacts: [] } as never, onBacktrack, onDelete: vi.fn(), onClose: vi.fn() }));
    fireEvent.click(screen.getByRole("button", { name: /回档到此处/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认回档" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("读取存档失败"));
    expect(screen.getByRole("button", { name: "确认回档" })).not.toBeNull();
  });
});
