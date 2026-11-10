// ============================================================
// Eidos · 世界创建 API — 阶段二：推演时间线
// POST /api/world/create/timeline
// ============================================================
// 基于阶段一生成的世界设定，推演 35-50 个世界事件
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { generateWorldTimeline } from "@/lib/ai/world-generator";
import type { WorldDefinition } from "@/lib/game/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { world }: { world: WorldDefinition } = body;

    if (!world || !world.name) {
      return NextResponse.json(
        { error: "缺少世界设定数据" },
        { status: 400 }
      );
    }

    const timeline = await generateWorldTimeline(world, body._settings);

    return NextResponse.json({ timeline });
  } catch (error) {
    console.error("Timeline generation error:", error);

    const message =
      error instanceof Error ? error.message : "时间线生成失败";

    return NextResponse.json(
      { error: `时间线生成失败：${message}` },
      { status: 500 }
    );
  }
}
