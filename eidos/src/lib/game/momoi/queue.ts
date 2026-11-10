// ============================================================
// Eidos · MOMOI TTS 队列 — 单线程 FIFO
// ============================================================
// MLX 不支持同一模型并发推理，TTS 请求必须串行执行。
// 队列确保同一时间只有一个合成任务在运行。
//
// 队列行为：
//   - 最多排队 10 个任务，超出丢弃最旧的
//   - Promise 驱动：任务入队后返回 Promise，完成时 resolve
//   - 65s 总超时（fetch 层 60s + 5s 缓冲）
//   - 连续超时追踪：检测 MLX 系统性 hang
// ============================================================

import { momoiClient } from "./client";
import type {
  MomoiSynthesizeRequest,
  MomoiSynthesizeResponse,
  TtsJob,
} from "./types";

const MAX_QUEUE_SIZE = 20;
const JOB_TIMEOUT_MS = 65000;

// ============================================================
// 诊断数据结构
// ============================================================

export interface FailureRecord {
  timestamp: number;
  speaker: string;
  textPreview: string;
  textLen: number;
  error: string;
  /** 本次合成各阶段耗时 (ms) */
  phases: {
    queueWait: number;   // 入队到开始处理的等待
    synthesize: number;  // fetch 到 Python 的耗时（超时则为超时值）
    total: number;       // 入队到失败的耗时
  };
}

export interface QueueDiagnostics {
  consecutiveTimeouts: number;
  totalSucceeded: number;
  totalFailed: number;
  recentFailures: FailureRecord[];
  isLikelyHung: boolean;
  suggestion: string | null;
}

// ============================================================
// MomoiQueue
// ============================================================

export class MomoiQueue {
  private queue: TtsJob[] = [];
  private processing = false;

  // 诊断追踪
  private consecutiveTimeouts = 0;
  private totalSucceeded = 0;
  private totalFailed = 0;
  private recentFailures: FailureRecord[] = [];
  private readonly MAX_FAILURE_RECORDS = 10;

  /**
   * 入队一个 TTS 合成任务。返回 Promise，任务完成时 resolve。
   */
  async enqueue(
    request: MomoiSynthesizeRequest,
    signal?: AbortSignal,
  ): Promise<MomoiSynthesizeResponse> {
    const id = crypto.randomUUID();
    const enqueuedAt = Date.now();

    // 队列满 → 丢弃最旧的 queued 任务
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const oldestIdx = this.queue.findIndex((j) => j.status === "queued");
      if (oldestIdx >= 0) {
        const removed = this.queue.splice(oldestIdx, 1)[0];
        removed._reject?.(new Error("队列满，任务被丢弃"));
        console.log(`[MomoiQueue] 队列满，丢弃旧任务: ${removed.id}`);
      }
    }

    // 创建 Promise 等待任务完成
    const promise = new Promise<MomoiSynthesizeResponse>((resolve, reject) => {
      const job: TtsJob = {
        id,
        request,
        status: "queued",
        createdAt: enqueuedAt,
        _resolve: resolve,
        _reject: reject,
      };

      // 超时定时器
      const timeout = setTimeout(() => {
        if (job.status === "queued" || job.status === "processing") {
          job.status = "failed";
          job.error = "TTS 任务超时";
          reject(new Error(`MOMOI TTS job ${id} timed out after ${JOB_TIMEOUT_MS}ms`));
        }
      }, JOB_TIMEOUT_MS);

      // 包装 resolve/reject 以清除超时
      const origResolve = resolve;
      const origReject = reject;
      job._resolve = (result: MomoiSynthesizeResponse) => {
        clearTimeout(timeout);
        origResolve(result);
      };
      job._reject = (err: Error) => {
        clearTimeout(timeout);
        origReject(err);
      };

      // AbortSignal: 客户端断开时取消任务
      if (signal) {
        if (signal.aborted) {
          job.status = "failed";
          job.error = "客户端已断开";
          job._reject(new Error("客户端已断开"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            if (job.status === "queued" || job.status === "processing") {
              job.status = "failed";
              job.error = "客户端已断开";
              job._reject?.(new Error("客户端已断开"));
            }
          },
          { once: true },
        );
      }

      this.queue.push(job);
    });

    // 立即触发处理
    if (!this.processing) {
      this.processNext();
    }

    return promise;
  }

