import { ContextBudgetError } from '@/lib/ai/prompt-budget';
import { failedContextDiagnostics } from '@/lib/ai/action-context-diagnostics';
import { parseNarrativeRequest } from '@/lib/game/narrative';
import { generateMapJourney } from "@/lib/ai/map-journey";
import { validateTravelPath } from "@/lib/game/map-journey";
// ============================================================
// Eidos · 游戏行动 API
// POST /api/game/action
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject, validateActionInput, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
import { PluginInputError } from '@/lib/game/plugins/manifest';
import { processPlayerAction } from "@/lib/ai/action-handler";
import { executeWebTool } from '@/lib/server/web-tools';
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { drainPendingTokens } from "@/lib/ai/client";
import { AiGenerationError } from '@/lib/ai/providers/stream-control';
import type { WorldSnapshot, WorldDefinition, InventoryItem, Clue, CriticalFactEntry, EncyclopediaEntry, QuestEntry, ProtagonistState } from "@/lib/game/types";

export async function POST(request: NextRequest) {
  try {
    const body: any = await readJsonObject(request, Infinity);
    validateActionInput(body);
    const {
      playerInput,
      snapshot,
      recentHistory,
      world,
      inventory,
      clues,
      encyclopedia,
      criticalFacts,
      questLog,
      introspection,
      weather,
      protagonistState,
      _settings,
      _creativeConfig,
      _metaRealityContext,
      _longMemoryContext,
      _bias,
      _worldLineSummary,
      _sandboxMode,
      _sandboxToolAudit,
    }: {
      playerInput: string;
      snapshot: WorldSnapshot;
      recentHistory: Array<{ playerInput: string; summary: string }>;
      world?: WorldDefinition | null;
      inventory?: InventoryItem[];
      clues?: Clue[];
      encyclopedia?: EncyclopediaEntry[];
      criticalFacts?: CriticalFactEntry[];
      questLog?: QuestEntry[];
      introspection?: boolean;
      weather?: string;
      protagonistState?: ProtagonistState | null;
      _settings?: { aliceApiKey?: string; aliceEndpoint?: string; aliceModel?: string; keiApiKey?: string; keiEndpoint?: string; keiModel?: string };
      _creativeConfig?: import("@/lib/game/types").CreativeModeConfig | null;
      _metaRealityContext?: string;
      _longMemoryContext?: string;
      _bias?: number;
      _worldLineSummary?: import("@/lib/ai/context-builder").WorldLineSummary;
      _sandboxMode?: boolean;
      _sandboxToolAudit?: import("@/lib/ai/sandbox-tool-pipeline").SandboxToolAuditPromptEntry[];
    } = body;

    if (!playerInput || !snapshot) {
      return NextResponse.json(
        { error: "缺少必要参数" },
        { status: 400 }
      );
    }

    const worldDef = world ?? getBuiltInWorld();

    if (body.travelPath !== undefined) {
      try { validateTravelPath(worldDef, snapshot, body.travelPath); }
      catch { return NextResponse.json({ error: "旅行路线无效，请重新选择。" }, { status: 400 }); }
      return NextResponse.json(await generateMapJourney({ world: worldDef, snapshot, path: body.travelPath, settings: _settings }));
    }

    const { forceFull } = body as any;
    const result = await processPlayerAction({
      webToolExecutor: executeWebTool,
      imageCatalog: body.imageCatalog,
      imageInputs: body.imageInputs,
      chapterPreparation: body.chapterPreparation,
      documentMode: body.documentMode === true,
      workspaceContext: body.workspaceContext,
      cardContext: body.cardContext,
      signal: request.signal,
      narrativeRequest: parseNarrativeRequest(body.narrativeRequest),
      playerInput,
      snapshot,
      recentHistory: recentHistory ?? [],
      world: worldDef,
      inventory: inventory ?? [],
      clues: clues ?? [],
      encyclopedia: encyclopedia ?? [],
      criticalFacts: criticalFacts ?? [],
      questLog: questLog ?? [],
      introspection: introspection ?? false,
      weather: weather ?? "晴",
      protagonistState: protagonistState ?? null,
      forceFull: forceFull ?? false,
      clientSettings: _settings ?? null,
      creativeConfig: _creativeConfig ?? null,
      metaRealityContext: _metaRealityContext ?? "",
      longMemoryContext: _longMemoryContext ?? "",
      generationBias: _bias ?? 50,
      worldLineSummary: _worldLineSummary,
      sandboxMode: _sandboxMode ?? false,
      sandboxToolAudit: _sandboxToolAudit ?? [],
    });

    const pendingTokens = [...(result._chapterUsage ?? []), ...drainPendingTokens()];
    return NextResponse.json({ ...result, _pendingKeyTokens: pendingTokens.length > 0 ? pendingTokens : undefined });
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof PluginInputError) return inputErrorResponse(error);
    if (error instanceof ContextBudgetError) return NextResponse.json({ error: error.message, code: error.code, _pendingKeyTokens: (error as ContextBudgetError & { _chapterUsage?: unknown })._chapterUsage, _contextDiagnostics: failedContextDiagnostics(error) }, { status: 422 });
    console.error("Game action error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "未知错误",
        _pendingKeyTokens: (error as { _chapterUsage?: unknown })?._chapterUsage,
        ...(error instanceof AiGenerationError ? { code: error.code, _tokenUsage: error.usage } : {}) },
      { status: 500 }
    );
  }
}
