import { NextResponse } from "next/server";
import { momoiClient } from "@/lib/game/momoi/client";
import { checkStaleProcess } from "@/lib/game/momoi/process-guard";

export async function GET() {
  const health = await momoiClient.healthCheck().catch(() => null);
  if (health?.status === "ready" || health?.status === "loading_model" || health?.status === "error") {
    const devices: Record<string, string> = { cpu: 'CPU', mps: 'MPS（Apple GPU）', cuda: 'CUDA（NVIDIA GPU）' };
    const readyHint = health.device ? `本地语音服务已就绪 · ${devices[health.device] ?? health.device}${health.fallbackReason ? `；${health.fallbackReason}` : ''}` : '';
    return NextResponse.json({
      status: health.status === "loading_model" ? "loading" : health.status,
      modelLoaded: health.modelLoaded ?? "",
      uptimeSeconds: health.uptimeSeconds ?? 0,
      error: health.error,
      device: health.device,
      requestedDevice: health.requestedDevice,
      precision: health.precision,
      fallbackReason: health.fallbackReason,
      hint: health.status === "loading_model" ? "模型正在加载，首次启动可能需要 1–2 分钟。" : health.status === "error" ? "本地模型报告异常，请检查服务日志。" : readyHint,
    });
  }
  // A PID file alone does not prove that its process is still running.
  const process = checkStaleProcess();
  if (process?.isAlive && process.ageSeconds < 120) {
    return NextResponse.json({ status: "loading", hint: "本地进程已启动，正在等待模型响应，首次加载可能需要 1–2 分钟。" });
  }
  return NextResponse.json({
    status: process?.isAlive ? "busy" : "offline",
    hint: process?.isAlive ? "进程仍在运行，但健康检查暂未响应；可能正在生成或加载模型。" : "本地服务未运行，可启动模型后再次检查。",
  });
}
