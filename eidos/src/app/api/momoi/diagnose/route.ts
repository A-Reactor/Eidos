// GET /api/momoi/diagnose — MOMOI 综合诊断
// 一键检测：进程状态 + 模型状态 + 轻量合成测试 + 队列诊断
//
// 用于调试 Python MLX hang：区分「进程已死」「模型未加载」「模型 hang」
import { NextResponse } from "next/server";
import { momoiClient } from "@/lib/game/momoi/client";
import { ttsQueue } from "@/lib/game/momoi/queue";
import { getGuardStatus, checkStaleProcess } from "@/lib/game/momoi/process-guard";
import { getActualPort, getMomoiBaseUrl } from "@/lib/game/momoi/config";

export async function GET() {
  const port = getActualPort();
  const baseUrl = getMomoiBaseUrl();
  const guard = getGuardStatus();
  const stale = checkStaleProcess();
  const queueDiag = ttsQueue.getDiagnostics();

  // Step 1: 进程检测
  const processInfo = {
    port,
    baseUrl,
    guard: {
      hasChild: guard.hasChild,
      pid: guard.pid,
      pidFileExists: guard.pidFileExists,
    },
    staleProcess: stale
      ? {
          pid: stale.pid,
          port: stale.port,
          isAlive: stale.isAlive,
          ageSeconds: stale.ageSeconds,
        }
      : null,
  };

  // Step 2: 模型状态
  let modelStatus: string;
  let modelName: string;
  let uptimeSeconds: number;
  let healthCheckMs: number;

  const t0 = Date.now();
  try {
    const health = await momoiClient.healthCheck();
    healthCheckMs = Date.now() - t0;
    modelStatus = health.status;
    modelName = health.modelLoaded ?? "";
    uptimeSeconds = health.uptimeSeconds ?? 0;
  } catch {
    healthCheckMs = Date.now() - t0;
    modelStatus = "offline";
    modelName = "";
    uptimeSeconds = 0;
  }

  // Step 3: 轻量合成测试（仅在模型就绪时执行）
  const synthTest: {
    ran: boolean;
    success: boolean;
    elapsedMs: number | null;
    error: string | null;
    audioDurationMs: number | null;
  } = { ran: false, success: false, elapsedMs: null, error: null, audioDurationMs: null };

  if (modelStatus === "ready") {
    synthTest.ran = true;
    const synthT0 = Date.now();
    try {
      const response = await fetch(`${baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "测试",
          speaker: "__diagnostic__",
          worldId: "",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) {
        const result = await response.json();
        synthTest.success = true;
        synthTest.elapsedMs = Date.now() - synthT0;
        synthTest.audioDurationMs = result.durationMs ?? 0;
      } else {
        const err = await response.json().catch(() => ({}));
        synthTest.success = false;
        synthTest.elapsedMs = Date.now() - synthT0;
        synthTest.error = (err as any).error ?? `HTTP ${response.status}`;
      }
    } catch (err) {
      synthTest.success = false;
      synthTest.elapsedMs = Date.now() - synthT0;
      synthTest.error = (err as Error).message;
    }
  }

  // 综合判断
  let overallVerdict: "healthy" | "busy" | "degraded" | "hung" | "offline";
  if (modelStatus === "ready" && synthTest.success) {
    overallVerdict = "healthy";
  } else if (modelStatus === "ready" && !synthTest.success && queueDiag.consecutiveTimeouts >= 3) {
    overallVerdict = "hung";
  } else if (modelStatus === "ready" && !synthTest.success) {
    overallVerdict = "degraded";
  } else if (modelStatus === "loading_model") {
    overallVerdict = "busy";
  } else {
    overallVerdict = "offline";
  }

  return NextResponse.json({
    timestamp: Date.now(),
    overallVerdict,
    process: processInfo,
    model: {
      status: modelStatus,
      name: modelName,
      uptimeSeconds,
      healthCheckMs,
    },
    synthTest,
    queue: queueDiag,
  });
}
