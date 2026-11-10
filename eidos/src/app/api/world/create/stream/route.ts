import { readWorldCreationInput } from '@/lib/ai/world-creation-compiler';
import { normalizeGenerationProfile } from "@/lib/ai/world-generation-profile";
import { readJsonObject, creationPluginInput, inputErrorResponse } from "@/lib/api/request-input";
import { creationResponse } from "@/lib/ai/creation-response";
// ============================================================
// Eidos · 世界创建流式 API (SSE)
// POST /api/world/create/stream
// ============================================================
// 同一作者对话生成全部世界内容；checkpoint 在每次操作边界保存草稿与回执。
// ============================================================

import { NextRequest } from "next/server";
import { generateWorldConversationStream } from "@/lib/ai/world-generator";
import { normalizeNarrativeStyleProfile } from "@/lib/game/narrative-style";
import { isRecord } from '@/lib/game/source-reconstruction/validation';
import { readWorldCreationSession } from '@/lib/game/world-creation-session';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  let creation: ReturnType<typeof readWorldCreationInput>;
  let pluginInput: ReturnType<typeof creationPluginInput>;
  let session: ReturnType<typeof readWorldCreationSession>;
  try {
    body = await readJsonObject(request, Infinity);
    creation = readWorldCreationInput(body);
    pluginInput = creationPluginInput(body);
    session = readWorldCreationSession(body.conversation);
  } catch (error) { return inputErrorResponse(error); }
  const concept = typeof body.concept === "string" ? body.concept : creation ? "根据世界生成稿创建世界" : body.concept;
  if (typeof concept !== "string" || concept.trim().length < 5 || concept.length > 50_000) {
    return Response.json({ error: "世界概念须为 5–50,000 字符" }, { status: 400 });
  }
  const generationId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return creationResponse(request, async (send, signal) => {
    let thinkingSent = false;
    send({ type: "started", generationId });
    const world = await generateWorldConversationStream({
      concept: concept.trim(), ...creation,
      settings: isRecord(body._settings) ? body._settings as Record<string, string> : undefined,
      skillIds: pluginInput.skillIds, gameplayPlugins: pluginInput.gameplayPlugins,
      narrativeStyle: normalizeNarrativeStyleProfile(body.narrativeStyle), generationProfile: normalizeGenerationProfile(body.generationProfile),
    }, {
      session, signal, resumeText: typeof body.resumeText === 'string' ? body.resumeText : undefined,
      onThinking: () => { if (!thinkingSent) { thinkingSent = true; send({ type: "thinking" }); } },
      onProgress: progress => { thinkingSent = false; send({ type: "progress", ...progress }); },
      onTokens: (estimatedPrompt, estimatedCompletion, charsReceived) => send({ type: "tokens", estimatedPrompt, estimatedCompletion, estimatedTotal: estimatedPrompt + estimatedCompletion, charsReceived }),
      onCheckpoint: conversation => send({ type: 'checkpoint', conversation }),
      onText: (_text, delta) => { thinkingSent = false; send({ type: 'delta', delta }); },
      onTokenUsage: usage => send({ type: 'usage', usage }),
    }, generationId);
    send({ type: "done", world });
  });
}
