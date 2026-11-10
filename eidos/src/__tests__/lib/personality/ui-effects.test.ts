import { describe, expect, it } from "vitest";

import {
  applyActionRewriteEffects,
  type PermissionUiEffect,
} from "@/lib/personality/ui-effects";

describe("applyActionRewriteEffects", () => {
  it("adds and replaces visible action suggestions from active interface effects", () => {
    const effects: PermissionUiEffect[] = [
      {
        id: "effect_add",
        type: "action_rewrite",
        sourceNpcId: "观测员埃琳娜",
        toolId: "interface_rewrite_actions",
        createdAt: 100,
        expiresAt: 500,
        action: "问她是否也记得上一条世界线",
        operation: "add",
        targetIndex: 1,
      },
      {
        id: "effect_replace",
        type: "action_rewrite",
        sourceNpcId: "观测员埃琳娜",
        toolId: "interface_rewrite_actions",
        createdAt: 110,
        expiresAt: 500,
        action: "停下，检查这个选择是谁写的",
        operation: "replace",
        targetIndex: 0,
      },
    ];

    expect(applyActionRewriteEffects(["观察街道", "询问守卫"], effects, 200)).toEqual([
      "停下，检查这个选择是谁写的",
      "问她是否也记得上一条世界线",
      "询问守卫",
    ]);
  });

  it("ignores expired action rewrite effects", () => {
    const effects: PermissionUiEffect[] = [
      {
        id: "effect_expired",
        type: "action_rewrite",
        sourceNpcId: "观测员埃琳娜",
        toolId: "interface_rewrite_actions",
        createdAt: 100,
        expiresAt: 150,
        action: "已经过期的建议",
        operation: "add",
        targetIndex: 0,
      },
    ];

    expect(applyActionRewriteEffects(["继续前进"], effects, 200)).toEqual(["继续前进"]);
  });
});
