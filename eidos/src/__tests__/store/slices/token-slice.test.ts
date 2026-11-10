// ============================================================
// Eidos · Token Slice 测试
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenSlice, type TokenSlice } from "@/store/slices/token-slice";
import { loadMeta } from '@/lib/game/storage';

// 模拟 window（代码中有 typeof window !== "undefined" 守卫）
vi.stubGlobal("window", {});

// 模拟 localStorage
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
});

// Zustand StateCreator 需要的最小 mock
// 关键：初始化 mock state 时必须包含 slice 的默认字段，
// 因为 createTokenSlice 返回的初始值在真实 Zustand 中会被 merge 进 store，
// 但在测试中 set/get 只操作 mock 内部的 state 对象
type MockSet = (fn: (state: any) => any) => void;
type MockGet = () => any;

const DEFAULT_TOKEN_STATE = {
  tokensUsed: 0,
  estimatedCost: 0,
  tokenDetail: {
    alicePrompt: 0,
    aliceCompletion: 0,
    aliceCached: 0,
    keiPrompt: 0,
    keiCompletion: 0,
    keiCached: 0,
    uzqPrompt: 0,
    uzqCompletion: 0,
    uzqCached: 0,
  },
};

function createMockStore(initial: Record<string, unknown> = {}) {
  const state = { ...DEFAULT_TOKEN_STATE, ...initial };
  const set: MockSet = (fn) => {
    if (typeof fn === "function") {
      Object.assign(state, fn(state));
    } else {
      Object.assign(state, fn);
    }
  };
  const get: MockGet = () => state;
  return { set, get };
}

const testSlices: TokenSlice[] = [];
function createTestSlice(initialState?: Record<string, unknown>) {
  const { set, get } = createMockStore(initialState);
  // createTokenSlice 返回 state + actions，但不会主动调用 set
  // 所以需要 mock store 预先包含默认 state
  const slice = createTokenSlice(set as any, get as any, null as any);
  testSlices.push(slice);
  return { slice, get };
}

beforeEach(() => {
  storage.clear();
});
afterEach(async () => { await Promise.all(testSlices.splice(0).map(slice => slice.loadPersistedTokens())); });

