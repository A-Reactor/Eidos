// ============================================================
// Eidos · AI 测试状态查看 API
// GET /api/test/state?worldId=rift_city
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { getSceneById } from "@/lib/game/scene-utils";
import { buildTestSnapshot } from "@/lib/test/fixtures";
import { gameTimeToCalendar } from "@/lib/game/calendar";
import { projectNpcMemoryState } from "@/lib/game/npc-memory-save";
import type { TestStateResponse, ReadableGameState } from "@/lib/test/types";

function formatTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 8) return "清晨";
  if (hour >= 8 && hour < 11) return "早晨";
  if (hour >= 11 && hour < 13) return "中午";
  if (hour >= 13 && hour < 17) return "下午";
  if (hour >= 17 && hour < 19) return "傍晚";
  if (hour >= 19 && hour < 22) return "晚上";
  if (hour >= 22 || hour < 2) return "深夜";
  return "凌晨";
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worldId = searchParams.get("worldId") ?? "rift_city";
    const sceneId = searchParams.get("sceneId");

    if (worldId !== "rift_city") {
      return NextResponse.json({ error: `不支持的世界 ID: ${worldId}` }, { status: 400 });
    }

    const world = getBuiltInWorld();
    const overrides: Partial<import("@/lib/game/types").WorldSnapshot> = {};
    if (sceneId) {
      const scene = getSceneById(world, sceneId);
      if (!scene) return NextResponse.json({ error: `场景不存在: ${sceneId}` }, { status: 400 });
      overrides.currentSceneId = sceneId;
      overrides.sceneNarrative = scene.initialDescription;
    }
    const snapshot = buildTestSnapshot(world, overrides);
    const npcProjection = projectNpcMemoryState(snapshot.npcMemory);
    const relationships = snapshot.relationships ?? npcProjection.relationships;

    const currentScene = getSceneById(world, snapshot.currentSceneId);
    const sceneName = currentScene?.name ?? snapshot.currentSceneId;
    const regionName = currentScene?.region ?? "未知区域";
    const availableNpcs = currentScene?.npcs ?? [];
    const invSummary = snapshot.inventory.length > 0
      ? snapshot.inventory.map((i) => `${i.name}×${i.quantity}`).join("、") : "空";

    const gt = snapshot.currentGameTime;
    const cal = gameTimeToCalendar(gt);
    const timeLabel = formatTimeOfDay(gt.hour);

    const readableView: ReadableGameState = {
      sceneDescription: snapshot.sceneNarrative || currentScene?.initialDescription || "",
      availableNpcs,
      playerSummary: `姓名：${snapshot.playerName} | 背包：${invSummary}`,
      weather: snapshot.weather ?? "晴",
      timeOfDay: `第${gt.day}天 ${String(gt.hour).padStart(2, "0")}:${String(gt.minute).padStart(2, "0")} ${timeLabel}（裂隙历${cal.year}年${cal.month}月${cal.day}日）`,
      sceneName, regionName,
      discoveredClues: snapshot.clues.filter((c) => c.discovered).map((c) => `${c.name}: ${c.description.slice(0, 60)}...`),
      activeQuests: snapshot.questLog.filter((q) => q.status === "active").map((q) => `[${q.title}] ${q.description}`),
      availableActions: snapshot.availableActions,
      recentHistory: [],
      encyclopediaCount: snapshot.encyclopedia.length,
      relationshipSummary: Object.entries(relationships).map(([name, rel]) => `${name}: 好感${rel.affinity} 信任${rel.trust}`),
    };

    return NextResponse.json({ world, snapshot, readableView } satisfies TestStateResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "未知错误" }, { status: 500 });
  }
}
