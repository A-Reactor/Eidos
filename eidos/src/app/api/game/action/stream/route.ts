import { failedContextDiagnostics } from '@/lib/ai/action-context-diagnostics';
import { parseNarrativeRequest } from '@/lib/game/narrative';
// ============================================================
// Eidos · 游戏行动流式 API (SSE)
// POST /api/game/action/stream
// ============================================================

import { NextRequest } from "next/server";
import { readJsonObject, validateActionInput, inputErrorResponse } from '@/lib/api/request-input';
import { processPlayerActionStream } from "@/lib/ai/action-stream";
import { executeWebTool } from '@/lib/server/web-tools';
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import { drainPendingTokens } from "@/lib/ai/client";
import type { WorldSnapshot, WorldDefinition, InventoryItem, Clue, CriticalFactEntry, EncyclopediaEntry, QuestEntry, ProtagonistState } from "@/lib/game/types";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await readJsonObject(request, Infinity);
    validateActionInput(body);
  } catch (error) {
    return inputErrorResponse(error);
  }

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
    weather,
    protagonistState,
    forceFull,
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
    weather?: string;
    protagonistState?: ProtagonistState | null;
    forceFull?: boolean;
    _settings?: Record<string, string>;
    _creativeConfig?: import("@/lib/game/types").CreativeModeConfig | null;
    _metaRealityContext?: string;
    _longMemoryContext?: string;
    _bias?: number;
    _worldLineSummary?: import("@/lib/ai/context-builder").WorldLineSummary;
    _sandboxMode?: boolean;
    _sandboxToolAudit?: import("@/lib/ai/sandbox-tool-pipeline").SandboxToolAuditPromptEntry[];
  } = body;

  if (!playerInput || !snapshot) {
    return new Response(
      JSON.stringify({ error: "缺少必要参数" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const worldDef = world ?? getBuiltInWorld();

  // 创建 SSE 流
  const encoder = new TextEncoder();
  const generation = new AbortController();
  let closed = false;
  const cancelRequest = () => generation.abort(request.signal.reason);
  const cleanup = () => request.signal.removeEventListener('abort', cancelRequest);
  request.signal.addEventListener('abort', cancelRequest, { once: true });
  if (request.signal.aborted) cancelRequest();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        if (closed || generation.signal.aborted) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true; cleanup(); controller.close();
      };
      const fail = (error: unknown) => {
        const code = (error as { code?: unknown })?.code;
        send({ type: 'error', message: error instanceof Error ? error.message : '未知错误', _contextDiagnostics: failedContextDiagnostics(error),
          ...(typeof code === 'string' ? { code } : {}) });
        close();
      };

      let segmentsSent = false;

      // Do not keep ReadableStream.start pending: reader cancellation must reach the model immediately.
      void (async () => { try {
        generation.signal.throwIfAborted();
        await processPlayerActionStream({
          webToolExecutor: executeWebTool,
          imageCatalog: body.imageCatalog,
      imageInputs: body.imageInputs,
      chapterPreparation: body.chapterPreparation,
          documentMode: body.documentMode === true,
      workspaceContext: body.workspaceContext,
      cardContext: body.cardContext,
          signal: generation.signal,
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
          weather: weather ?? "晴",
          protagonistState: protagonistState ?? null,
          worldLineSummary: _worldLineSummary,
          callbacks: {
            onActivity: ({ phase, elapsedMs, reasoningChars }) => send({ type: 'activity', phase, elapsedMs, reasoningChars }),
            onUsage: usage => send({ type: "usage", usage }),
            onProgress: (charsReceived) => {
              // 每 100 字符发一次进度（避免过于频繁）
              if (charsReceived % 100 < 20) {
                send({ type: "progress", charsReceived });
              }
            },
            onSegments: (segments, lastIsDraft) => {
              segmentsSent = true;
              send({ type: "segments", segments, lastIsDraft: lastIsDraft ?? false });
            },
            onDone: (response) => {
              // 如果 onSegments 已经发过 segments，这里只发元数据
              // 同时清除 narrative/dialogue 防止客户端 fallback 覆盖渐进式 segments
              const pendingTokens = drainPendingTokens();
              send({
                type: "done",
                ...response,
                segments: segmentsSent ? undefined : response.segments,
                narrative: segmentsSent ? undefined : (response as any).narrative,
                dialogue: segmentsSent ? undefined : (response as any).dialogue,
                _pendingKeyTokens: pendingTokens.length > 0 ? pendingTokens : undefined,
              });
              close();
            },
            onError: (error) => {
              fail(error);
            },
          },
          clientSettings: _settings ?? null,
          creativeConfig: _creativeConfig ?? null,
          metaRealityContext: _metaRealityContext ?? "",
          longMemoryContext: _longMemoryContext ?? "",
          generationBias: _bias ?? 50,
          sandboxMode: _sandboxMode ?? false,
          sandboxToolAudit: _sandboxToolAudit ?? [],
        });
      } catch (error) {
        fail(error);
      } })();
    },
    cancel(reason) { closed = true; cleanup(); generation.abort(reason); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