  /**
   * 处理队列中的下一个任务。
   */
  private async processNext(): Promise<void> {
    const job = this.queue.find((j) => j.status === "queued");
    if (!job) {
      this.processing = false;
      return;
    }

    this.processing = true;
    job.status = "processing";

    const queueWait = Date.now() - job.createdAt;
    const synthStart = Date.now();

    try {
      const result = await momoiClient.synthesize(job.request);
      const synthMs = Date.now() - synthStart;

      job.result = result;
      job.status = "done";
      job._resolve?.(result);

      // 成功 → 重置连续超时计数
      this.consecutiveTimeouts = 0;
      this.totalSucceeded++;
      console.log(
        `[MomoiQueue] ✅ TTS 完成 (排队 ${queueWait}ms + 合成 ${synthMs}ms = ${queueWait + synthMs}ms)`,
      );
    } catch (err) {
      const synthMs = Date.now() - synthStart;
      const totalMs = Date.now() - job.createdAt;
      const errMsg = (err as Error).message;

      job.status = "failed";
      job.error = errMsg;
      job._reject?.(err as Error);

      this.totalFailed++;

      // 判断是否为超时类错误
      const isTimeout =
        errMsg.includes("aborted") ||
        errMsg.includes("timeout") ||
        errMsg.includes("超时");

      if (isTimeout) {
        this.consecutiveTimeouts++;
      }

      // 记录失败详情
      this.recentFailures.unshift({
        timestamp: Date.now(),
        speaker: job.request.speaker || "(无)",
        textPreview: job.request.text.slice(0, 40),
        textLen: job.request.text.length,
        error: errMsg,
        phases: { queueWait, synthesize: synthMs, total: totalMs },
      });
      if (this.recentFailures.length > this.MAX_FAILURE_RECORDS) {
        this.recentFailures.length = this.MAX_FAILURE_RECORDS;
      }

      const tag = isTimeout ? "⏱️ 超时" : "❌ 错误";
      console.error(
        `[MomoiQueue] ${tag} job=${job.id} speaker="${job.request.speaker}" ` +
        `排队${queueWait}ms 合成${synthMs}ms (连续超时: ${this.consecutiveTimeouts})`,
      );
    }

    // 递归处理下一个（catch 防止未处理 rejection 污染日志）
    this.processNext().catch(() => {});
  }

  /**
   * 取消所有排队任务。
   */
  cancelAll(): void {
    for (const job of this.queue) {
      if (job.status === "queued") {
        job.status = "failed";
        job.error = "已取消（引擎停止）";
        job._reject?.(new Error("已取消（引擎停止）"));
      }
    }
    this.queue = [];
    this.processing = false;
    this.consecutiveTimeouts = 0;
    console.log("[MomoiQueue] 所有排队任务已取消");
  }

  /**
   * 获取队列状态。
   */
  getStatus(): { queued: number; processing: boolean; total: number } {
    const queued = this.queue.filter((j) => j.status === "queued").length;
    const processing = this.queue.some((j) => j.status === "processing");
    return { queued, processing, total: this.queue.length };
  }

  /**
   * 获取诊断信息：连续超时、失败模式、恢复建议。
   */
  getDiagnostics(): QueueDiagnostics {
    const isLikelyHung = this.consecutiveTimeouts >= 3;

    let suggestion: string | null = null;
    if (isLikelyHung) {
      suggestion =
        `连续 ${this.consecutiveTimeouts} 次合成超时 — Python model.generate() 可能被 MLX MPS 死锁。` +
        `建议：重启 Python 进程（POST /api/momoi/stop 再 /api/momoi/start）。`;
    } else if (this.consecutiveTimeouts >= 1) {
      suggestion =
        `最近 ${this.consecutiveTimeouts} 次超时 — 如果持续增加，Python MLX 推理可能不稳定。`;
    }

    return {
      consecutiveTimeouts: this.consecutiveTimeouts,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
      recentFailures: this.recentFailures.slice(0, 5),
      isLikelyHung,
      suggestion,
    };
  }
}

// ============================================================
// 全局单例
// ============================================================

export const ttsQueue = new MomoiQueue();
