// POST /api/momoi/start — 启动语音服务器
// 策略：快速返回（不等待模型加载完成），由前端轮询 /api/momoi/status 直到就绪
//
// 进程守护：通过 process-guard 确保 Next.js 崩溃时自动清理 Python 子进程
// PID 文件 .momoi_pid 用于崩溃后恢复
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { resolveVoicePython } from '@/lib/game/momoi/training-runtime';
import {
  getActualPort,
  MOMOI_PYTHON_PORT,
  findFreePort,
  killPort,
  setActualPort,
} from "@/lib/game/momoi/config";
import {
  guardProcess,
  checkStaleProcess,
  cleanupStaleProcess,
  getGuardStatus,
} from "@/lib/game/momoi/process-guard";

const FLASK_STARTUP_MS = 5000;
const MODEL_LOAD_ESTIMATE_MS = 20000;

let starting = false;
let pendingProcess: { pid: number | undefined; startedAt: number; port: number } | null = null;

export async function GET() {
  const stale = checkStaleProcess();
  const port = getActualPort();
  const healthUrl = `http://127.0.0.1:${port}/health`;

  try {
    const check = await fetch(healthUrl, {
      signal: AbortSignal.timeout(2000),
    });
    if (check.ok) {
      const data = await check.json();
      return NextResponse.json({
        ok: true,
        status: data.status === "ready" ? "ready" : "loading_model",
        model: data.model ?? "",
        pendingProcess: pendingProcess
          ? { pid: pendingProcess.pid, startedAt: pendingProcess.startedAt }
          : null,
        guard: getGuardStatus(),
      });
    }
  } catch { /* server not reachable */ }

  if (pendingProcess && starting) {
    return NextResponse.json({
      ok: true,
      status: "loading_model",
      hint: "模型正在加载，请等待",
      elapsedMs: Date.now() - pendingProcess.startedAt,
      estimatedMs: MODEL_LOAD_ESTIMATE_MS,
    });
  }

  return NextResponse.json({
    ok: false,
    status: "offline",
    hint: "MOMOI 未运行",
    configuredPort: port,
    stalePidFile:
      stale && !stale.isAlive
        ? { pid: stale.pid, port: stale.port, ageSeconds: stale.ageSeconds }
        : null,
  });
}

export async function POST() {
  if (starting) {
    return NextResponse.json({
      ok: true,
      status: "loading_model",
      hint: "启动已在进行中，请稍候轮询 /api/momoi/status",
      elapsedMs: pendingProcess ? Date.now() - pendingProcess.startedAt : 0,
      estimatedMs: MODEL_LOAD_ESTIMATE_MS,
    });
  }

  // Reserve startup before the first await so repeated requests cannot spawn twice.
  starting = true;
  try { return await startLocalService(); }
  finally { starting = false; }
}

async function startLocalService() {
  // 检查是否已在运行（使用实际端口，HMR 安全）
  const currentPort = getActualPort();
  const healthUrl = `http://127.0.0.1:${currentPort}/health`;
  try {
    const check = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    if (check.ok) {
      const data = await check.json();
      if (data.status === "ready") {
        pendingProcess = null;
        return NextResponse.json({
          ok: true, pid: null, status: "already_running", model: data.model,
        });
      }
      if (data.status === "loading_model") {
        pendingProcess = null;
        return NextResponse.json({
          ok: true, pid: null, status: "loading_model",
        });
      }
    }
  } catch { /* 未运行，继续启动 */ }

  // 检查并清理上次崩溃残留
  const stale = checkStaleProcess();
  if (stale) {
    if (stale.isAlive) {
      console.log(
        `[MomoiStart] 发现残留进程 pid=${stale.pid} port=${stale.port} (运行了 ${stale.ageSeconds}s)`,
      );
      const result = await cleanupStaleProcess();
      console.log(`[MomoiStart] 残留清理: ${result.details}`);
    } else {
      console.log(`[MomoiStart] 发现僵尸 PID 文件 (pid=${stale.pid} 已死)，清理`);
      await cleanupStaleProcess();
    }
  }

  starting = true;
  try {
    const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "voice-server-gpt-sovits.py");

    if (!fs.existsSync(scriptPath)) {
      starting = false;
      return NextResponse.json(
        { ok: false, error: `脚本不存在: ${scriptPath}` },
        { status: 500 },
      );
    }

    const PORT = await findFreePort(MOMOI_PYTHON_PORT);
    const portChanged = PORT !== MOMOI_PYTHON_PORT;

    // 传播实际端口到全局配置
    setActualPort(PORT);

    const hadStale = killPort(PORT);
    if (hadStale) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    const child = spawn(await resolveVoicePython(), [scriptPath, "--port", String(PORT)], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout?.on("data", () => {}); // 消费 stdout 防止管道阻塞
    child.on("error", (err) => { stderr += err.message; });

    pendingProcess = { pid: child.pid, startedAt: Date.now(), port: PORT };

    const deadline = Date.now() + 120000;
    let lastStatus = "loading_model";

    while (Date.now() < deadline) {
      if (child.exitCode !== null && child.exitCode !== 0) {
        pendingProcess = null;
        starting = false;
        return NextResponse.json(
          {
            ok: false,
            error: `Python 进程启动失败（退出码 ${child.exitCode}）`,
            stderr: stderr.slice(-500) || "(无输出)",
          },
          { status: 500 },
        );
      }

      try {
        const check = await fetch(`http://127.0.0.1:${PORT}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (check.ok) {
          const data = await check.json();
          lastStatus = data.status;

          if (data.status === "error") {
            guardProcess(child, PORT);
            child.unref();
            pendingProcess = null;
            return NextResponse.json({ ok: false, error: data.error ?? "模型加载失败" }, { status: 500 });
          }

          if (data.status === "ready") {
            const elapsedMs = Date.now() - pendingProcess!.startedAt;
            guardProcess(child, PORT);
            child.unref();
            pendingProcess = null;
            starting = false;
            return NextResponse.json({
              ok: true,
              pid: child.pid,
              port: PORT,
              status: "ready",
              model: data.model,
              wasStale: hadStale,
              portChanged,
              elapsedMs,
            });
          }
        }
      } catch { /* Flask 还没起来 */ }

      if (lastStatus === "loading_model") {
        const elapsed = Date.now() - pendingProcess!.startedAt;
        if (elapsed > FLASK_STARTUP_MS) {
          guardProcess(child, PORT);
          child.unref();
          starting = false;
          return NextResponse.json({
            ok: true,
            pid: child.pid,
            port: PORT,
            status: "loading_model",
            hint: "模型正在加载，请等待 1-2 分钟。",
            elapsedMs: elapsed,
            estimatedMs: MODEL_LOAD_ESTIMATE_MS,
            wasStale: hadStale,
            portChanged,
          });
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    // 超时但进程仍存活
    if (child.exitCode === null) {
      guardProcess(child, PORT);
      child.unref();
      starting = false;
      return NextResponse.json({
        ok: true,
        pid: child.pid,
        port: PORT,
        status: "loading_model",
        hint: "模型加载超过预期时间，仍在加载中…",
        elapsedMs: Date.now() - pendingProcess!.startedAt,
        estimatedMs: MODEL_LOAD_ESTIMATE_MS,
        wasStale: hadStale,
        portChanged,
      });
    }

    pendingProcess = null;
    starting = false;
    return NextResponse.json(
      { ok: false, error: "启动超时，进程已退出", stderr: stderr.slice(-500) || "(无输出)" },
      { status: 500 },
    );
  } catch (err) {
    pendingProcess = null;
    starting = false;
    return NextResponse.json(
      { ok: false, error: `启动异常: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
