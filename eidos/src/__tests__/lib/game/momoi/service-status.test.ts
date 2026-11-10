// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "@/store/game-store";
import { checkVoiceService, startVoiceService, stopVoiceService, trackVoiceGeneration, useVoiceServiceMonitor, voiceStatusLabel } from "@/lib/game/momoi/service-status";

const response = (body: object, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  useGameStore.getState().setVoiceConfig({ provider: "legacy", endpoint: "" });
  useGameStore.setState({ voiceError: null, isVoicePlaying: false, voiceProgress: null, momoiSettings: { enabled: true, autoPlay: true, volume: 1, speed: 1 } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("voice service status", () => {
  it('stops the local model once and ignores readiness from an older health check', async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue(response({ ok: true, status: 'stopped' }));
    vi.stubGlobal('fetch', fetch);
    useGameStore.setState({ momoiStatus: 'ready' });
    const check = checkVoiceService();
    const stop = stopVoiceService();
    expect(stopVoiceService()).toBe(stop);
    await stop;
    finish(response({ status: 'ready' }));
    await check;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('/api/momoi/stop');
    expect(useGameStore.getState().momoiStatus).toBe('offline');
    expect(useGameStore.getState().voiceServiceMessage).toContain('已关闭');
  });
  it('shows shutdown failures and can retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ error: '无法卸载模型' }, false))
      .mockResolvedValueOnce(response({ ok: true, status: 'stopped' })));
    await stopVoiceService();
    expect(useGameStore.getState().voiceServiceMessage).toBe('无法卸载模型');
    await stopVoiceService();
    expect(useGameStore.getState().momoiStatus).toBe('offline');
  });
  it("deduplicates startup and follows loading through to readiness", async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response({ status: "ready" }));
    vi.stubGlobal("fetch", fetch);
    const first = startVoiceService(), second = startVoiceService();
    expect(first).toBe(second);
    expect(useGameStore.getState().momoiStatus).toBe("loading");
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(response({ ok: true, status: "loading_model" }));
    await first;
    await checkVoiceService();
    expect(useGameStore.getState().momoiStatus).toBe("ready");
  });
  it("reports startup errors and permits retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ error: "Python dependency missing" }, false)).mockResolvedValueOnce(response({ ok: true, status: "ready" })));
    await startVoiceService();
    expect(useGameStore.getState().voiceServiceMessage).toContain("dependency");
    expect(useGameStore.getState().momoiStatus).toBe("error");
    await startVoiceService();
    expect(useGameStore.getState().momoiStatus).toBe("ready");
  });
  it("ignores a status response after changing providers and never probes the local service for external models", async () => {
    let finish!: (value: unknown) => void;
    const fetch = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const check = checkVoiceService();
    useGameStore.getState().setVoiceConfig({ provider: "compatible" });
    finish(response({ status: "ready" }));
    await check;
    await checkVoiceService();
    expect(useGameStore.getState().momoiStatus).toBe("unverified");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("tracks actual synthesis without requiring a health endpoint, keeping cached playback visible offline", async () => {
    useGameStore.getState().setVoiceConfig({ provider: "compatible" });
    await trackVoiceGeneration(async () => {
      expect(voiceStatusLabel(useGameStore.getState())).toBe("生成中");
      return "audio";
    });
    expect(useGameStore.getState().momoiStatus).toBe("ready");
    expect(useGameStore.getState().voiceServiceGenerating).toBe(0);
    useGameStore.setState({ momoiStatus: "offline", isVoicePlaying: true });
    expect(voiceStatusLabel(useGameStore.getState())).toBe("播放中");
  });
  it("ignores generation results from a replaced configuration", async () => {
    await trackVoiceGeneration(async () => { useGameStore.getState().setVoiceConfig({ provider: "compatible" }); return "audio"; });
    expect(useGameStore.getState().momoiStatus).toBe("unverified");
    expect(useGameStore.getState().voiceServiceGenerating).toBe(0);
  });
  it("shares polling across panel/game consumers and cleans up the last subscriber", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(response({ status: "ready" }));
    vi.stubGlobal("fetch", fetch);
    const one = renderHook(() => useVoiceServiceMonitor(true));
    const two = renderHook(() => useVoiceServiceMonitor(true));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledOnce();
    one.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    two.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
