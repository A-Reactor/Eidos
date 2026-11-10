import { describe, expect, it } from "vitest";

import {
  buildIdentityPromptForWorld,
  ensureWorldCharacterIdentities,
} from "@/lib/ai/builtin-worlds";
import type { IdentityOption, WorldDefinition } from "@/lib/game/types";

function makeWorld(): WorldDefinition {
  return {
    id: "magical-trial",
    name: "魔法少女的审判",
    subtitle: "愿望、审判与监狱",
    overview: "二阶堂希罗和真红在审判庭醒来。",
    regions: {
      prison: {
        id: "prison",
        description: "被魔法契约覆盖的审判监狱。",
        scenes: {
          scene_awakening: {
            id: "scene_awakening",
            name: "觉醒室",
            region: "prison",
            initialDescription: "银白灯光照着墙上的羽毛印记。",
            connections: ["scene_court"],
            npcs: ["二阶堂希罗", "真红"],
            secrets: [],
            detailLevel: 0,
            discoveredSecrets: [],
          },
          scene_court: {
            id: "scene_court",
            name: "审判庭",
            region: "prison",
            initialDescription: "判槌声在空洞的圆厅中回响。",
            connections: ["scene_awakening"],
            npcs: ["青叶"],
            secrets: [],
            detailLevel: 0,
            discoveredSecrets: [],
          },
        },
      },
    },
    npcs: {
      "二阶堂希罗": "玩家设计的核心主角，正在寻找审判系统的漏洞。",
      "真红": "玩家设计的魔法少女，记得每一次失败的审判。",
      "青叶": "审判庭的证人。",
    },
    contradictions: [],
    history: [],
    timeline: [],
    clues: [],
    systemPromptBase: "",
    identityPrompt: "旧版身份提示词，只包含世界概述。",
    isPlayerCreated: true,
    createdAt: 1,
  };
}

describe("identity option world grounding", () => {
  it("builds identity prompts with canonical characters and legal scene IDs", () => {
    const prompt = buildIdentityPromptForWorld(makeWorld());

    expect(prompt).toContain("二阶堂希罗");
    expect(prompt).toContain("真红");
    expect(prompt).toContain("scene_awakening");
    expect(prompt).toContain("startingScene 必须精确使用下列场景ID之一");
  });

  it("repairs generated identities by adding missing world characters and valid starting scenes", () => {
    const world = makeWorld();
    const generated: IdentityOption[] = [
      {
        id: "identity_outsider",
        name: "外来记者",
        description: "误入审判监狱的外部观察者。",
        openingNarrative: "你推开门，审判庭的冷光落在肩上。",
        startingScene: "nonexistent_scene",
      },
    ];

    const repaired = ensureWorldCharacterIdentities(generated, world);

    expect(repaired.map((option) => option.name)).toEqual(
      expect.arrayContaining(["二阶堂希罗", "真红", "青叶"]),
    );
    expect(repaired.every((option) => ["scene_awakening", "scene_court"].includes(option.startingScene))).toBe(true);
  });
});
