// ============================================================
// NPC 视角切换 API
// ============================================================
// POST /api/game/npc-perspective
// 玩家切换到指定 NPC 的视角，ALICE 以该 NPC 的身份和知识叙事。

import { NextResponse } from "next/server";
import { callDeepSeek, parseJSON, setCurrentSettings } from "@/lib/ai/client";
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { buildNpcPerspectivePrompt } from "@/lib/ai/prompt-templates";
import { buildWorldContext } from "@/lib/ai/context-builder";
import { getScene } from "@/lib/ai/context-builder";
import { loadSettings } from "@/lib/game/settings";
import { gameTimeToCalendar, weatherEffect } from "@/lib/game/calendar";
import { normalizeNpcDescription } from "@/lib/game/npc-description";
import { projectNpcMemoryState } from "@/lib/game/npc-memory-save";
import type { StorySegment, TokenUsage } from "@/lib/ai/types";
import type { Weather, NPCRelationship, NpcBehavior } from "@/lib/game/types";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      npcName,
      snapshot,
      inventory,
      clues,
      encyclopedia,
      criticalFacts,
      questLog,
      weather,
      recentHistory,
      world,
    } = body;

    if (!npcName || !snapshot) {
      return NextResponse.json({ error: "缺少 npcName 或 snapshot" }, { status: 400 });
    }

    const worldDef = world ?? getBuiltInWorld();
    const rawNpcDescription = worldDef.npcs[npcName];
    const npcDescription = normalizeNpcDescription(rawNpcDescription, npcName);
    if (!rawNpcDescription) {
      return NextResponse.json({ error: `NPC "${npcName}" 不存在于当前世界` }, { status: 404 });
    }

    const npcProjection = projectNpcMemoryState(snapshot.npcMemory);

    // NPC 所在场景
    const scene = getScene(worldDef, snapshot.currentSceneId);
    const npcBehaviors: Record<string, NpcBehavior> = snapshot.npcBehaviors ?? npcProjection.npcBehaviors;
    const behavior = npcBehaviors[npcName];
    const npcMood = behavior?.currentMood ?? "平静";
    const npcActivity = behavior?.currentActivity ?? "在当前场景中";

    // NPC 与玩家的关系
    const relationships: Record<string, NPCRelationship> = snapshot.relationships ?? npcProjection.relationships;
    const rel = relationships[npcName];
    const playerRelation = rel
      ? `好感 ${rel.affinity} | 信任 ${rel.trust}${rel.tags.length > 0 ? ` | ${rel.tags.join("、")}` : ""}${rel.notes ? ` — ${rel.notes}` : ""}`
      : "尚未建立关系";

    // 构建世界上下文（和主角行动共享同一上下文）
    const historySummary =
      (recentHistory?.length ?? 0) > 0
        ? `\n## 最近行动记录\n${recentHistory
            .slice(-10)
            .map((h: { playerInput: string; summary: string }) => `- 玩家：${h.playerInput} → ${h.summary}`)
            .join("\n")}`
        : "";

    const worldContext = buildWorldContext({
      world: worldDef,
      snapshot,
      inventory: inventory ?? [],
      clues: clues ?? [],
      encyclopedia: encyclopedia ?? [],
      criticalFacts: criticalFacts ?? [],
      questLog: questLog ?? [],
      historySummary,
      weather: weather ?? "晴",
      protagonistState: snapshot.protagonistState ?? null,
      forceFull: false,
      npcStates: snapshot.npcStates ?? npcProjection.npcStates,
      diary: snapshot.diary ?? [],
      relationships,
      causalProjections: snapshot.causalProjections ?? [],
      npcBehaviors,
      npcPersonalities: snapshot.npcPersonalities ?? npcProjection.npcPersonalities,
    });

    // NPC 视角 prompt
    const systemPrompt = buildNpcPerspectivePrompt(
      worldDef.name,
      npcName,
      npcDescription,
      npcMood,
      npcActivity,
      snapshot.playerName || "玩家",
      playerRelation,
      worldContext,
    );

    const clientSettings = body._settings ?? loadSettings();
    setCurrentSettings(clientSettings);

    const { content, usage, elapsedMs } = await callDeepSeek(
      systemPrompt,
      `以${npcName}的视角观察当前的世界`,
      0.8,   // 稍高温度让 NPC 性格更鲜活
      3000,
      true,  // JSON mode
      90000,
      false, // useKey = false → ALICE (flash, 快速生成)
      clientSettings,
    );

    const parsed = parseJSON<{
      segments?: StorySegment[];
      narrative?: string;
      availableActions?: string[];
      summary?: string;
      npcMoodUpdate?: string;
      npcActivityUpdate?: string;
    }>(content);

    const segments = parsed.segments?.length
      ? parsed.segments
      : [{ type: "narration" as const, text: parsed.narrative ?? "（沉默）" }];

    // 返回 NPC 的视角叙事 + 行为更新
    return NextResponse.json({
      npcName,
      segments,
      availableActions: parsed.availableActions ?? [],
      summary: parsed.summary ?? `${npcName}的视角`,
      npcBehaviorUpdate: {
        currentScene: snapshot.currentSceneId,
        currentActivity: parsed.npcActivityUpdate ?? npcActivity,
        currentMood: parsed.npcMoodUpdate ?? npcMood,
        source: "pov_generated" as const,
      },
      _tokenUsage: usage,
      _elapsedMs: elapsedMs,
    });
  } catch (err: any) {
    console.error("[npc-perspective] error:", err?.message || err);
    return NextResponse.json({ error: "NPC 视角生成失败" }, { status: 500 });
  }
}