describe("createTokenSlice", () => {
  it('exports reasoning and failed-output diagnostics without subtracting real billing', () => {
    const records: unknown[] = [];
    const { slice, get } = createTestSlice({ recordAiCall: (record: unknown) => records.push(record) });
    slice.addTokenUsage({ model: 'alice', promptTokens: 10, completionTokens: 8000, totalTokens: 8010,
      callType: 'alice_stream', elapsedMs: 40000, success: false, finishReason: 'length',
      reasoningTokens: 8000, outputChars: 0, errorCode: 'output_limit' });
    expect(get().tokensUsed).toBe(8010);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ success: false, finishReason: 'length', reasoningTokens: 8000, outputChars: 0, errorCode: 'output_limit' });
  });
  it('tracks context separately per world, persists it, and ignores background or other-role usage', async () => {
    const { slice, get } = createTestSlice({ currentWorld: { id: 'a' } });
    const usage = { model: 'alice' as const, promptTokens: 32000, completionTokens: 1000, totalTokens: 33000,
      inputContext: { modelId: 'gpt-4o-mini', providerId: 'openai', inputTokens: 32000, windowTokens: 128000, estimated: false } };
    slice.setAliceContextUsage(usage);
    slice.addTokenUsage({ ...usage, inputContext: { ...usage.inputContext, inputTokens: 90000 } });
    expect(get().worldAliceContext.a.inputTokens).toBe(32000);
    slice.setAliceContextUsage({ ...usage, model: 'kei' });
    expect(get().worldAliceContext.a.inputTokens).toBe(32000);
    slice.setAliceContextUsage({ ...usage, worldId: 'b', inputContext: { ...usage.inputContext, inputTokens: 10000 } });
    expect(get().worldAliceContext.b.inputTokens).toBe(10000);
    await slice.loadPersistedTokens();
    const reloaded = createTestSlice(); await reloaded.slice.loadPersistedTokens();
    expect(reloaded.get().worldAliceContext).toEqual(get().worldAliceContext);
    expect(get().tokensUsed).toBe(33000);
  });
  it("initializes with zero tokens and cost", () => {
    const { slice } = createTestSlice();

    expect(slice.tokensUsed).toBe(0);
    expect(slice.estimatedCost).toBe(0);
    expect(slice.tokenDetail).toEqual({
      alicePrompt: 0,
      aliceCompletion: 0,
      aliceCached: 0,
      keiPrompt: 0,
      keiCompletion: 0,
      keiCached: 0,
      uzqPrompt: 0,
      uzqCompletion: 0,
      uzqCached: 0,
    });
  });

  it("addTokenUsage tracks ALICE prompt tokens", () => {
    const { slice, get } = createTestSlice();

    slice.addTokenUsage({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 200,
      model: "alice",
    });

    const state = get();
    expect(state.tokenDetail.alicePrompt).toBe(1000);
    expect(state.tokenDetail.aliceCompletion).toBe(500);
    expect(state.tokenDetail.aliceCached).toBe(200);
    expect(state.tokensUsed).toBe(1500);
  });

  it("addTokenUsage tracks KEI tokens", () => {
    const { slice, get } = createTestSlice();

    slice.addTokenUsage({
      promptTokens: 2000,
      completionTokens: 300,
      totalTokens: 2300,
      cachedTokens: 500,
      model: "kei",
    });

    const state = get();
    expect(state.tokenDetail.keiPrompt).toBe(2000);
    expect(state.tokenDetail.keiCompletion).toBe(300);
    expect(state.tokenDetail.keiCached).toBe(500);
    expect(state.tokensUsed).toBe(2300);
  });

  it("addTokenUsage tracks UZQ tokens without mixing them into KEI", () => {
    const { slice, get } = createTestSlice();

    slice.addTokenUsage({
      promptTokens: 1200,
      completionTokens: 400,
      totalTokens: 1600,
      cachedTokens: 300,
      model: "uzq",
    });

    const state = get();
    expect(state.tokenDetail.uzqPrompt).toBe(1200);
    expect(state.tokenDetail.uzqCompletion).toBe(400);
    expect(state.tokenDetail.uzqCached).toBe(300);
    expect(state.tokenDetail.keiPrompt).toBe(0);
    expect(state.tokenDetail.keiCompletion).toBe(0);
    expect(state.tokensUsed).toBe(1600);
  });

  it("addTokenUsage accumulates multiple calls", () => {
    const { slice, get } = createTestSlice();

    slice.addTokenUsage({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      model: "alice",
    });
    slice.addTokenUsage({
      promptTokens: 500,
      completionTokens: 100,
      totalTokens: 600,
      model: "alice",
    });

    const state = get();
    expect(state.tokenDetail.alicePrompt).toBe(1500);
    expect(state.tokenDetail.aliceCompletion).toBe(300);
    expect(state.tokensUsed).toBe(1800);
  });

  it("calculates estimated cost correctly", () => {
    const { slice, get } = createTestSlice();

    // ALICE (Flash): 1000 prompt (200 cached), 500 completion
    slice.addTokenUsage({
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cachedTokens: 200,
      model: "alice",
    });

    // KEI (Pro): 2000 prompt (500 cached), 300 completion
    slice.addTokenUsage({
      promptTokens: 2000,
      completionTokens: 300,
      totalTokens: 2300,
      cachedTokens: 500,
      model: "kei",
    });

    const state = get();
    expect(state.estimatedCost).toBeGreaterThan(0);
    expect(state.estimatedCost).toBeLessThan(0.01);
  });

  it("loadPersistedTokens migrates totals from localStorage", async () => {
    const persisted = {
      tokensUsed: 50000,
      estimatedCost: 0.1234,
      tokenDetail: {
        alicePrompt: 20000,
        aliceCompletion: 8000,
        aliceCached: 3000,
        keiPrompt: 15000,
        keiCompletion: 5000,
        keiCached: 2000,
        uzqPrompt: 2000,
        uzqCompletion: 600,
        uzqCached: 100,
      },
    };
    storage.set("eidos_token_usage", JSON.stringify(persisted));

    const { slice, get } = createTestSlice();
    await slice.loadPersistedTokens();

    const state = get();
    expect(state.tokensUsed).toBe(50000);
    expect(state.estimatedCost).toBe(0.1234);
    expect(state.tokenDetail.alicePrompt).toBe(20000);
    expect(state.tokenDetail.uzqPrompt).toBe(2000);
    expect(storage.has('eidos_token_usage')).toBe(false);
  });

  it("loadPersistedTokens handles missing localStorage gracefully", async () => {
    const { slice, get } = createTestSlice();

    await expect(slice.loadPersistedTokens()).resolves.toBeUndefined();

    const state = get();
    expect(state.tokensUsed).toBe(0);
  });

  it("loadPersistedTokens handles corrupt JSON gracefully", async () => {
    storage.set("eidos_token_usage", "not valid json{{{");

    const { slice, get } = createTestSlice();

    await expect(slice.loadPersistedTokens()).resolves.toBeUndefined();
    // State should remain at defaults
    expect(get().tokensUsed).toBe(0);
  });

  it("persists token state to IndexedDB after addTokenUsage", async () => {
    const { slice } = createTestSlice();

    slice.addTokenUsage({
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      model: "alice",
    });

    await slice.loadPersistedTokens();
    expect(await loadMeta('eidos_token_usage')).toMatchObject({ tokensUsed: 1200 });
  });
});

