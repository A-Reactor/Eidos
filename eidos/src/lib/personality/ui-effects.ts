// ============================================================
// Eidos · 人格权限 UI 效果
// ============================================================
// 这里保存界面级工具的短暂效果。它们不是世界状态，只是玩家可见的沙箱痕迹。

export type PermissionUiEffectType =
  | "narrative_directive"
  | "action_rewrite"
  | "text_overlay";

export interface PermissionUiEffect {
  id: string;
  type: PermissionUiEffectType;
  sourceNpcId: string;
  toolId: string;
  createdAt: number;
  expiresAt?: number;
  text?: string;
  style?: string;
  action?: string;
  operation?: "add" | "replace" | "remove";
  targetIndex?: number;
  expressionType?: string;
  intensity?: string;
}

export function isPermissionUiEffectActive(
  effect: PermissionUiEffect,
  now: number = Date.now(),
): boolean {
  return effect.expiresAt === undefined || effect.expiresAt > now;
}

export function applyActionRewriteEffects(
  actions: readonly string[],
  effects: readonly PermissionUiEffect[],
  now: number = Date.now(),
): string[] {
  const rewritten = [...actions];
  const activeEffects = effects
    .filter((effect) => effect.type === "action_rewrite" && isPermissionUiEffectActive(effect, now))
    .sort((left, right) => left.createdAt - right.createdAt);

  for (const effect of activeEffects) {
    const index = clampIndex(effect.targetIndex ?? rewritten.length, rewritten.length);
    const action = (effect.action ?? "").trim();

    if (effect.operation === "remove") {
      if (rewritten.length > 0) rewritten.splice(index, 1);
      continue;
    }

    if (!action) continue;
    if (effect.operation === "replace") {
      if (rewritten.length === 0) {
        rewritten.push(action);
      } else {
        rewritten[index] = action;
      }
      continue;
    }

    rewritten.splice(index, 0, action);
  }

  return rewritten;
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), Math.max(0, length)));
}
