// ============================================================
// UZQ 调度器测试
// ============================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUzqBundleFingerprint,
  UzqReviewScheduler,
} from "@/lib/ai/uzq-scheduler";
import type {
  UzqInputBundle,
  UzqPersonalityReviewResult,
} from "@/lib/ai/uzq-personality";

function makeBundle(playerInput: string): UzqInputBundle {
  return {
    actor: "UZQ",
    version: 1,
    playerInput,
    worldLineSummary: {
      currentNodeId: "node-1",
      stepNumber: 1,
      depth: 1,
      branchCount: 0,
      backtrackableNodes: [],
      siblingBranches: [],
    },
    npcs: [],
    policy: {
      outputMode: "delta_only",
      forbiddenActions: ["不得输出玩家可见叙事"],
      keiReviewRequiredWhen: ["准备权限申请"],
    },
  };
}

function makeResult(label: string): UzqPersonalityReviewResult {
  return {
    source: "shadow",
    plan: {
      actor: "UZQ",
      mode: "shadow",
      generatedAt: label.length,
      npcPlans: [],
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createUzqBundleFingerprint", () => {
  it("returns a stable key for equivalent bundles and changes when the input changes", () => {
    expect(createUzqBundleFingerprint(makeBundle("验证边界"))).toBe(
      createUzqBundleFingerprint(makeBundle("验证边界")),
    );
    expect(createUzqBundleFingerprint(makeBundle("验证边界"))).not.toBe(
      createUzqBundleFingerprint(makeBundle("换一个问题")),
    );
  });
});

describe("UzqReviewScheduler", () => {
  it("deduplicates identical pending reviews and shares the same promise", async () => {
    const bundle = makeBundle("你能验证边界吗？");
    const result = makeResult("deduped");
    let resolveRunner!: (value: UzqPersonalityReviewResult) => void;
    const runner = vi.fn(
      () =>
        new Promise<UzqPersonalityReviewResult>((resolve) => {
          resolveRunner = resolve;
        }),
    );
    const scheduler = new UzqReviewScheduler({
      runner,
      minDelayMs: 0,
    });

    const first = scheduler.enqueue(bundle);
    const second = scheduler.enqueue(bundle);

    expect(second).toBe(first);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus().metrics.deduped).toBe(1);

    resolveRunner(result);
    await expect(second).resolves.toBe(result);
  });

  it("serializes calls and waits for the configured throttle interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const startTimes: number[] = [];
    const runner = vi.fn(async (bundle: UzqInputBundle) => {
      startTimes.push(Date.now());
      return makeResult(bundle.playerInput);
    });
    const scheduler = new UzqReviewScheduler({
      runner,
      minDelayMs: 1000,
    });

    await scheduler.enqueue(makeBundle("first"));
    vi.setSystemTime(100);

    const second = scheduler.enqueue(makeBundle("second"));

    await vi.advanceTimersByTimeAsync(899);
    expect(runner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toEqual(makeResult("second"));
    expect(startTimes).toEqual([0, 1000]);
  });

  it("drops the oldest queued review when the queue is full", async () => {
    const firstResult = makeResult("first");
    const thirdResult = makeResult("third");
    let resolveFirst!: (value: UzqPersonalityReviewResult) => void;
    const runner = vi.fn((bundle: UzqInputBundle) => {
      if (bundle.playerInput === "first") {
        return new Promise<UzqPersonalityReviewResult>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(thirdResult);
    });
    const scheduler = new UzqReviewScheduler({
      runner,
      maxQueueSize: 1,
      minDelayMs: 0,
    });

    const first = scheduler.enqueue(makeBundle("first"));
    const dropped = scheduler
      .enqueue(makeBundle("second"))
      .catch((error: Error) => error.message);
    const retained = scheduler.enqueue(makeBundle("third"));

    expect(scheduler.getStatus().queued).toBe(1);
    await expect(dropped).resolves.toContain("UZQ queue full");

    resolveFirst(firstResult);
    await expect(first).resolves.toBe(firstResult);
    await expect(retained).resolves.toBe(thirdResult);
    expect(scheduler.getStatus().metrics.dropped).toBe(1);
  });
});
