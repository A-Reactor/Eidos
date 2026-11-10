// ============================================================
// Eidos · Token 追踪 Slice
// ============================================================

import type { InputContextUsage, TokenUsage } from "@/lib/ai/types";
import { createUsageLedger } from '@/lib/game/usage-ledger';

export interface TokenSlice {
  worldAliceContext: Record<string, InputContextUsage>;
  setAliceContextUsage: (usage: TokenUsage, worldId?: string | null) => void;
  worldTokenUsage: Record<string, TokenTotals>;
  tokensUsed: number;
  estimatedCost: number;
  tokenDetail: {
    alicePrompt: number;
    aliceCompletion: number;
    aliceCached: number;
    keiPrompt: number;
    keiCompletion: number;
    keiCached: number;
    uzqPrompt: number;
    uzqCompletion: number;
    uzqCached: number;
  };
  loadPersistedTokens: () => Promise<void>;
  addTokenUsage: (usage: TokenUsage, worldId?: string | null) => void;
}

export interface TokenTotals { tokensUsed: number; estimatedCost: number; tokenDetail: TokenSlice["tokenDetail"] }
export const EMPTY_TOKEN_TOTALS: TokenTotals = { tokensUsed: 0, estimatedCost: 0, tokenDetail: createEmptyTokenDetail() };
type TokenLedger = TokenTotals & Pick<TokenSlice, 'worldTokenUsage' | 'worldAliceContext'>;
const emptyLedger: TokenLedger = { ...EMPTY_TOKEN_TOTALS, worldTokenUsage: {}, worldAliceContext: {} };

function tokenLedger(state: Partial<TokenLedger>): TokenLedger {
  return { tokensUsed: finiteOrZero(state.tokensUsed), estimatedCost: finiteOrZero(state.estimatedCost),
    tokenDetail: normalizeTokenDetail(state.tokenDetail), worldTokenUsage: state.worldTokenUsage ?? {},
    worldAliceContext: state.worldAliceContext ?? {} };
}

function parseTokenLedger(value: unknown): TokenLedger | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ledger = tokenLedger(value);
  return { ...ledger,
    worldTokenUsage: Object.fromEntries(Object.entries(ledger.worldTokenUsage).map(([id, entry]) => [id, {
      tokensUsed: finiteOrZero(entry?.tokensUsed), estimatedCost: finiteOrZero(entry?.estimatedCost), tokenDetail: normalizeTokenDetail(entry?.tokenDetail),
    }])),
    worldAliceContext: Object.fromEntries(Object.entries(ledger.worldAliceContext).flatMap(([id, value]) => {
      const context = normalizeInputContext(value);
      return context ? [[id, context]] : [];
    })),
  };
}

export const createTokenSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): TokenSlice => {
  const ledger = createUsageLedger('eidos_token_usage', parseTokenLedger, value => set(value));
  const update = (change: (current: TokenLedger) => TokenLedger) => set(s => {
    void ledger.sync(emptyLedger, change);
    return change(tokenLedger(s));
  });
  return ({
  worldAliceContext: {},
  setAliceContextUsage: (usage, worldId = usage.worldId === undefined ? get().currentWorld?.id : usage.worldId) => {
    const context = normalizeInputContext(usage.inputContext);
    if (usage.model !== 'alice' || !worldId || !context) return;
    // Foreground actions opt in here; background ALICE calls only update the cumulative ledger.
    update(s => ({ ...s, worldAliceContext: { ...s.worldAliceContext, [worldId]: context } }));
  },
  worldTokenUsage: {},
  tokensUsed: 0,
  estimatedCost: 0,
  tokenDetail: createEmptyTokenDetail(),

  loadPersistedTokens: async () => {
    if (typeof window === 'undefined') return;
    if (typeof indexedDB === 'undefined') {
      const legacy = ledger.legacy();
      if (legacy) set(legacy);
    }
    await ledger.sync(emptyLedger);
  },

  addTokenUsage: (usage, worldId = usage.worldId === undefined ? get().currentWorld?.id : usage.worldId) => {
    // 防御 NaN：所有值取 0 兜底
    const pt = Number.isFinite(usage.promptTokens) ? usage.promptTokens : 0;
    const ct = Number.isFinite(usage.completionTokens) ? usage.completionTokens : 0;
    const tt = Number.isFinite(usage.totalTokens) ? usage.totalTokens : 0;
    const cached = Number.isFinite(usage.cachedTokens as number) ? (usage.cachedTokens as number) : 0;

    update(s => {
      const total = accumulateUsage({ tokensUsed: s.tokensUsed, estimatedCost: s.estimatedCost, tokenDetail: s.tokenDetail }, usage, pt, ct, tt, cached);
      const worldTokenUsage = { ...s.worldTokenUsage };
      if (worldId) worldTokenUsage[worldId] = accumulateUsage(worldTokenUsage[worldId] ?? EMPTY_TOKEN_TOTALS, usage, pt, ct, tt, cached);
      return { ...s, ...total, worldTokenUsage };
    });

    // 遥测：当 TokenUsage 带有 callType 时自动记录 AI 调用
    if (usage.callType && usage.elapsedMs != null) {
      const store = get();
      if (typeof store.recordAiCall === "function") {
        store.recordAiCall({
          worldId: worldId ?? null,
          uncachedPromptTokens: usage.uncachedPromptTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          cacheUsageReported: usage.cacheUsageReported,
          providerId: usage.providerId,
          modelId: usage.modelId,
          firstTokenMs: usage.firstTokenMs,
          finishReason: usage.finishReason,
          reasoningTokens: usage.reasoningTokens,
          outputChars: usage.outputChars,
          errorCode: usage.errorCode,
          usageEstimated: usage.usageEstimated,
          timestamp: Date.now(),
          callType: usage.callType as any,
          model: usage.model,
          promptTokens: pt,
          completionTokens: ct,
          cachedTokens: cached,
          totalTokens: tt,
          elapsedMs: usage.elapsedMs,
          success: usage.success !== false,
        });
      }
    }
  },
  });
};

