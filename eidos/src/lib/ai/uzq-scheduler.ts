// ============================================================
// UZQ · 人格推演调度器
// ============================================================
// 只负责请求治理：去重、串行、节流。真实 AI 调用由 uzq-service.ts 注入，
// 避免该模块把服务端 client 或浏览器 UI 绑在一起。

import type {
  UzqInputBundle,
  UzqPersonalityReviewResult,
} from "./uzq-personality";

export type UzqReviewRunner<TOptions = unknown> = (
  bundle: UzqInputBundle,
  options?: TOptions,
) => Promise<UzqPersonalityReviewResult>;

export interface UzqEnqueueOptions<TOptions = unknown> {
  key?: string;
  runOptions?: TOptions;
}

export interface UzqReviewSchedulerOptions<TOptions = unknown> {
  runner: UzqReviewRunner<TOptions>;
  minDelayMs?: number;
  maxQueueSize?: number;
  keyForBundle?: (bundle: UzqInputBundle) => string;
}

export interface UzqReviewSchedulerMetrics {
  submitted: number;
  deduped: number;
  dropped: number;
  succeeded: number;
  failed: number;
  cancelled: number;
}

export interface UzqReviewSchedulerStatus {
  queued: number;
  processing: boolean;
  active: number;
  minDelayMs: number;
  maxQueueSize: number;
  lastStartedAt: number | null;
  metrics: UzqReviewSchedulerMetrics;
}

interface QueuedUzqReview<TOptions> {
  id: number;
  key: string;
  bundle: UzqInputBundle;
  runOptions?: TOptions;
  createdAt: number;
  promise: Promise<UzqPersonalityReviewResult>;
  resolve: (value: UzqPersonalityReviewResult) => void;
  reject: (reason: Error) => void;
}

const DEFAULT_MAX_QUEUE_SIZE = 6;

export class UzqReviewScheduler<TOptions = unknown> {
  private readonly runner: UzqReviewRunner<TOptions>;
  private readonly minDelayMs: number;
  private readonly maxQueueSize: number;
  private readonly keyForBundle: (bundle: UzqInputBundle) => string;
  private readonly queue: QueuedUzqReview<TOptions>[] = [];
  private readonly queuedByKey = new Map<string, QueuedUzqReview<TOptions>>();
  private readonly activeByKey = new Map<
    string,
    Promise<UzqPersonalityReviewResult>
  >();
  private processing = false;
  private lastStartedAt: number | null = null;
  private nextId = 0;

  private readonly metrics: UzqReviewSchedulerMetrics = {
    submitted: 0,
    deduped: 0,
    dropped: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };

  constructor(options: UzqReviewSchedulerOptions<TOptions>) {
    this.runner = options.runner;
    this.minDelayMs = Math.max(0, options.minDelayMs ?? 0);
    this.maxQueueSize = Math.max(
      1,
      options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
    );
    this.keyForBundle = options.keyForBundle ?? createUzqBundleFingerprint;
  }

  enqueue(
    bundle: UzqInputBundle,
    options: UzqEnqueueOptions<TOptions> = {},
  ): Promise<UzqPersonalityReviewResult> {
    const key = options.key ?? this.keyForBundle(bundle);
    const active = this.activeByKey.get(key);
    if (active) {
      this.metrics.deduped++;
      return active;
    }

    const queued = this.queuedByKey.get(key);
    if (queued) {
      this.metrics.deduped++;
      return queued.promise;
    }

    this.dropOldestIfNeeded();

    let resolveJob!: (value: UzqPersonalityReviewResult) => void;
    let rejectJob!: (reason: Error) => void;
    const promise = new Promise<UzqPersonalityReviewResult>(
      (resolve, reject) => {
        resolveJob = resolve;
        rejectJob = reject;
      },
    );
    const job: QueuedUzqReview<TOptions> = {
      id: ++this.nextId,
      key,
      bundle,
      runOptions: options.runOptions,
      createdAt: Date.now(),
      promise,
      resolve: resolveJob,
      reject: rejectJob,
    };

    this.queue.push(job);
    this.queuedByKey.set(key, job);
    this.metrics.submitted++;
    this.processNext().catch(() => {});

    return promise;
  }

  getStatus(): UzqReviewSchedulerStatus {
    return {
      queued: this.queue.length,
      processing: this.processing,
      active: this.activeByKey.size,
      minDelayMs: this.minDelayMs,
      maxQueueSize: this.maxQueueSize,
      lastStartedAt: this.lastStartedAt,
      metrics: { ...this.metrics },
    };
  }

  cancelQueued(reason = "UZQ queued reviews cancelled"): void {
    for (const job of this.queue) {
      job.reject(new Error(reason));
    }
    this.metrics.cancelled += this.queue.length;
    this.queue.length = 0;
    this.queuedByKey.clear();
  }

  private dropOldestIfNeeded(): void {
    if (this.queue.length < this.maxQueueSize) return;

    const dropped = this.queue.shift();
    if (!dropped) return;

    this.queuedByKey.delete(dropped.key);
    this.metrics.dropped++;
    dropped.reject(new Error("UZQ queue full; dropped oldest pending review"));
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;

    const job = this.queue.shift();
    if (!job) return;

    this.processing = true;
    this.queuedByKey.delete(job.key);
    this.activeByKey.set(job.key, job.promise);

    try {
      const delayMs = this.computeThrottleDelay();
      if (delayMs > 0) {
        await wait(delayMs);
      }

      this.lastStartedAt = Date.now();
      const result = await this.runner(job.bundle, job.runOptions);
      this.metrics.succeeded++;
      job.resolve(result);
    } catch (error) {
      this.metrics.failed++;
      job.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeByKey.delete(job.key);
      this.processing = false;
      if (this.queue.length > 0) {
        this.processNext().catch(() => {});
      }
    }
  }

  private computeThrottleDelay(): number {
    if (this.lastStartedAt === null) return 0;
    return Math.max(0, this.lastStartedAt + this.minDelayMs - Date.now());
  }
}

export function createUzqBundleFingerprint(bundle: UzqInputBundle): string {
  return stableStringify({
    playerInput: bundle.playerInput.trim(),
    worldLineSummary: bundle.worldLineSummary
      ? {
          currentNodeId: bundle.worldLineSummary.currentNodeId,
          stepNumber: bundle.worldLineSummary.stepNumber,
          depth: bundle.worldLineSummary.depth,
          branchCount: bundle.worldLineSummary.branchCount,
        }
      : null,
    observations: bundle.observations,
    npcs: bundle.npcs.map((npc) => ({
      npcId: npc.npcId,
      awareness: npc.awareness,
      fourthWallReadiness: npc.fourthWallReadiness.score,
      recentMemories: npc.recentMemories,
      anomalousEvidence: npc.anomalousEvidence,
      beliefSnapshot: npc.beliefSnapshot,
      observationHints: npc.observationHints,
    })),
    policy: bundle.policy,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortStable(item));
  }

  if (!isRecord(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const item = value[key];
      if (item !== undefined) {
        acc[key] = sortStable(item);
      }
      return acc;
    }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
