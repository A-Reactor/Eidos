// ============================================================
// Eidos · 旧身份读取 API（本地兼容，不调用模型）
// POST /api/game/identity
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { generateIdentityOptions } from "@/lib/ai/builtin-worlds";
import { getRiftCityIdentities } from '@/data/world/rift-city-identities';
import type { WorldDefinition } from "@/lib/game/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const world: WorldDefinition | null = body.world ?? null;

    const result = await generateIdentityOptions(world);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Identity read error:", error);
    return NextResponse.json(
      {
        options: getRiftCityIdentities(),
      },
      { status: 200 }
    );
  }
}
