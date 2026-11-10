import { describe, expect, it } from "vitest";
import type { EncyclopediaEntry, GameTime } from "@/lib/game/types";
import {
  filterPlayerEncyclopediaEntries,
  sanitizeEncyclopediaMaintenanceResult,
} from "@/lib/game/encyclopedia-maintenance";

const now: GameTime = { day: 1, hour: 8, minute: 0 };

function entry(
  id: string,
  type: EncyclopediaEntry["type"],
  name: unknown,
): EncyclopediaEntry {
  return {
    id,
    type,
    name: name as string,
    description: `${String(name)} desc`,
    knowledge: [],
    firstEncountered: now,
    lastUpdated: now,
    relatedEntries: [],
  };
}

describe("encyclopedia maintenance", () => {
  it("keeps KEI reorganization scoped to valid non-NPC player encyclopedia entries", () => {
    const entries = filterPlayerEncyclopediaEntries([
      entry("npc_lin", "npc", "林"),
      entry("loc_tower", "location", "旧钟楼"),
      entry("bad_name", "item", { text: "坏名字" }),
      entry("", "concept", "无效 ID"),
    ]);

    expect(entries.map((candidate) => candidate.name)).toEqual(["旧钟楼"]);
    expect(entries.every((candidate) => candidate.type !== "npc")).toBe(true);
  });

  it("drops malformed KEI updates and refuses to delete NPC or unknown archive entries", () => {
    const result = sanitizeEncyclopediaMaintenanceResult(
      {
        encyclopediaUpdates: [
          { name: { text: "坏名字" }, type: "location", description: "bad" },
          { name: "林", type: "npc", description: "不应回写人物" },
          { name: "旧钟楼", type: "location", description: "修订后的地点", knowledge: "只更新玩家百科" },
          { name: "异常术语", type: "strange", description: "未知类型归入其他" },
        ],
        encyclopediaDeletions: ["林", "不存在", { name: "旧钟楼" }, "旧钟楼"],
      },
      [
        entry("npc_lin", "npc", "林"),
        entry("loc_tower", "location", "旧钟楼"),
      ],
    );

    expect(result.encyclopediaUpdates).toEqual([
      { name: "旧钟楼", type: "location", description: "修订后的地点", knowledge: "只更新玩家百科" },
      { name: "异常术语", type: "other", description: "未知类型归入其他", knowledge: undefined },
    ]);
    expect(result.encyclopediaDeletions).toEqual(["旧钟楼"]);
  });
});
