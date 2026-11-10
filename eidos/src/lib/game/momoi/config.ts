// ============================================================
// Eidos · MOMOI 端口与服务配置
// ============================================================
// 所有端口在此集中定义，通过环境变量可覆盖。
//
// 优先级：环境变量 > 运行时 setActualPort > 默认值
//
// 环境变量一览：
//   MOMOI_PYTHON_PORT  — Python TTS 服务器端口（默认 7872）
// ============================================================

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ============================================================
// PID 文件（HMR 安全：模块重载后从此恢复实际端口）
// ============================================================

const PID_FILE = path.join(process.cwd(), ".momoi_pid");

function readPortFromPidFile(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) {
      const raw = fs.readFileSync(PID_FILE, "utf-8");
      const entry = JSON.parse(raw);
      if (entry.port && typeof entry.port === "number") {
        return entry.port;
      }
    }
  } catch { /* 文件损坏或权限问题 */ }
  return null;
}

// ============================================================
// 端口定义
// ============================================================

function envPort(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0 && n < 65536) return n;
    console.warn(`[MomoiConfig] 无效的端口配置 ${key}=${raw}，使用默认值 ${fallback}`);
  }
  return fallback;
}

/** Python TTS 服务器默认端口 */
export const MOMOI_PYTHON_PORT = envPort("MOMOI_PYTHON_PORT", 7872);

// ============================================================
// 运行时端口覆盖
// ============================================================

let _actualPort: number | null = null;

/** 获取当前实际使用的 Python TTS 端口。
 *  优先级：setActualPort() > PID 文件 > 默认值。
 *  PID 文件兜底防止 Next.js HMR 重载模块后丢失端口设置。 */
export function getActualPort(): number {
  return _actualPort ?? readPortFromPidFile() ?? MOMOI_PYTHON_PORT;
}

/** 设置实际运行的端口（start 端点 findFreePort 后调用） */
export function setActualPort(port: number): void {
  _actualPort = port;
}

/** 获取 MOMOI Python 服务器的 base URL */
export function getMomoiBaseUrl(): string {
  return `http://127.0.0.1:${getActualPort()}`;
}

// ============================================================
// 端口冲突检测
// ============================================================

/**
 * 检查指定端口是否被占用。macOS/Linux 通用。
 */
export function isPortInUse(port: number): boolean {
  try {
    const result = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * 查找从 startPort 开始的第一个空闲端口。
 */
export async function findFreePort(startPort?: number): Promise<number> {
  const start = startPort ?? MOMOI_PYTHON_PORT;
  for (let port = start; port < start + 100; port++) {
    if (!isPortInUse(port)) {
      return port;
    }
  }
  console.warn(`[MomoiConfig] 端口 ${start}-${start + 99} 全部被占用！回退到 ${MOMOI_PYTHON_PORT}`);
  return MOMOI_PYTHON_PORT;
}

/**
 * 杀掉占用端口的进程。
 */
export function killPort(port: number): boolean {
  try {
    const pids = execSync(`lsof -ti :${port}`, { encoding: "utf-8" }).trim();
    if (pids) {
      for (const pid of pids.split("\n")) {
        try {
          execSync(`kill -9 ${pid}`);
        } catch { /* 忽略单个进程杀失败 */ }
      }
      return true;
    }
  } catch { /* 端口空闲或 lsof 不可用 */ }
  return false;
}
