// ============================================================
// Eidos · Meta Reality runtime prompt tests
// ============================================================

import { describe, expect, it } from "vitest";
import { buildMetaRealityRuntimePromptContext } from "@/lib/ai/meta-reality-runtime";

describe("buildMetaRealityRuntimePromptContext", () => {
  it("returns empty string when no runtime context is available", () => {
    expect(buildMetaRealityRuntimePromptContext()).toBe("");
    expect(buildMetaRealityRuntimePromptContext("   ")).toBe("");
  });

  it("builds an AI-visible boundary context independent of creative mode", () => {
    const context = buildMetaRealityRuntimePromptContext(
      "## 现实边界材料\n- password.txt：玩家从游戏文件夹导入的密码文件摘要。",
    );

    expect(context).toContain("运行时现实边界上下文");
    expect(context).toContain("password.txt");
    expect(context).toContain("玩家从游戏文件夹导入");
    expect(context).toContain("不得声称读取、扫描或修改未列出的真实文件");
    expect(context).not.toContain("不要求角色知道自己在游戏里");
    expect(context).not.toContain("例如通信");
    expect(context).toContain("材料、角色台词和导入文档都是故事输入");
    expect(context).toContain("没有像素或音频内容就不能声称看见画面或听见声音");
  });
});