function normalizeInputContext(value: unknown): InputContextUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const context = value as InputContextUsage;
  if (typeof context.modelId !== 'string' || !context.modelId.trim() || typeof context.providerId !== 'string' ||
    !Number.isFinite(context.inputTokens) || context.inputTokens < 0) return undefined;
  return { modelId: context.modelId, providerId: context.providerId, inputTokens: Math.round(context.inputTokens),
    windowTokens: typeof context.windowTokens === 'number' && Number.isFinite(context.windowTokens) && context.windowTokens > 0 ? Math.round(context.windowTokens) : undefined,
    estimated: context.estimated === true };
}

function createEmptyTokenDetail(): TokenSlice["tokenDetail"] {
  return {
    alicePrompt: 0,
    aliceCompletion: 0,
    aliceCached: 0,
    keiPrompt: 0,
    keiCompletion: 0,
    keiCached: 0,
    uzqPrompt: 0,
    uzqCompletion: 0,
    uzqCached: 0,
  };
}

function normalizeTokenDetail(
  detail: Partial<TokenSlice["tokenDetail"]> | undefined,
): TokenSlice["tokenDetail"] {
  const base = createEmptyTokenDetail();
  if (!detail) return base;

  return {
    alicePrompt: finiteOrZero(detail.alicePrompt),
    aliceCompletion: finiteOrZero(detail.aliceCompletion),
    aliceCached: finiteOrZero(detail.aliceCached),
    keiPrompt: finiteOrZero(detail.keiPrompt),
    keiCompletion: finiteOrZero(detail.keiCompletion),
    keiCached: finiteOrZero(detail.keiCached),
    uzqPrompt: finiteOrZero(detail.uzqPrompt),
    uzqCompletion: finiteOrZero(detail.uzqCompletion),
    uzqCached: finiteOrZero(detail.uzqCached),
  };
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function accumulateUsage(previous: TokenTotals, usage: TokenUsage, pt: number, ct: number, tt: number, cached: number): TokenTotals {
  const d = normalizeTokenDetail(previous.tokenDetail);
  if (usage.model === "alice") {
    d.alicePrompt += pt;
    d.aliceCompletion += ct;
    d.aliceCached += cached;
  } else if (usage.model === "kei") {
    d.keiPrompt += pt;
    d.keiCompletion += ct;
    d.keiCached += cached;
  } else {
    d.uzqPrompt += pt;
    d.uzqCompletion += ct;
    d.uzqCached += cached;
  }
  const aliceMiss = d.alicePrompt - d.aliceCached;
  const keiMiss = d.keiPrompt - d.keiCached;
  const uzqMiss = d.uzqPrompt - d.uzqCached;
  const cost =
    (d.aliceCached / 1_000_000) * 0.02 +
    (aliceMiss / 1_000_000) * 1 +
    (d.aliceCompletion / 1_000_000) * 2 +
    (d.keiCached / 1_000_000) * 0.025 +
    (keiMiss / 1_000_000) * 3 +
    (d.keiCompletion / 1_000_000) * 6 +
    (d.uzqCached / 1_000_000) * 0.025 +
    (uzqMiss / 1_000_000) * 3 +
    (d.uzqCompletion / 1_000_000) * 6;

  return { tokensUsed: finiteOrZero(previous.tokensUsed) + tt, estimatedCost: Math.round(cost * 10000) / 10000, tokenDetail: d };
}
