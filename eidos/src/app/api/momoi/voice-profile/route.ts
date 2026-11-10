// /api/momoi/voice-profile — NPC 音色 Profile 管理
//
// GET:    列出某世界的所有 NPC 音色 profile
// POST:   上传 NPC 参考音频（base64 WAV）
// DELETE: 删除 NPC 参考音频
import { NextRequest, NextResponse } from "next/server";
import {
  saveReferenceAudio,
  deleteReferenceAudio,
  listVoiceProfiles,
} from "@/lib/game/momoi/cache";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const worldId = searchParams.get("worldId") ?? "";

  if (!worldId) {
    return NextResponse.json({ error: "缺少 worldId 参数" }, { status: 400 });
  }

  const profiles = await listVoiceProfiles(worldId);
  return NextResponse.json({ profiles });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { worldId, speaker, audio } = body;

    if (!worldId || !speaker || !audio) {
      return NextResponse.json(
        { error: "缺少 worldId, speaker 或 audio 参数" },
        { status: 400 },
      );
    }

    const url = await saveReferenceAudio(worldId, speaker, audio);
    return NextResponse.json({ ok: true, url, speaker, worldId });
  } catch (error) {
    console.error("[MomoiVoiceProfile] upload error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const worldId = searchParams.get("worldId") ?? "";
  const speaker = searchParams.get("speaker") ?? "";

  if (!worldId || !speaker) {
    return NextResponse.json(
      { error: "缺少 worldId 或 speaker 参数" },
      { status: 400 },
    );
  }

  const deleted = await deleteReferenceAudio(worldId, speaker);
  return NextResponse.json({ ok: deleted, speaker, worldId });
}
