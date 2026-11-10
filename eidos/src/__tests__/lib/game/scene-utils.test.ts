import { describe, expect, it } from "vitest";
import type { Scene, WorldDefinition } from "@/lib/game/types";
import { resolveSceneReference } from "@/lib/game/scene-utils";

const plaza: Scene = {
  id: "central_plaza",
  name: "中央广场",
  region: "上城区",
  initialDescription: "",
  detailLevel: 10,
  connections: ["clocktower"],
  npcs: ["林"],
  secrets: [],
  discoveredSecrets: [],
};

const tower: Scene = {
  id: "clocktower",
  name: "旧钟楼",
  region: "上城区",
  initialDescription: "",
  detailLevel: 10,
  connections: ["central_plaza"],
  npcs: ["莫尔"],
  secrets: [],
  discoveredSecrets: [],
};

const world: WorldDefinition = {
  id: "test_world",
  name: "测试世界",
  subtitle: "",
  overview: "",
  regions: {
    upper: { id: "upper", description: "", scenes: { central_plaza: plaza, clocktower: tower } },
  },
  npcs: {},
  contradictions: [],
  history: [],
  timeline: [],
  clues: [],
  systemPromptBase: "",
  identityPrompt: "",
  isPlayerCreated: false,
  createdAt: 1,
};

describe("resolveSceneReference", () => {
  it("accepts scene ids, scene names, and structured AI scene-change objects", () => {
    expect(resolveSceneReference(world, "clocktower")).toBe("clocktower");
    expect(resolveSceneReference(world, "旧钟楼")).toBe("clocktower");
    expect(resolveSceneReference(world, { sceneId: "clocktower" })).toBe("clocktower");
    expect(resolveSceneReference(world, { targetSceneId: "旧钟楼" })).toBe("clocktower");
  });

  it("rejects malformed or unknown scene references before they can update player location", () => {
    expect(resolveSceneReference(world, { sceneId: { bad: true } })).toBeNull();
    expect(resolveSceneReference(world, ["clocktower"])).toBeNull();
    expect(resolveSceneReference(world, "不存在")).toBeNull();
  });
});