it('keeps independent world ledgers through persistence and preserves legacy totals without inventing attribution',async()=>{
 storage.set('eidos_token_usage',JSON.stringify({tokensUsed:500,estimatedCost:0,tokenDetail:{}}));
 const {slice,get}=createTestSlice({currentWorld:{id:'a'}});await slice.loadPersistedTokens();
 expect(get().worldTokenUsage).toEqual({});
 const usage={model:'alice' as const,promptTokens:100,completionTokens:50,totalTokens:150};
 slice.addTokenUsage(usage);slice.addTokenUsage(usage,'b');slice.addTokenUsage({...usage,worldId:'a'});
 expect(get().tokensUsed).toBe(950);expect(get().worldTokenUsage.a.tokensUsed).toBe(300);expect(get().worldTokenUsage.b.tokensUsed).toBe(150);
 await slice.loadPersistedTokens();
 const reloaded=createTestSlice();await reloaded.slice.loadPersistedTokens();expect(reloaded.get().worldTokenUsage).toEqual(get().worldTokenUsage);
});

it('keeps actual provider/cache metadata in one telemetry record', () => {
  const recordAiCall = vi.fn(); const { slice } = createTestSlice({ recordAiCall });
  slice.addTokenUsage({ model: 'uzq', promptTokens: 1000, completionTokens: 10, totalTokens: 1010, cachedTokens: 700, cacheWriteTokens: 200, uncachedPromptTokens: 100, cacheUsageReported: true, providerId: 'anthropic', modelId: 'actual-model', firstTokenMs: 20, elapsedMs: 40, callType: 'world_create' });
  expect(recordAiCall).toHaveBeenCalledOnce();
  expect(recordAiCall.mock.calls[0][0]).toMatchObject({ providerId: 'anthropic', modelId: 'actual-model', cachedTokens: 700, cacheWriteTokens: 200, uncachedPromptTokens: 100, firstTokenMs: 20, cacheUsageReported: true });
});

it('marks known billing for a failed stream as a failed telemetry call', () => {
  const recordAiCall = vi.fn(); const { slice } = createTestSlice({ recordAiCall });
  slice.addTokenUsage({ model: 'alice', promptTokens: 1000, completionTokens: 10, totalTokens: 1010, cachedTokens: 700, uncachedPromptTokens: 300, cacheUsageReported: true, elapsedMs: 40, callType: 'alice_stream', success: false });
  expect(recordAiCall).toHaveBeenCalledOnce(); expect(recordAiCall.mock.calls[0][0].success).toBe(false);
});
