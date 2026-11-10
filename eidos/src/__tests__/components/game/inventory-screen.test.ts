// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InventoryScreen } from "@/components/game/InventoryScreen";
import { LocaleProvider } from "@/components/shell/LocaleProvider";
import type { InventoryItem } from "@/lib/game/types";
import { useGameStore } from "@/store/game-store";

const sampleInventory: InventoryItem[] = [
  {
    id: "obsidian-key",
    name: "黑曜钥匙",
    description: "边缘有细密裂纹，像是从某个门锁里长出来的物件。",
    quantity: 3,
    acquiredFrom: "旧车站",
    acquiredAt: { day: 2, hour: 21, minute: 15 },
    category: "key",
    consumable: false,
    value: 0,
  },
];

const longDocumentText = [
  "纸条正面写着：第一夜，钟声停在十二点零三分。",
  "第二夜，守门人没有回来，只留下钥匙和一行被雨水泡开的字。",
  "第三夜，如果有人问起这张纸条，就告诉他：裂隙不是门，是回声。",
].join("\n");

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useGameStore.setState({
    inventory: sampleInventory,
    currentWorld: null,
    midoriSettings: { enabled: false },
    setPhase: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InventoryScreen", () => {
  it("shows item identity, category and quantity without decorative archive codes", () => {
    render(React.createElement(LocaleProvider, null, React.createElement(InventoryScreen)));

    expect(screen.getByRole("heading", { name: "物品档案" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /黑曜钥匙/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("关键物品").length).toBeGreaterThan(0);
    expect(screen.getByTestId("inventory-dossier-card").className).toContain("eidos-inventory-card");
    expect(screen.getAllByText("×3")).toHaveLength(1);
  });

  it("shows a selectable item list with a fixed detail panel that preserves long document text", () => {
    useGameStore.setState({
      inventory: [
        {
          id: "note",
          name: "旧纸条",
          description: longDocumentText,
          quantity: 1,
          acquiredFrom: "旧钟楼",
          acquiredAt: { day: 3, hour: 0, minute: 3 },
          category: "document",
          consumable: false,
          value: 0,
        },
        ...sampleInventory,
      ],
    } as never);

    render(React.createElement(LocaleProvider, null, React.createElement(InventoryScreen)));

    expect(screen.getByTestId("inventory-item-list")).not.toBeNull();
    expect(screen.getByTestId("inventory-detail-panel").textContent).toContain(longDocumentText);

    fireEvent.click(screen.getByRole("button", { name: /黑曜钥匙/ }));

    expect(screen.getByTestId("inventory-detail-panel").textContent).toContain("边缘有细密裂纹");
    expect(screen.getByTestId("inventory-detail-panel").textContent).not.toContain("第三夜");
  });

  it("uses English interface copy when the locale provider is English", () => {
    const Provider = LocaleProvider as React.ComponentType<{ locale: "en"; children?: React.ReactNode }>;
    render(React.createElement(
      Provider,
      { locale: "en" },
      React.createElement(InventoryScreen),
    ));

    expect(screen.getByRole("heading", { name: "Inventory Archive" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).not.toBeNull();
    expect(screen.getAllByText("Key item").length).toBeGreaterThan(0);
  });
});

it('falls back from a missing generated image without hiding the item text', () => {
  useGameStore.setState({ inventory: [{ ...sampleInventory[0], imageUrl: '/missing-item.png' }] });
  const view = render(React.createElement(LocaleProvider, null, React.createElement(InventoryScreen)));
  for (const image of view.container.querySelectorAll('img')) fireEvent.error(image);
  expect(view.container.querySelectorAll('img')).toHaveLength(0);
  expect(screen.getByTestId('inventory-detail-panel').textContent).toContain(sampleInventory[0].description);
  expect(screen.getAllByText('×3')).toHaveLength(1);
});
