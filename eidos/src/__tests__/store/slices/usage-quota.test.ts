// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { useGameStore } from '@/store/game-store';
import { createModelAnalytics, MODEL_ANALYTICS_STORAGE_KEY } from '@/lib/game/model-analytics';
import { _resetDB } from '@/lib/game/storage';
import { createUsageLedger } from '@/lib/game/usage-ledger';

it('migrates existing usage and persists new calls when localStorage is full', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  _resetDB();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    localStorage.setItem('eidos_token_usage', JSON.stringify({ tokensUsed: 700, tokenDetail: { alicePrompt: 700 } }));
    localStorage.setItem(MODEL_ANALYTICS_STORAGE_KEY, JSON.stringify({ version: 1, total: { ...createModelAnalytics(), totalCalls: 1, totalTokens: 700 }, worlds: {} }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    const store = useGameStore.getState();
    store.addTokenUsage({ model: 'alice', promptTokens: 100, completionTokens: 20, totalTokens: 120,
      worldId: 'new-world', callType: 'alice_action', elapsedMs: 20 });
    await Promise.all([store.loadPersistedTokens(), store.hydrateModelAnalytics()]);
    useGameStore.setState(useGameStore.getInitialState());
    await Promise.all([store.loadPersistedTokens(), store.hydrateModelAnalytics()]);
    expect(useGameStore.getState().tokensUsed).toBe(820);
    expect(useGameStore.getState().worldTokenUsage['new-world']?.tokensUsed).toBe(120);
    expect(useGameStore.getState().modelAnalytics?.total.totalCalls).toBe(2);
    expect(useGameStore.getState().modelAnalytics?.worlds['new-world']?.totalTokens).toBe(120);
    expect(localStorage.getItem('eidos_token_usage')).toBeNull();
    expect(localStorage.getItem(MODEL_ANALYTICS_STORAGE_KEY)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    _resetDB();
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});

it('retains legacy data on an aborted write and applies overlapping updates once', async () => {
  const key = 'usage-test-counter';
  localStorage.setItem(key, '5');
  const parse = (value: unknown) => typeof value === 'number' ? value : null;
  const first = vi.fn();
  const writer = createUsageLedger(key, parse, first);
  const other = createUsageLedger(key, parse, vi.fn());
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('write unavailable'); });
  try {
    await writer.sync(0, value => value + 2);
    expect(localStorage.getItem(key)).toBe('5');
    expect(warning).toHaveBeenCalledOnce();
    put.mockRestore();
    await Promise.all([writer.sync(0), other.sync(0, value => value + 3)]);
    await writer.sync(0);
    expect(first).toHaveBeenLastCalledWith(10);
    expect(localStorage.getItem(key)).toBeNull();
  } finally {
    vi.restoreAllMocks();
    localStorage.removeItem(key);
  }
});
