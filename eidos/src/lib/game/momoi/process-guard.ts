// ============================================================
// Eidos · MOMOI 进程守护
// ============================================================
// 管理 Python 语音服务器的生命周期。
// 完全镜像 MIDORI process-guard.ts 的模式。
//
// 机制：
//   1. PID 文件 — 写入 .momoi_pid，持久化 pid/port/startedAt
//   2. 退出信号 — 注册 process.on('exit')/SIGTERM/SIGINT，退出前杀子进程
//   3. 残留恢复 — 启动时检测 .momoi_pid 中是否有孤儿进程，自动清理
//
// 仅在 Node.js 服务端使用（import fs），不在浏览器端导入
// ============================================================

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { ChildProcess } from "child_process";

// ============================================================
// PID 文件
// ============================================================

const PID_FILE = path.join(process.cwd(), ".momoi_pid");

interface PidEntry {
  pid: number;
  port: number;
  startedAt: number;
}

function writePidFile(entry: PidEntry): void {
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify(entry, null, 2), "utf-8");
    console.log(`[MomoiGuard] PID 文件已写入: pid=${entry.pid} port=${entry.port}`);
  } catch (err) {
    console.warn("[MomoiGuard] 写入 PID 文件失败:", (err as Error).message);
  }
}

function readPidFile(): PidEntry | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const raw = fs.readFileSync(PID_FILE, "utf-8");
      return JSON.parse(raw) as PidEntry;
    }
  } catch { /* 文件损坏或权限问题 */ }
  return null;
}

function deletePidFile(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      console.log("[MomoiGuard] PID 文件已清除");
    }
  } catch (err) {
    console.warn("[MomoiGuard] 清除 PID 文件失败:", (err as Error).message);
  }
}

// ============================================================
// 进程存活检测（跨平台）
// ============================================================

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid: number): boolean {
  if (!isPidAlive(pid)) return false;

  try {
    process.kill(pid, "SIGTERM");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      if (!isPidAlive(pid)) return true;
      execSync("sleep 0.2", { timeout: 1000 });
    }
    process.kill(pid, "SIGKILL");
    return true;
  } catch (err) {
    console.warn(`[MomoiGuard] killPid(${pid}) 失败:`, (err as Error).message);
    return false;
  }
}

// ============================================================
// 残留进程检测与清理
// ============================================================

export interface StaleProcessInfo {
  pid: number;
  port: number;
  startedAt: number;
  isAlive: boolean;
  ageSeconds: number;
}

export function checkStaleProcess(): StaleProcessInfo | null {
  const entry = readPidFile();
  if (!entry) return null;

  const alive = isPidAlive(entry.pid);
  const ageSeconds = Math.floor((Date.now() - entry.startedAt) / 1000);

  return { ...entry, isAlive: alive, ageSeconds };
}

export async function cleanupStaleProcess(): Promise<{
  cleaned: boolean;
  wasAlive: boolean;
  details: string;
}> {
  const entry = readPidFile();
  if (!entry) {
    return { cleaned: false, wasAlive: false, details: "无残留 PID 文件" };
  }

  const alive = isPidAlive(entry.pid);
  let details = "";

  if (alive) {
    // 先尝试优雅卸载模型
    try {
      await fetch(`http://127.0.0.1:${entry.port}/unload`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      details += "模型已卸载; ";
    } catch {
      details += "模型卸载请求失败（进程可能已僵死）; ";
    }

    const killed = killPid(entry.pid);
    details += killed ? "进程已终止" : "进程终止失败";
  } else {
    details = "进程已不存在，仅清理 PID 文件";
  }

  deletePidFile();
  return { cleaned: true, wasAlive: alive, details };
}

// ============================================================
// 进程守护注册
// ============================================================

let guardedChild: ChildProcess | null = null;
let guardedPort: number = 0;
let handlersInstalled = false;

function installExitHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const cleanup = () => {
    if (guardedChild) {
      const pid = guardedChild.pid;
      console.log(`[MomoiGuard] 退出清理: 终止 Python 子进程 pid=${pid}`);
      try {
        if (guardedPort > 0) {
          fetch(`http://127.0.0.1:${guardedPort}/unload`, {
            method: "POST",
            signal: AbortSignal.timeout(3000),
          }).catch(() => {});
        }
      } catch { /* ignore */ }

      if (guardedChild.pid) {
        try {
          process.kill(guardedChild.pid, "SIGKILL");
        } catch { /* 进程可能已退出 */ }
      }
      guardedChild = null;
    }
    deletePidFile();
  };

  process.on("exit", () => {
    if (guardedChild?.pid) {
      try { process.kill(guardedChild.pid, "SIGKILL"); } catch { /* ok */ }
    }
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch { /* ok */ }
  });

  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.on(signal, () => {
      console.log(`[MomoiGuard] 收到 ${signal}，清理子进程...`);
      cleanup();
      process.exit(0);
    });
  });

  process.on("uncaughtException", (err) => {
    console.error("[MomoiGuard] 未捕获异常，紧急清理:", err.message);
    cleanup();
    process.exit(1);
  });
}

/**
 * 将子进程纳入守护管理。
 */
export function guardProcess(child: ChildProcess, port: number): void {
  installExitHandlers();

  guardedChild = child;
  guardedPort = port;

  writePidFile({
    pid: child.pid!,
    port,
    startedAt: Date.now(),
  });

  child.setMaxListeners(20);  // 防止多次守护时 listener 累积警告
  child.on("exit", (code, signal) => {
    console.log(`[MomoiGuard] Python 子进程已退出 (code=${code} signal=${signal})`);
    guardedChild = null;
    guardedPort = 0;
    deletePidFile();
  });

  console.log(`[MomoiGuard] 已守护 pid=${child.pid} port=${port}`);
}

/**
 * 取消守护（用户主动停止时调用）。
 */
export async function unguardProcess(): Promise<void> {
  if (!guardedChild) {
    const entry = readPidFile();
    if (entry && isPidAlive(entry.pid)) {
      console.log(`[MomoiGuard] 发现残留进程 pid=${entry.pid}，执行清理`);
      await cleanupStaleProcess();
    } else {
      deletePidFile();
    }
    return;
  }

  const pid = guardedChild.pid;

  if (guardedPort > 0) {
    try {
      await fetch(`http://127.0.0.1:${guardedPort}/unload`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      console.log("[MomoiGuard] 模型已卸载");
    } catch {
      console.warn("[MomoiGuard] 模型卸载请求失败（进程可能已退出）");
    }
  }

  if (pid) killPid(pid);

  guardedChild = null;
  guardedPort = 0;
  deletePidFile();
  console.log("[MomoiGuard] 守护已解除");
}

/**
 * 获取当前守护状态。
 */
export function getGuardStatus(): {
  hasChild: boolean;
  pid: number | null;
  port: number;
  pidFileExists: boolean;
} {
  return {
    hasChild: guardedChild !== null,
    pid: guardedChild?.pid ?? null,
    port: guardedPort,
    pidFileExists: fs.existsSync(PID_FILE),
  };
}
