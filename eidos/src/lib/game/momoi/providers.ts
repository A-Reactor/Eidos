import { getMomoiBaseUrl } from "./config";
import { validateVoiceConfiguration, type VoiceRequest } from "./model";
import { gptSovitsBase, withGptSovitsModel } from './gpt-sovits';
import type { AudioData } from "./library";
import { extractSpokenDialogue } from './spoken-text';

export class VoiceInputError extends Error {}
export function validateVoiceRequest(value: unknown): VoiceRequest {
  if (!value || typeof value !== "object") throw new VoiceInputError("缺少语音请求");
  const r = value as VoiceRequest;
  if (typeof r.text !== "string" || !r.text.trim() || r.text.length > 10000) throw new VoiceInputError("对话须为 1–10000 字符");
  if (typeof r.speaker !== "string" || r.speaker.length > 200 || typeof r.emotion !== "string") throw new VoiceInputError("说话人或情绪无效");
  if (!r.config || !["legacy", "compatible", "gpt-sovits"].includes(r.config.provider) || !r.voice) throw new VoiceInputError("请选择语音服务");
  for (const v of [r.config.endpoint, r.config.model, r.config.language, r.voice.voice]) {
    if (typeof v !== "string" || v.length > 2000) throw new VoiceInputError("语音服务参数无效");
  }
  for (const v of [r.voice.referencePath, r.voice.referenceText, r.apiKey]) {
    if (v !== undefined && (typeof v !== "string" || v.length > 10000)) throw new VoiceInputError("音色参数无效");
  }
  for (const v of [r.voice.gptWeights, r.voice.sovitsWeights, r.config.gptWeights, r.config.sovitsWeights]) {
    if (v !== undefined && (typeof v !== 'string' || v.length > 2000 || v.includes('\0'))) throw new VoiceInputError('模型权重路径无效');
  }
  if (r.voice.referenceAudio !== undefined && (typeof r.voice.referenceAudio !== "string" || r.voice.referenceAudio.length > 14_000_000)) throw new VoiceInputError("参考音频过大");
  if (r.referenceLanguage !== undefined && (typeof r.referenceLanguage !== 'string' || r.referenceLanguage.length > 30)) throw new VoiceInputError('参考音频语言无效');
  if (r.config.provider !== "legacy") {
    let url: URL;
    try { url = new URL(r.config.endpoint); } catch { throw new VoiceInputError("请输入完整的服务地址"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VoiceInputError("服务地址须为不含凭据和查询参数的 HTTP(S) 地址");
  }
  if (r.config.provider === "compatible" && (!r.config.model.trim() || !r.voice.voice.trim())) throw new VoiceInputError("请填写模型和音色 ID");
  if (r.config.provider === "gpt-sovits" && !r.voice.referencePath?.trim()) throw new VoiceInputError("GPT-SoVITS 需要服务端参考音频路径");
  const invalid = validateVoiceConfiguration(r.config, r.voice);
  if (invalid) throw new VoiceInputError(invalid);
  if (r.config.provider === "legacy" && (!safeFilePart(r.worldId) || !r.voice.referenceAudio && !r.voice.referencePath && !safeFilePart(r.voice.voice || r.speaker))) throw new VoiceInputError("世界或音色名称无效");
  const text = extractSpokenDialogue(r.text, r.speaker);
  if (!text) throw new VoiceInputError('对话没有可朗读的台词');
  return { ...r, text };
}
function safeFilePart(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\\/\x00]/.test(value) && value !== "." && value !== "..";
}
function payload(r: VoiceRequest) {
  if (r.config.provider === "compatible") return { model: r.config.model, voice: r.voice.voice, input: r.text, response_format: "wav", speed: 1 };
  if (r.config.provider === "gpt-sovits") return {
    text: r.text, text_lang: r.config.language, ref_audio_path: r.voice.referencePath,
    prompt_text: r.voice.referenceText ?? "", prompt_lang: r.referenceLanguage ?? r.config.language,
    media_type: "wav", streaming_mode: false, text_split_method: "cut5", speed_factor: 1,
  };
  if (Boolean(r.voice.gptWeights) !== Boolean(r.voice.sovitsWeights)) throw new VoiceInputError('GPT 与 SoVITS 权重需要成对指定');
  return { text: r.text, language: r.config.language, referenceLanguage: r.referenceLanguage ?? r.voice.referenceLanguage ?? r.config.language, speaker: r.voice.voice || r.speaker, worldId: r.worldId, emotion: r.emotion, promptText: r.voice.referenceText, referencePath: r.voice.referencePath, referenceAudio: r.voice.referenceAudio === "server" ? undefined : r.voice.referenceAudio, useDefaultVoice: !r.voice.referenceAudio && !r.voice.referencePath, gptWeights: r.voice.gptWeights, sovitsWeights: r.voice.sovitsWeights };
}
let localGeneration: Promise<unknown> = Promise.resolve();
export async function synthesizeVoice(r: VoiceRequest, signal: AbortSignal): Promise<AudioData> {
  if (r.config.provider === 'gpt-sovits') {
    const taskSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    return withGptSovitsModel(r, taskSignal, () => synthesize(r, taskSignal));
  }
  if (r.config.provider !== "legacy") return synthesize(r, signal);
  // The bundled engine owns one model; concurrent clients must not run inference together.
  const job = localGeneration.catch(() => {}).then(() => synthesize(r, signal));
  localGeneration = job;
  return job;
}
async function synthesize(r: VoiceRequest, signal: AbortSignal): Promise<AudioData> {
  signal.throwIfAborted();
  const suffix = r.config.provider === "compatible" ? "/audio/speech" : r.config.provider === "gpt-sovits" ? "/tts" : "/synthesize";
  const base = r.config.provider === "legacy" ? getMomoiBaseUrl() : r.config.provider === 'gpt-sovits' ? gptSovitsBase(r.config.endpoint) : r.config.endpoint.replace(/\/+$/, "");
  const url = base.endsWith(suffix) ? base : base + suffix;
  const response = await fetch(url, {
    method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...(r.apiKey && r.config.provider === "compatible" ? { Authorization: `Bearer ${r.apiKey}` } : {}) },
    body: JSON.stringify(payload(r)), signal: AbortSignal.any([signal, AbortSignal.timeout(r.config.provider === 'legacy' ? 120_000 : 60_000)]),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = typeof detail?.error === 'string' ? detail.error : typeof detail?.detail === 'string' ? detail.detail : '';
    throw new Error(message ? `语音生成失败：${message.slice(0, 1500)}` : `语音服务返回 ${response.status}，请检查连接、模型与音色配置`);
  }
  if (r.config.provider === "legacy") {
    const data = await response.json();
    if (typeof data.audio !== "string" || !data.audio || data.audio.length > 28_000_000) throw new Error("本地服务未返回有效音频");
    return { audioBase64: data.audio, mimeType: "audio/wav" };
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!/^audio\/(wav|x-wav|mpeg|ogg|mp4|flac)$/.test(mimeType)) throw new Error("语音服务没有返回可播放的音频格式");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("语音服务返回空音频");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("单段音频超过 20 MB"); }
    chunks.push(value);
  }
  if (!size) throw new Error("语音服务返回空音频");
  return { audioBase64: Buffer.concat(chunks).toString("base64"), mimeType };
}
