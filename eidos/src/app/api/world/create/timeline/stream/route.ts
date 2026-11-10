import { creationResponse } from "@/lib/ai/creation-response";
// ============================================================
// Eidos · 时间线流式 API (SSE)
// POST /api/world/create/timeline/stream
// ============================================================
// KEI 推演世界时间线时，实时推送已推演的事件数

import { NextRequest } from "next/server";
import { generateWorldTimelineStream } from "@/lib/ai/world-generator";
import { readJsonObject, inputErrorResponse } from '@/lib/api/request-input';
import { isRecord } from '@/lib/game/source-reconstruction/validation';
import { validateCreatedWorld } from '@/lib/ai/world-creation-compiler';
import type { WorldDefinition } from '@/lib/game/types';

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, Infinity);
  } catch (error) { return inputErrorResponse(error); }

  const world = body.world as WorldDefinition;
  const checked = validateCreatedWorld({ world });
  if (!checked.ok) {
    return new Response(JSON.stringify({ error: `世界设定无效：${checked.issues.join('；')}` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  return creationResponse(request, async (send, signal) => {
      let thinkingSent = false;


        const timeline = await generateWorldTimelineStream(
          world,
          () => {
            if (!thinkingSent) {
              thinkingSent = true;
              send({ type: "thinking" });
            }
          },
          (eventCount) => {
            thinkingSent = false;
            send({ type: "progress", eventCount });
          },
          (estimatedPrompt, estimatedCompletion, charsReceived) => {
            send({
              type: "tokens",
              estimatedPrompt,
              estimatedCompletion,
              estimatedTotal: estimatedPrompt + estimatedCompletion,
              charsReceived,
            });
          },
          { resumeText: typeof body.resumeText === "string" ? body.resumeText : undefined, signal,
            settings: isRecord(body._settings) ? body._settings as Record<string, string> : undefined,
            onReset: (text, reason) => send({ type: 'reset', text, reason }),
            onText: (_text, delta) => send({ type: "delta", delta }), onTokenUsage: usage => send({ type: "usage", usage }) }
        );

        send({ type: "done", timeline });

  });
}
