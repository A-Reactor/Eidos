// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreationResult } from "@/components/game/creation/CreationResult";
import type { WorldDefinition } from "@/lib/game/types";

afterEach(cleanup);
describe("creation result", () => {
  it("keeps all actions outside the scrollable full overview", () => {
    const overview = "世界的故事。\n".repeat(1000) + "概述末尾";
    const world = { name: "长篇世界", subtitle: "副标题", overview, regions: {}, npcs: {}, clues: [] } as unknown as WorldDefinition;
    const onExport = vi.fn();
    render(React.createElement(CreationResult, { world, entering: false, sandboxMode: false, error: null, storageError: null, onExport, onBack: vi.fn(), onEdit: vi.fn(), onEnter: vi.fn() }));
    const content = screen.getByRole("region", { name: "生成结果内容" });
    const footer = screen.getByRole("contentinfo", { name: "生成结果操作栏" });
    expect(content.className).toContain("overflow-y-auto");
    expect(content.className).toContain("min-h-0");
    expect(content.contains(footer)).toBe(false);
    expect(footer.parentElement?.className).toContain("overflow-hidden");
    expect(within(content).getByText(/概述末尾/).textContent).toBe(overview);
    expect(within(content).queryAllByRole("button")).toHaveLength(0);
    expect(within(footer).getAllByRole("button")).toHaveLength(4);
    expect(screen.getByLabelText("世界基本信息").tagName).toBe("DL");
    fireEvent.click(within(footer).getByRole("button", { name: "导出生成材料" }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});
