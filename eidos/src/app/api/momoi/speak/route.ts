// Local desktop API. Same-origin callers only; 4 concurrent requests, no paid retries.
// POST VoiceRequest -> {audioBase64,mimeType}; 400 input, 403 origin, 429 busy, 502 upstream.
import { NextRequest, NextResponse } from "next/server";
import { synthesizeVoice, validateVoiceRequest, VoiceInputError } from "@/lib/game/momoi/providers";
import { readJsonObject, RequestInputError, inputErrorResponse } from '@/lib/api/request-input';
let active = 0;
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "不允许跨站语音请求" }, { status: 403 });
  if (active >= 4) return NextResponse.json({ error: "语音服务繁忙，请稍后重试" }, { status: 429 });
  active++;
  try {
    const value = await readJsonObject(request, 16 * 1024 * 1024);
    const input = validateVoiceRequest(value);
    return NextResponse.json(await synthesizeVoice(input, request.signal));
  } catch (error) {
    if (error instanceof RequestInputError) return inputErrorResponse(error);
    const message = error instanceof Error ? error.message : "语音生成失败";
    return NextResponse.json({ error: message }, { status: error instanceof VoiceInputError ? 400 : 502 });
  } finally { active--; }
}
