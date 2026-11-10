import type { StorySegment } from "@/lib/ai/types";
import { extractSpokenDialogue } from './spoken-text';
import { isVoiceLanguage, translationTarget, type VoiceLanguage } from './languages';

export type VoiceProvider = "legacy" | "gpt-sovits" | "compatible";
export interface SpeakerVoice {
  voice: string;
  referencePath?: string;
  referenceText?: string;
  referenceAudio?: string;
  referenceLanguage?: string;
  /** Paths on the API v2 server; SoVITS may be a full checkpoint or a LoRA. */
  gptWeights?: string;
  sovitsWeights?: string;
  trainingJobId?: string;
  modelName?: string;
}
export interface VoiceConfig extends SpeakerVoice {
  provider: VoiceProvider;
  endpoint: string;
  model: string;
  language: string;
  /** Missing in old saves means original dialogue. */
  material?: 'original' | 'japanese' | 'translated';
  translationLanguage?: VoiceLanguage;
  speakers: Record<string, Partial<SpeakerVoice>>;
}
export interface VoiceRequest {
  text: string;
  speaker: string;
  emotion: string;
  config: Omit<VoiceConfig, "speakers">;
  voice: SpeakerVoice;
  apiKey?: string;
  worldId?: string;
  referenceLanguage?: string;
}
export interface VoiceAsset {
  id: string;
  text: string;
  speaker: string;
  emotion: string;
  audioBase64: string;
  mimeType: string;
  provider: VoiceProvider | "uploaded";
  model: string;
  createdAt: number;
  spokenText?: string;
  speechLanguage?: string;
  material?: 'japanese' | 'translated';
}
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  provider: "legacy", endpoint: "", model: "", voice: "", language: "zh", speakers: {},
};
/** Client-side checks explain missing fields before a potentially paid request. */
export function validateVoiceConfiguration(config: VoiceRequest["config"], voice: SpeakerVoice = config): string | null {
  if (config.provider === 'compatible' && translationTarget(config)) return '译文配音目前仅支持 GPT-SoVITS';
  if (config.provider !== 'compatible' && Boolean(voice.gptWeights?.trim()) !== Boolean(voice.sovitsWeights?.trim())) return "GPT 与 SoVITS 权重路径需要成对填写";
  if (config.provider === "legacy") return null;
  try {
    const url = new URL(config.endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return "服务地址须为不含凭据和查询参数的 HTTP(S) 地址";
  } catch { return "请输入完整的服务地址（含 http:// 或 https://）"; }
  if (config.provider === "compatible") {
    if (!config.model.trim()) return "请填写模型 ID";
    if (!voice.voice.trim()) return "请填写默认音色 ID，或为当前角色指定音色";
  }
  if (config.provider === "gpt-sovits" && !voice.referencePath?.trim()) return "请填写语音服务电脑上的参考音频路径";
  if (config.provider === "gpt-sovits") {
    if (Boolean(voice.gptWeights?.trim()) !== Boolean(voice.sovitsWeights?.trim())) return "GPT 与 SoVITS 权重路径需要成对填写";
    if (voice.gptWeights?.trim() && (!config.gptWeights?.trim() || !config.sovitsWeights?.trim())) return "请先成对填写默认模型权重，以便其他角色切回默认音色";
  }
  return null;
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
function normalizeSpeaker(value: unknown): SpeakerVoice {
  const v = record(value);
  return { voice: str(v.voice), referencePath: str(v.referencePath), referenceText: str(v.referenceText), referenceAudio: str(v.referenceAudio),
    ...(str(v.gptWeights).trim() ? { gptWeights: str(v.gptWeights) } : {}),
    ...(str(v.sovitsWeights).trim() ? { sovitsWeights: str(v.sovitsWeights) } : {}),
    ...(str(v.referenceLanguage).trim() ? { referenceLanguage: str(v.referenceLanguage) } : {}),
    ...(str(v.trainingJobId) ? { trainingJobId: str(v.trainingJobId) } : {}),
    ...(str(v.modelName) ? { modelName: str(v.modelName) } : {}),
  };
}
export function normalizeVoiceConfig(value: unknown): VoiceConfig {
  const v = record(value);
  return {
    ...normalizeSpeaker(v),
    provider: v.provider === "compatible" || v.provider === "gpt-sovits" ? v.provider : "legacy",
    endpoint: str(v.endpoint), model: str(v.model), language: str(v.language, "zh"),
    ...(v.material === 'japanese' ? { material: 'japanese' as const } : {}),
    ...(v.material === 'translated' && isVoiceLanguage(v.translationLanguage) ? { material: 'translated' as const, translationLanguage: v.translationLanguage } : {}),
    speakers: Object.fromEntries(Object.entries(record(v.speakers)).map(([name, voice]) => [name, normalizeSpeaker(voice)])),
  };
}
/** A recording, its transcript and its language describe one reference; never mix speakers. */
export function resolveVoice(config: VoiceConfig, speaker = ''): SpeakerVoice {
  const override = config.speakers[speaker] ?? {};
  const weights = override.gptWeights || override.sovitsWeights ? override : config;
  const ownReference = Boolean(override.referenceAudio || override.referencePath || override.voice);
  const reference = ownReference ? override : config;
  return { voice: override.voice || config.voice, referenceAudio: reference.referenceAudio ?? '', referencePath: reference.referencePath ?? '',
    referenceText: reference.referenceText ?? '', referenceLanguage: reference.referenceLanguage || (ownReference ? 'auto' : config.referenceLanguage),
    gptWeights: weights.gptWeights?.trim(), sovitsWeights: weights.sovitsWeights?.trim(), trainingJobId: weights.trainingJobId, modelName: weights.modelName };
}
export function buildVoiceRequest(segment: StorySegment | null, config: VoiceConfig): VoiceRequest | null {
  if (segment?.type !== "dialogue" || !segment.text.trim()) return null;
  const text = extractSpokenDialogue(segment.text, segment.speaker);
  if (!text || /^(?:旁白|narrator|narration)$/i.test(segment.speaker?.trim() ?? '')) return null;
  const { speakers: _speakers, ...connection } = config;
  const voice = resolveVoice(config, segment.speaker);
  return { text, speaker: segment.speaker ?? "", emotion: segment.emotion ?? "neutral", config: connection, voice, ...(voice.referenceLanguage ? { referenceLanguage: voice.referenceLanguage } : {}) };
}
export async function voiceIdentity(request: VoiceRequest): Promise<string> {
  // Credentials affect access, not sound. Hash the entire utterance and synthesis configuration.
  const { text, speaker, emotion, config: c, voice: v } = request;
  // An explicit GPT/SoVITS pair defines the model; its display name or the default model must not invalidate a character's cache.
  const model = c.provider !== 'compatible' && (v.gptWeights || v.sovitsWeights) ? '' : c.model;
  const identity = [text, speaker, emotion, c.provider, c.endpoint, model, c.language, v.voice, v.referencePath ?? "", v.referenceText ?? "", v.referenceAudio ?? ""];
  if (c.material === 'japanese') identity.push('japanese-v1');
  if (c.material === 'translated') identity.push('translated-v1', c.translationLanguage ?? '');
  if (request.referenceLanguage && request.referenceLanguage !== c.language) identity.push('reference-language', request.referenceLanguage);
  // Append only for explicit API v2 models so existing audio IDs remain valid.
  if (['gpt-sovits', 'legacy'].includes(c.provider) && (v.gptWeights || v.sovitsWeights)) identity.push('gpt-sovits-weights-v1', v.gptWeights ?? '', v.sovitsWeights ?? '');
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export function normalizeVoiceAssets(value: unknown): Record<string, VoiceAsset> {
  const assets: Record<string, VoiceAsset> = {};
  for (const [id, raw] of Object.entries(record(value))) {
    const a = record(raw);
    if (!/^[a-f0-9]{64}$/.test(id) || a.id !== id || typeof a.text !== "string" || typeof a.speaker !== "string" || typeof a.audioBase64 !== "string" || a.audioBase64.length > 28_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(a.audioBase64) || !/^audio\/(wav|mpeg|ogg|mp4|x-wav|flac)$/.test(str(a.mimeType))) continue;
    assets[id] = {
      id, text: a.text, speaker: a.speaker, emotion: str(a.emotion, "neutral"), audioBase64: a.audioBase64, mimeType: str(a.mimeType),
      provider: a.provider === "legacy" || a.provider === "gpt-sovits" || a.provider === "compatible" ? a.provider : "uploaded",
      model: str(a.model), createdAt: typeof a.createdAt === "number" && Number.isFinite(a.createdAt) ? a.createdAt : 0,
      ...(a.material === 'japanese' ? { material: 'japanese' as const } : {}),
      ...(a.material === 'translated' && isVoiceLanguage(a.speechLanguage) ? { material: 'translated' as const } : {}),
      ...(typeof a.spokenText === 'string' && a.spokenText.length <= 10_000 ? { spokenText: a.spokenText } : {}),
      ...(typeof a.speechLanguage === 'string' && a.speechLanguage.length <= 30 ? { speechLanguage: a.speechLanguage } : {}),
    };
  }
  return assets;
}
