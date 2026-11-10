import { useEffect } from "react";
import { useGameStore } from "@/store/game-store";
import type { MomoiConnectionStatus } from "./types";
import type { VoiceRequest } from "./model";

type State = ReturnType<typeof useGameStore.getState>;
const labels: Record<MomoiConnectionStatus, string> = {
  unverified: "待验证", checking: "检查中", loading: "模型加载中", ready: "服务就绪",
  busy: "服务暂未响应", offline: "服务未启动", error: "需要检查",
};
export function voiceStatusLabel(state: State) {
  if (!state.momoiSettings.enabled) return "关闭";
  if (state.isVoicePlaying) return "播放中";
  if (state.voiceServiceGenerating > 0 || state.voiceProgress === "generating") return "生成中";
  if (state.voiceError) return "需要检查";
  return labels[state.momoiStatus];
}
export function serviceStatusLabel(status: MomoiConnectionStatus) { return labels[status]; }

let checking: Promise<void> | null = null;
let starting: Promise<void> | null = null;
let stopping: Promise<void> | null = null;
let consumers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let revision = 0;
function report(config: State["voiceConfig"], status: MomoiConnectionStatus, message = "") {
  // A result for a previous provider/configuration must never validate the new one.
  if (useGameStore.getState().voiceConfig !== config) return;
  useGameStore.setState({ momoiStatus: status, voiceServiceMessage: message, voiceServiceCheckedAt: Date.now() });
}
export function checkVoiceService(): Promise<void> {
  const state = useGameStore.getState(), config = state.voiceConfig;
  if (config.provider !== "legacy" || state.voiceServiceGenerating || starting || stopping) return Promise.resolve();
  if (checking) return checking;
  const version = revision;
  if (state.momoiStatus === "unverified") report(config, "checking");
  checking = (async () => {
    try {
      const response = await fetch("/api/momoi/status", { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "状态检查失败");
      const status = data.status as MomoiConnectionStatus;
      if (!["ready", "loading", "busy", "offline", "error"].includes(status)) throw new Error("服务返回了未知状态");
      if (revision === version) report(config, status, data.error || data.hint || (status === "ready" ? "本地语音服务已就绪" : ""));
    } catch (error) {
      if (revision === version) report(config, "error", error instanceof Error ? error.message : "无法检查服务状态");
    }
  })().finally(() => { checking = null; });
  return checking;
}
export function startVoiceService(): Promise<void> {
  if (stopping) return stopping;
  if (starting) return starting;
  const config = useGameStore.getState().voiceConfig;
  if (config.provider !== "legacy") return Promise.resolve();
  revision++;
  report(config, "loading", "正在启动本地服务并加载模型，首次加载可能需要 1–2 分钟。");
  starting = (async () => {
    try {
      const response = await fetch("/api/momoi/start", { method: "POST", signal: AbortSignal.timeout(130_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "启动失败");
      report(config, ["ready", "already_running"].includes(data.status) ? "ready" : "loading", data.hint ?? "服务已启动，正在检查模型状态。");
    } catch (error) {
      report(config, "error", error instanceof Error ? error.message : "启动失败");
    }
  })().finally(() => { starting = null; });
  return starting;
}

export function stopVoiceService(): Promise<void> {
  if (stopping) return stopping;
  const state = useGameStore.getState(), config = state.voiceConfig;
  if (config.provider !== 'legacy' || state.voiceServiceGenerating || starting) return Promise.resolve();
  // A health request started before shutdown must not bring the ready indicator back.
  revision++;
  report(config, 'checking', '正在关闭本地模型并释放资源…');
  stopping = (async () => {
    try {
      const response = await fetch('/api/momoi/stop', { method: 'POST', signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? '关闭模型失败');
      report(config, 'offline', '本地语音模型已关闭。');
    } catch (error) {
      report(config, 'error', error instanceof Error ? error.message : '关闭模型失败');
    }
  })().finally(() => { stopping = null; });
  return stopping;
}

export async function trackVoiceGeneration<T>(operation: () => Promise<T>, expected?: VoiceRequest["config"]): Promise<T> {
  if (stopping) await stopping;
  const state = useGameStore.getState(), config = state.voiceConfig;
  if (expected && Object.entries(expected).some(([key, value]) => config[key as keyof typeof expected] !== value)) return operation();
  revision++;
  useGameStore.setState({ voiceServiceGenerating: state.voiceServiceGenerating + 1 });
  try {
    const result = await operation();
    report(config, "ready", "最近一次语音生成成功");
    return result;
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) report(config, "error", error instanceof Error ? error.message : "生成失败");
    throw error;
  } finally {
    if (useGameStore.getState().voiceConfig === config) useGameStore.setState(s => ({ voiceServiceGenerating: Math.max(0, s.voiceServiceGenerating - 1) }));
  }
}

export function useVoiceServiceMonitor(active: boolean) {
  const config = useGameStore(s => s.voiceConfig);
  useEffect(() => {
    if (!active || config.provider !== "legacy") return;
    consumers++;
    void checkVoiceService();
    timer ??= setInterval(() => { if (document.visibilityState !== "hidden") void checkVoiceService(); }, 5_000);
    return () => { if (--consumers === 0) { clearInterval(timer); timer = undefined; } };
  }, [active, config]);
}
