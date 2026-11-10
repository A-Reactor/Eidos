import { describe, expect, it } from "vitest";

import { buildWorldLibraryItems } from "@/components/library/world-library-model";
import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "@/lib/game/types";

function world(id: string): WorldDefinition {
  return { id, name: id } as WorldDefinition;
}

function playthrough(
  id: string,
  worldId: string,
  updatedAt: number,
  status: PlaythroughMeta["status"] = "active",
  actionCount = 0,
): PlaythroughMeta {
  return { id, worldId, updatedAt, status, actionCount } as PlaythroughMeta;
}

function save(
  id: string,
  worldId: string,
  playthroughId: string,
  updatedAt: number,
): SaveSlot {
  return { id, worldId, playthroughId, updatedAt } as SaveSlot;
}

describe("buildWorldLibraryItems", () => {
  it("builds the planned counts and current selections", () => {
    const worlds = [world("world-a")];
    const ptOld = playthrough("pt-old", "world-a", 10);
    const ptActive = playthrough("pt-active", "world-a", 30);
    const saveOld = save("save-old", "world-a", "pt-old", 20);
    const saveNew = save("save-new", "world-a", "pt-active", 50);
    const saveMiddle = save("save-middle", "world-a", "pt-active", 40);

    const [item] = buildWorldLibraryItems(
      worlds,
      [ptOld, ptActive],
      [saveOld, saveNew, saveMiddle],
    );

    expect(item.world).toBe(worlds[0]);
    expect(item.continuityCount).toBe(2);
    expect(item.saveCount).toBe(3);
    expect(item.latestSave).toBe(saveNew);
    expect(item.activeContinuity).toBe(ptActive);
  });

  it("returns empty display data for a world with no playthroughs or saves", () => {
    const [item] = buildWorldLibraryItems([world("empty")], [], []);

    expect(item).toMatchObject({
      continuityCount: 0,
      historyNodeCount: 0,
      saveCount: 0,
      latestSave: null,
      activeContinuity: null,
      continuities: [],
    });
  });

  it("sorts continuities and their saves newest first without mutating inputs", () => {
    const older = playthrough("older", "world-a", 10);
    const newer = playthrough("newer", "world-a", 20);
    const oldSave = save("old-save", "world-a", "newer", 30);
    const newSave = save("new-save", "world-a", "newer", 40);
    const playthroughs = [older, newer];
    const saves = [oldSave, newSave];

    const [item] = buildWorldLibraryItems([world("world-a")], playthroughs, saves);

    expect(item.continuities.map((continuity) => continuity.id)).toEqual(["newer", "older"]);
    expect(item.continuities[0].saves).toEqual([newSave, oldSave]);
    expect(playthroughs).toEqual([older, newer]);
    expect(saves).toEqual([oldSave, newSave]);
    expect(older).not.toHaveProperty("saves");
    expect(newer).not.toHaveProperty("saves");
  });

  it("keeps legacy ended continuities available as the newest playable continuity", () => {
    const active = playthrough("active", "world-a", 20);
    const ended = playthrough("ended", "world-a", 30, "ended");

    const [item] = buildWorldLibraryItems([world("world-a")], [active, ended], []);

    expect(item.continuities.map((continuity) => continuity.id)).toEqual(["ended", "active"]);
    expect(item.activeContinuity).toBe(ended);
  });

  it("counts history nodes from playthrough action counts, not save slots", () => {
    const first = playthrough("first", "world-a", 10, "active", 5);
    const second = playthrough("second", "world-a", 20, "ended", 7);
    const bookmark = save("bookmark", "world-a", "first", 30);

    const [item] = buildWorldLibraryItems([world("world-a")], [first, second], [bookmark]);

    expect(item.saveCount).toBe(1);
    expect(item.historyNodeCount).toBe(12);
  });

  it("isolates known worlds, ignores orphans, and preserves world order", () => {
    const worldB = world("world-b");
    const worldA = world("world-a");
    const ptA = playthrough("pt-a", "world-a", 10);
    const ptB = playthrough("pt-b", "world-b", 20);
    const orphanPt = playthrough("pt-orphan", "missing", 100);
    const saveA = save("save-a", "world-a", "pt-a", 30);
    const saveB = save("save-b", "world-b", "pt-b", 40);
    const orphanSave = save("save-orphan", "missing", "pt-orphan", 200);

    const items = buildWorldLibraryItems(
      [worldB, worldA],
      [ptA, orphanPt, ptB],
      [saveA, orphanSave, saveB],
    );

    expect(items.map((item) => item.world)).toEqual([worldB, worldA]);
    expect(items.map((item) => item.continuityCount)).toEqual([1, 1]);
    expect(items.map((item) => item.saveCount)).toEqual([1, 1]);
    expect(items.map((item) => item.latestSave)).toEqual([saveB, saveA]);
  });

  it("uses stable input order to break updatedAt ties", () => {
    const firstActive = playthrough("first-active", "world-a", 20);
    const secondActive = playthrough("second-active", "world-a", 20);
    const firstSave = save("first-save", "world-a", "first-active", 30);
    const secondSave = save("second-save", "world-a", "first-active", 30);

    const [item] = buildWorldLibraryItems(
      [world("world-a")],
      [firstActive, secondActive],
      [firstSave, secondSave],
    );

    expect(item.activeContinuity).toBe(firstActive);
    expect(item.latestSave).toBe(firstSave);
    expect(item.continuities.map((continuity) => continuity.id)).toEqual([
      "first-active",
      "second-active",
    ]);
    expect(item.continuities[0].saves).toEqual([firstSave, secondSave]);
  });

  it("counts world saves with a foreign playthrough ID without nesting them", () => {
    const ptA = playthrough("pt-a", "world-a", 10);
    const ptB = playthrough("pt-b", "world-b", 10);
    const validSave = save("valid", "world-a", "pt-a", 20);
    const foreignSave = save("foreign", "world-a", "pt-b", 30);

    const [item] = buildWorldLibraryItems(
      [world("world-a"), world("world-b")],
      [ptA, ptB],
      [validSave, foreignSave],
    );

    expect(item.saveCount).toBe(2);
    expect(item.latestSave).toBe(foreignSave);
    expect(item.continuities[0].saves).toEqual([validSave]);
  });

  it("preserves duplicate records and creates fresh output arrays on every call", () => {
    const sourceWorld = world("world-a");
    const pt = playthrough("pt", "world-a", 10);
    const slot = save("save", "world-a", "pt", 20);

    const [first] = buildWorldLibraryItems([sourceWorld], [pt, pt], [slot, slot]);
    const [second] = buildWorldLibraryItems([sourceWorld], [pt, pt], [slot, slot]);

    expect(first.continuityCount).toBe(2);
    expect(first.saveCount).toBe(2);
    expect(first.continuities).not.toBe(second.continuities);
    expect(first.continuities[0].saves).not.toBe(first.continuities[1].saves);
    expect(first.continuities[0].saves).not.toBe(second.continuities[0].saves);
    expect(first.continuities[0].saves).toEqual([slot, slot]);
  });
});
