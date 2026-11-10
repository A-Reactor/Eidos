// ============================================================
// Eidos · AI 测试 Action API
// POST /api/test/action
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { processPlayerAction, lastPromptSent, setLastPromptSent } from "@/lib/ai/action-handler";
import { executeWebTool } from '@/lib/server/web-tools';
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { drainPendingTokens } from "@/lib/ai/client";
import type { TestActionResponse, TestDebugInfo } from "@/lib/test/types";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await request.json();
    const {
      playerInput, snapshot, recentHistory, world, inventory, clues,
      encyclopedia, criticalFacts, questLog, introspection, weather,
      protagonistState, _settings, _creativeConfig, _metaRealityContext, _bias, _debug = true,
    } = body as any;

    if (!playerInput || !snapshot) {
      return NextResponse.json({ error: "缺少必要参数 playerInput 或 snapshot" }, { status: 400 });
    }

    const worldDef = world ?? getBuiltInWorld();
    setLastPromptSent("");

    const result = await processPlayerAction({
      webToolExecutor: executeWebTool,
      playerInput, snapshot, recentHistory: recentHistory ?? [], world: worldDef,
      inventory: inventory ?? [], clues: clues ?? [], encyclopedia: encyclopedia ?? [],
      criticalFacts: criticalFacts ?? [], questLog: questLog ?? [],
      introspection: introspection ?? false, weather: weather ?? "晴",
      protagonistState: protagonistState ?? null, forceFull: body.forceFull ?? false,
      clientSettings: _settings ?? null, creativeConfig: _creativeConfig ?? null,
      metaRealityContext: _metaRealityContext ?? "",
      generationBias: _bias ?? 50,
    });

    const elapsedMs = Date.now() - startTime;
    const pendingTokens = drainPendingTokens();
    const response: TestActionResponse = { ...result };

    if (_debug) {
      const tokenUsage = result._tokenUsage ?? null;
      response._debug = {
        promptSent: lastPromptSent || "(未捕获)",
        tokenUsage, elapsedMs,
        keiTokens: pendingTokens.length > 0 ? pendingTokens : [],
        finishReason: "stop", modelUsed: "alice",
      } satisfies TestDebugInfo;
    }

    (response as any)._pendingKeyTokens = pendingTokens.length > 0 ? pendingTokens : undefined;
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "未知错误",
      _debug: { promptSent: lastPromptSent || "", tokenUsage: null, elapsedMs: Date.now() - startTime, keiTokens: [], finishReason: "error", modelUsed: "alice" },
    }, { status: 500 });
  }
}
