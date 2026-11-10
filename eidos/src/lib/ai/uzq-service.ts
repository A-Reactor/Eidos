// ============================================================
// UZQ · 在线人格推演服务
// ============================================================
// 这里才连接真实 AI 客户端。纯协议层在 uzq-personality.ts，避免客户端组件
// 因为调试面板展示 shadow plan 而把 AI 调用实现打进浏览器包。

import { callDeepSeek } from "./client";
import { UzqReviewScheduler } from "./uzq-scheduler";
import {
  runUzqPersonalityReview,
  type UzqCaller,
  type UzqInputBundle,
  type UzqPersonalityReviewResult,
} from "./uzq-personality";

export interface RunOnlineUzqOptions {
  settingsOverride?: Record<string, string> | null;
  timeoutMs?: number;
  fallbackToShadow?: boolean;
}

export function createUzqDeepSeekCaller(
  options: RunOnlineUzqOptions = {},
): UzqCaller {
  return async ({ systemPrompt, userPrompt, temperature, maxTokens, callType }) => {
    const result = await callDeepSeek(
      systemPrompt,
      userPrompt,
      temperature,
      maxTokens,
      true,
      options.timeoutMs ?? 30_000,
      "uzq",
      options.settingsOverride,
      undefined,
      callType,
    );

    return {
      content: result.content,
      usage: result.usage,
      elapsedMs: result.elapsedMs,
    };
  };
}

export function runOnlineUzqPersonalityReview(
  bundle: UzqInputBundle,
  options: RunOnlineUzqOptions = {},
): Promise<UzqPersonalityReviewResult> {
  return runUzqPersonalityReview(bundle, {
    caller: createUzqDeepSeekCaller(options),
    fallbackToShadow: options.fallbackToShadow,
  });
}

export const uzqReviewScheduler =
  new UzqReviewScheduler<RunOnlineUzqOptions>({
    runner: runOnlineUzqPersonalityReview,
    minDelayMs: 1000,
    maxQueueSize: 6,
  });

export function enqueueOnlineUzqPersonalityReview(
  bundle: UzqInputBundle,
  options: RunOnlineUzqOptions = {},
): Promise<UzqPersonalityReviewResult> {
  return uzqReviewScheduler.enqueue(bundle, { runOptions: options });
}
