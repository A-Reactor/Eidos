"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EidosButton } from "@/components/ui/EidosScreen";
import { SettingsField as EidosField } from "../settings/SettingsField";
import { buildVoiceRequest, validateVoiceConfiguration, type VoiceConfig, type VoiceProvider } from "@/lib/game/momoi/model";
import { loadVoicePresets, rememberVoiceDraft, voiceProviderDraft } from "@/lib/game/momoi/presets";
import { VoicePresets } from "./VoicePresets";
import { VoiceCasting } from './VoiceCasting';
import { voiceCredentialKey } from "@/lib/game/momoi/runtime";
import { checkVoiceService, serviceStatusLabel, startVoiceService, stopVoiceService } from "@/lib/game/momoi/service-status";
import { generateVoiceAudio } from "@/lib/game/momoi/client-generation";
const control = "eidos-field w-full rounded-sm border border-current/20 p-2.5 text-sm";

export function VoiceConnection({ speaker, onSpeakerChange, onInstallation }: { speaker: string; onSpeakerChange: (speaker: string) => void; onInstallation: () => void }) {
  const ui = useInterfaceText();
  const config = useGameStore(s => s.voiceConfig);
  const patch = useGameStore(s => s.setVoiceConfig);
  const worldId = useGameStore(s => s.currentWorld?.id ?? "");
  const draftScope = useGameStore(s => JSON.stringify([s.sandboxMode ? s.sandboxDossierId : "main", s.currentWorld?.id ?? ""]));
  const [switching, setSwitching] = useState(false);
  const status = useGameStore(s => s.momoiStatus);
  const serviceMessage = useGameStore(s => s.voiceServiceMessage);
  const checkedAt = useGameStore(s => s.voiceServiceCheckedAt);
  const generating = useGameStore(s => s.voiceServiceGenerating > 0);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const key = keys[config.endpoint] ?? sessionStorage.getItem(voiceCredentialKey(config.endpoint)) ?? "";
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(ui("你好。这个世界的故事，正等着我们继续。"));
  const audio = useRef<HTMLAudioElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { void loadVoicePresets().catch(() => {}); }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void rememberVoiceDraft(draftScope, config).catch(error => setMessage(ui("草稿保存失败：{0}", {"0": String(error)}))); }, 350);
    return () => clearTimeout(timer);
  }, [ui, config, draftScope]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); audio.current?.pause(); };
  }, []);
  async function test() {
    setBusy(true); setMessage(config.provider === 'legacy' ? ui("正在准备本地服务并生成试听…") : ui("正在生成试听…")); audio.current?.pause();
    const abort = new AbortController(); controller.current = abort;
    try {
      const request = buildVoiceRequest({ type: "dialogue", text: sample, speaker: speaker || ui("试听") }, speaker ? config : { ...config, speakers: {} });
      const invalid = validateVoiceConfiguration(config, request?.voice);
      if (invalid) throw new Error(invalid);
      if (!request) throw new Error(ui("请输入可朗读的试听台词"));
      const data = await generateVoiceAudio({ ...request, worldId: worldId || 'voice-preview', apiKey: key }, abort.signal, usage => useGameStore.getState().addTokenUsage(usage, worldId));
      if (abort.signal.aborted) return;
      if (useGameStore.getState().voiceConfig !== config) { setMessage(ui("配置已更改，请重新试听。")); return; }
      const element = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      audio.current = element; element.volume = useGameStore.getState().momoiSettings.volume;
      await element.play();
      setMessage(ui("连接成功，正在播放试听。")); useGameStore.setState({ voiceError: null });
    } catch (error) {
      if (!abort.signal.aborted && useGameStore.getState().voiceConfig === config) setMessage(error instanceof Error ? error.message : ui("试听失败"));
    } finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function applyConfig(next: VoiceConfig, remember = true) {
    if (remember) await rememberVoiceDraft(draftScope, config);
    if (!mounted.current || useGameStore.getState().voiceConfig !== config) throw new Error(ui("配置已修改，请重新选择方案"));
    controller.current?.abort(); setBusy(false); setMessage(""); audio.current?.pause();
    patch(next);
  }
  async function selectProvider(provider: VoiceProvider) {
    setSwitching(true);
    try { await applyConfig(await voiceProviderDraft(draftScope, config, provider), false); }
    catch (error) { setMessage(error instanceof Error ? error.message : ui("服务切换失败")); }
    finally { setSwitching(false); }
  }
  return <div className="eidos-audio-workspace">
    <section className="eidos-audio-block" aria-label={ui("服务与连接")}>
    <h3>{ui("服务与连接")}</h3>
    <EidosField id="voice-provider" label={ui("生成服务")}><select id="voice-provider" disabled={switching} className={control} value={config.provider} onChange={e => void selectProvider(e.target.value as VoiceProvider)}>
      <option value="legacy">{ui("内置本地服务 · GPT-SoVITS")}</option><option value="gpt-sovits">{ui("GPT-SoVITS · 社区模型 / API v2")}</option><option value="compatible">{ui("兼容语音接口 · 自选模型")}</option>
    </select></EidosField>
    <div role="status" aria-live="polite" className="eidos-audio-service-card">
      <span className="font-medium">{generating ? ui("正在生成语音") : serviceStatusLabel(status)}</span>{checkedAt && <span className="ml-3 opacity-50">{new Date(checkedAt).toLocaleTimeString()}</span>}
      {serviceMessage && <p className="eidos-audio-caption">{serviceMessage}</p>}
    </div>
    {config.provider === "legacy" ? <div className="flex flex-wrap gap-2"><EidosButton disabled={busy || generating || ["checking", "loading", "busy"].includes(status)} title={status === 'ready' ? ui("点击关闭本地语音模型") : undefined} aria-busy={status === "loading" || status === "checking"} onClick={() => void (status === 'ready' ? stopVoiceService() : startVoiceService())}>{generating ? ui("正在生成语音…") : status === "loading" ? ui("模型加载中…") : status === "checking" ? ui("正在处理…") : status === "ready" ? ui("模型已就绪") : status === "busy" ? ui("服务暂未响应") : status === "error" ? ui("重试启动") : ui("启动本地模型")}</EidosButton><EidosButton disabled={generating || status === "checking"} onClick={() => void checkVoiceService()}>{ui("刷新状态")}</EidosButton><EidosButton onClick={onInstallation}>{ui("检查安装与语言支持")}</EidosButton></div> : <>
      <EidosField id="voice-endpoint" label={ui("服务地址")} hint={config.provider === "compatible" ? ui("填写 API 根地址，例如 http://127.0.0.1:8880/v1") : ui("填写运行 api_v2.py 的服务地址")}><input id="voice-endpoint" className={control} value={config.endpoint} onChange={e => patch({ endpoint: e.target.value })} /></EidosField>
      {config.provider === "compatible" && <>
        <EidosField id="voice-model" label={ui("模型 ID")}><input id="voice-model" className={control} value={config.model} placeholder={ui("服务提供的模型名")} onChange={e => patch({ model: e.target.value })} /></EidosField>
        <div className="flex flex-wrap gap-2"><EidosButton onClick={() => patch({ endpoint: "http://127.0.0.1:8880/v1", model: "kokoro", voice: "zf_xiaobei" })}>{ui("填入本地 Kokoro 配置")}</EidosButton><EidosButton onClick={() => patch({ endpoint: "https://api.openai.com/v1", model: "tts-1", voice: "alloy" })}>{ui("填入 OpenAI 语音配置")}</EidosButton></div>
        <details><summary className="cursor-pointer text-xs">{ui("连接凭据")}</summary><EidosField id="voice-key" label="API Key" hint={ui("可选，仅保留在本次浏览器会话，不随存档导出")}><input id="voice-key" type="password" autoComplete="off" className={control} value={key} onChange={e => { setKeys({ ...keys, [config.endpoint]: e.target.value }); sessionStorage.setItem(voiceCredentialKey(config.endpoint), e.target.value); patch({}); }} /></EidosField></details>
      </>}
    </>}
    {config.provider !== "legacy" && <EidosButton onClick={onInstallation}>{ui("检查安装与语言支持")}</EidosButton>}
    </section>
    <VoiceCasting speaker={speaker} onSpeakerChange={value => { controller.current?.abort(); audio.current?.pause(); setBusy(false); setMessage(''); onSpeakerChange(value); }} />
    <section className="eidos-audio-block" aria-label={ui("音色试听")}><h3>{ui("试听验证")}</h3>
    <EidosField id="voice-sample" label={ui("试听一句")} hint={ui("使用{0}音色，不写入对话资源。", {"0": speaker ? `「${speaker}」的` : ui("默认")})}><textarea id="voice-sample" className={control} value={sample} onChange={e => setSample(e.target.value)} /></EidosField>
    <div className="flex gap-2"><EidosButton disabled={busy || !sample.trim()} onClick={() => void test()}>{busy ? ui("处理中…") : ui("生成并试听")}</EidosButton><EidosButton onClick={() => { controller.current?.abort(); audio.current?.pause(); setBusy(false); setMessage(""); }}>{ui("停止")}</EidosButton></div>
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
    </section>
    <VoicePresets onApply={applyConfig} />
  </div>;
}
