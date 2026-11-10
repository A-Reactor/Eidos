import { describe, expect, it } from "vitest";

import type { InventoryItem } from "@/lib/game/types";
import { createPlayerSlice, type PlayerSlice } from "@/store/slices/player-slice";

type TestState = PlayerSlice & Record<string, unknown>;

const gameTime = { day: 2, hour: 10, minute: 0 };

function createTestStore(overrides: Partial<TestState> = {}) {
  const state: Partial<TestState> = { gameTime };
  const set = (
    partial:
      | Record<string, unknown>
      | ((current: Record<string, unknown>) => Record<string, unknown>),
  ) => {
    Object.assign(state, typeof partial === "function" ? partial(state as Record<string, unknown>) : partial);
  };
  const get = () => state;
  Object.assign(state, createPlayerSlice(set, get));
  Object.assign(state, overrides);
  return state as TestState;
}

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item_1",
    name: "旧纸条",
    description: "一张折起来的纸条。",
    quantity: 1,
    acquiredFrom: "clocktower",
    acquiredAt: gameTime,
    category: "document",
    consumable: false,
    value: 0,
    ...overrides,
  };
}

describe("player inventory slice", () => {
  it("merges same document records by name and keeps the fuller text instead of adding a duplicate", () => {
    const store = createTestStore();
    const fullText = [
      "一张折起来的纸条。",
      "正文：如果你读到这里，说明钟楼的门已经第二次打开。",
      "不要把银钥匙交给穿灰色制服的人；他们只会记得钥匙，不会记得你。",
    ].join("\n");

    store.addToInventory(item({ id: "note_brief" }));
    store.addToInventory(item({ id: "note_detailed", description: fullText }));

    expect(store.inventory).toHaveLength(1);
    expect(store.inventory[0].id).toBe("note_brief");
    expect(store.inventory[0].quantity).toBe(1);
    expect(store.inventory[0].description).toBe(fullText);
  });

  it("updates the state of the same unique item by id without increasing quantity", () => {
    const store = createTestStore();

    store.addToInventory(item({
      id: "phone_1",
      name: "手机",
      description: "一部还能亮屏的旧手机。",
      category: "tool",
    }));
    store.addToInventory(item({
      id: "phone_1",
      name: "摔坏的手机",
      description: "屏幕碎裂，机身边缘变形，但 SIM 卡还在。",
      category: "tool",
    }));
    store.addToInventory(item({
      id: "phone_1",
      name: "修好的手机",
      description: "屏幕换过，边框仍有裂痕，现在可以正常开机。",
      category: "tool",
    }));

    expect(store.inventory).toHaveLength(1);
    expect(store.inventory[0].id).toBe("phone_1");
    expect(store.inventory[0].name).toBe("修好的手机");
    expect(store.inventory[0].description).toBe("屏幕换过，边框仍有裂痕，现在可以正常开机。");
    expect(store.inventory[0].quantity).toBe(1);
  });

  it("still stacks genuinely stackable consumables with the same name", () => {
    const store = createTestStore();

    store.addToInventory(item({
      id: "ration_1",
      name: "压缩饼干",
      description: "还能吃。",
      quantity: 2,
      category: "consumable",
      consumable: true,
    }));
    store.addToInventory(item({
      id: "ration_2",
      name: "压缩饼干",
      description: "包装上有灰尘。",
      quantity: 3,
      category: "consumable",
      consumable: true,
    }));

    expect(store.inventory).toHaveLength(1);
    expect(store.inventory[0].quantity).toBe(5);
  });
});
