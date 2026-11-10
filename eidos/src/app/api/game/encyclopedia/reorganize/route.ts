import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek, parseJSON } from "@/lib/ai/client";
import {
  buildEncyclopediaMaintenancePrompt,
  filterPlayerEncyclopediaEntries,
  sanitizeEncyclopediaMaintenanceResult,
} from "@/lib/game/encyclopedia-maintenance";
import type { EncyclopediaEntry } from "@/lib/game/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const encyclopedia = filterPlayerEncyclopediaEntries(body.encyclopedia);
    const mode = body.mode === "incremental" ? "incremental" : "reorganize";
    const recentHistory = Array.isArray(body.recentHistory)
      ? body.recentHistory
          .filter((item: unknown): item is { playerInput: string; summary: string } =>
            typeof item === "object"
            && item !== null
            && typeof (item as Record<string, unknown>).playerInput === "string"
            && typeof (item as Record<string, unknown>).summary === "string",
          )
          .slice(-20)
      : [];

    const prompt = buildEncyclopediaMaintenancePrompt({
      mode,
      encyclopedia,
      recentHistory,
    });

    const { content, usage, elapsedMs } = await callDeepSeek(
      prompt.systemPrompt,
      prompt.userMessage,
      0.2,
      2500,
      true,
      90000,
      "kei",
      body._settings ?? null,
      undefined,
      "kei_encyclopedia_maintenance",
    );
    const parsed = parseJSON<unknown>(content);
    const result = sanitizeEncyclopediaMaintenanceResult(parsed, encyclopedia as EncyclopediaEntry[]);

    return NextResponse.json({
      ...result,
      _tokenUsage: usage,
      _elapsedMs: elapsedMs,
    });
  } catch (error) {
    console.error("Encyclopedia maintenance error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "百科整理失败" },
      { status: 500 },
    );
  }
}
