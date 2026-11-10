import { readWorldCreationInput } from '@/lib/ai/world-creation-compiler';
import { normalizeGenerationProfile } from "@/lib/ai/world-generation-profile";
import { readJsonObject, creationPluginInput, inputErrorResponse, RequestInputError } from "@/lib/api/request-input";
import { PluginInputError } from "@/lib/game/plugins/manifest";
// ============================================================
// Eidos · 世界创建 API — 同一对话生成完整世界
// POST /api/world/create
// ============================================================
// 非流式调用也复用同一草稿、操作回执与验收循环。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { generateWorldConversation } from "@/lib/ai/world-generator";
import { normalizeNarrativeStyleProfile } from "@/lib/game/narrative-style";
import { isRecord } from '@/lib/game/source-reconstruction/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request, Infinity);
    const { narrativeStyle } = body;
    let creation: ReturnType<typeof readWorldCreationInput>;
    try { creation = readWorldCreationInput(body); } catch (error) { return inputErrorResponse(error); }
    const concept = typeof body.concept === "string" ? body.concept : creation ? "根据世界生成稿创建世界" : body.concept;
    const pluginInput = creationPluginInput(body);

    if (typeof concept !== "string" || concept.trim().length < 5) {
      return NextResponse.json(
        { error: "世界概念描述太短了——请至少写一两句话来描述你想创造的世界" },
        { status: 400 }
      );
    }

    if (concept.trim().length > 2000) {
      return NextResponse.json(
        { error: "世界概念描述太长了——请控制在2000字以内" },
        { status: 400 }
      );
    }

    const world = await generateWorldConversation({ concept: concept.trim(), ...creation,
      skillIds: pluginInput.skillIds, gameplayPlugins: pluginInput.gameplayPlugins,
      narrativeStyle: normalizeNarrativeStyleProfile(narrativeStyle), generationProfile: normalizeGenerationProfile(body.generationProfile),
      settings: isRecord(body._settings) ? body._settings as Record<string, string> : undefined });

    return NextResponse.json({ world });
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof PluginInputError) return inputErrorResponse(error);
    console.error("World creation error:", error);

    const message =
      error instanceof Error ? error.message : "世界创建失败";

    if (message.includes("401") || message.includes("403")) {
      return NextResponse.json(
        {
          error:
            "AI API 认证失败。请检查 DEEPSEEK_API_KEY 环境变量是否正确设置。",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: `世界创建失败：${message}`,
      },
      { status: 500 }
    );
  }
}
