// ============================================================
// Eidos · MOMOI HTTP 客户端 — 与 Python 语音服务器通信
// ============================================================
// 单例模式，所有 API 路由共享同一实例。
// 通信模式：HTTP REST → Python Flask server
//
// 超时设计：
//   - synthesize: 60s
//   - healthCheck: 5s
// ============================================================

import { getMomoiBaseUrl } from "./config";
import type {
  MomoiSynthesizeRequest,
  MomoiSynthesizeResponse,
  MomoiStatusResponse,
} from "./types";

// ============================================================
// MomoiClient
// ============================================================

export class MomoiClient {
  /** 每次调用时动态读取端口，支持 start 端点换端口 */
  private get baseUrl(): string {
    return getMomoiBaseUrl();
  }

  // ============================================================
  // 健康检查
  // ============================================================

  /**
   * 检查 Python 语音服务器状态。
   *
   * @returns status: ready | loading_model | error
   * @throws 服务器不可达时抛出
   */
  async healthCheck(): Promise<MomoiStatusResponse> {
    const response = await fetch(`${this.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`MOMOI health check failed: ${response.status}`);
    }

    return response.json();
  }

  // ============================================================
  // 语音合成
  // ============================================================

  /**
   * 合成语音（文本 → 音频）。
   *
   * @param req — 合成请求（text, speaker, worldId 等）
   * @returns 合成响应（base64 WAV + 元数据）
   */
  async synthesize(
    req: MomoiSynthesizeRequest,
    signal?: AbortSignal,
  ): Promise<MomoiSynthesizeResponse> {
    const effectiveSignal = signal ?? AbortSignal.timeout(60000);

    const response = await fetch(`${this.baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: effectiveSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = (errorData as any).error ?? `HTTP ${response.status}`;
      throw new Error(`MOMOI synthesis failed: ${message}`);
    }

    return response.json();
  }
}

// ============================================================
// 全局单例
// ============================================================

export const momoiClient = new MomoiClient();
