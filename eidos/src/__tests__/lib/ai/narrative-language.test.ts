import { describe, expect, it } from "vitest";

import {
  buildActionSystemPrompt,
  buildNarrativeLanguageInstruction,
  resolveNarrativeLanguage,
} from "@/lib/ai/prompt-templates";

describe("narrative language prompts", () => {
  it("reads the selected language from client settings with a safe fallback", () => {
    expect(resolveNarrativeLanguage({ narrativeLanguage: "en" })).toBe("en");
    expect(resolveNarrativeLanguage({ narrativeLanguage: "unsupported" })).toBe("zh-CN");
    expect(resolveNarrativeLanguage(null)).toBe("zh-CN");
  });

  it("requires English for every player-facing generated field", () => {
    const instruction = buildNarrativeLanguageInstruction("en");

    expect(instruction).toContain("Write all player-facing generated text in English");
    expect(instruction).toContain("segments[].text");
    expect(instruction).toContain("availableActions");
    expect(instruction).toContain("Do not translate names");
  });

  it("requires Simplified Chinese without rewriting proper names", () => {
    const instruction = buildNarrativeLanguageInstruction("zh-CN");

    expect(instruction).toContain("使用简体中文");
    expect(instruction).toContain("不要翻译既有专有名词");
  });

  it("places the requested language after a world's base prompt", () => {
    const prompt = buildActionSystemPrompt(
      "Always answer in Chinese.",
      "Rift City",
      "credits",
      "night",
      "context",
      undefined,
      undefined,
      "en",
    );

    expect(prompt.lastIndexOf("Write all player-facing generated text in English"))
      .toBeGreaterThan(prompt.indexOf("Always answer in Chinese."));
  });

  it("keeps inventory acquisition explicit and links full text through document artifacts", () => {
    const prompt = buildActionSystemPrompt(
      "你是 ALICE。",
      "裂隙之城",
      "第 1 天",
      "## 玩家背包\n- 旧纸条：一张折起来的纸条。（document）",
    );

    expect(prompt).toContain("查看、阅读、辨认、回忆或询问背包中已有物品时，不要输出 itemsGained");
    expect(prompt).toContain("文档、纸条、信件、书页、档案类物品的完整正文放入 documents，用 documentKey 引用对应产物");
    expect(prompt).toContain("description 只写外观和用途，不复制全文");
  });
});
