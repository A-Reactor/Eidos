// POST /api/momoi/stop — 停止语音服务器
import { NextResponse } from "next/server";
import { ttsQueue } from "@/lib/game/momoi/queue";
import { unguardProcess } from "@/lib/game/momoi/process-guard";

export async function POST() {
  try {
    // 1. 取消所有排队任务
    ttsQueue.cancelAll();

    // 2. 优雅停止 Python 进程（含模型卸载）
    await unguardProcess();

    return NextResponse.json({ ok: true, status: "stopped" });
  } catch (err) {
    console.error("[MomoiStop] error:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
