// ============================================================
// Eidos · 创造模式 Prompt 注入工具
// ============================================================
//
// 所有注入均为追加式，不修改任何已有 prompt 内容。
// 只在创造模式（gameMode === "creative"）且有对应文本时生效。
// 现实边界材料属于普通游玩的运行时上下文，不从这里进入。

import { CREATIVE_MODE_ENABLED } from "@/lib/game/features";
import type { CreativeModeConfig } from "@/lib/game/types";

/** 获取 ALICE 有效温度（创造模式时用自定义温度，否则用默认值） */
export function resolveAliceTemperature(
  cfg: CreativeModeConfig | null | undefined,
  defaultTemp: number
): number {
  if (!CREATIVE_MODE_ENABLED || !cfg || cfg.gameMode !== "creative") return defaultTemp;
  return cfg.aliceTemperature;
}

/** 获取 KEI 有效温度（创造模式时用自定义温度，否则用默认值） */
export function resolveKeiTemperature(
  cfg: CreativeModeConfig | null | undefined,
  defaultTemp: number
): number {
  if (!CREATIVE_MODE_ENABLED || !cfg || cfg.gameMode !== "creative") return defaultTemp;
  return cfg.keiTemperature;
}

/** 构建 ALICE prompt 追加段落（创作模式玩家期望）。
 *  只在创造模式且有期望文本时返回非空字符串，否则返回空字符串。 */
export function buildAlicePromptAdditions(
  cfg: CreativeModeConfig | null | undefined
): string {
  if (!CREATIVE_MODE_ENABLED || !cfg || cfg.gameMode !== "creative") {
    return "";
  }
  const additions: string[] = [];
  if (cfg.aliceExpectations.trim()) {
    additions.push(`
## 玩家期望（创作模式）

你应当遵循以下玩家偏好来调整写作风格和剧情走向：

${cfg.aliceExpectations.trim()}

以上期望是对基础规则的补充，不覆盖基础规则。`);
  }
  return additions.join("\n");
}

/** 构建 KEI prompt 追加段落（创作模式玩家期望）。
 *  只在创造模式且有期望文本时返回非空字符串，否则返回空字符串。 */
export function buildKeiPromptAdditions(
  cfg: CreativeModeConfig | null | undefined
): string {
  if (!CREATIVE_MODE_ENABLED || !cfg || cfg.gameMode !== "creative") {
    return "";
  }
  const additions: string[] = [];
  if (cfg.keiExpectations.trim()) {
    additions.push(`
## 玩家期望（创作模式）

在审核时，考虑以下玩家偏好：

${cfg.keiExpectations.trim()}

以上期望是对审核规则的补充，不覆盖基础审核规则。`);
  }
  return additions.join("\n");
}
