// ============================================================
// Eidos · MOMOI 语音引擎 — 类型定义
// ============================================================

// ============================================================
// API 请求/响应
// ============================================================

/** TTS 合成请求 */
export interface MomoiSynthesizeRequest {
  /** 待合成文本（50-500 字符） */
  text: string;
  /** 说话人名称（NPC 名，用于查找音色 profile） */
  speaker: string;
  /** ALICE 情感标签 */
  emotion: "neutral" | "happy" | "sad" | "angry" | "surprised" | "thinking" | "worried" | "smiling";
  /** 当前世界 ID */
  worldId: string;
  /** 可选：base64 WAV 参考音频（零样本克隆用，需 >= 5 秒） */
  referenceAudio?: string;
  /** 可选：随机种子 */
  seed?: number;
  /** 不使用音色克隆，直接使用默认音色合成 */
  useDefaultVoice?: boolean;
}

/** TTS 合成响应 */
export interface MomoiSynthesizeResponse {
  /** base64 编码 WAV 音频 (24kHz, mono, 16-bit) */
  audio: string;
  /** 采样率 (Hz) */
  sampleRate: number;
  /** 音频时长 (ms) */
  durationMs: number;
  /** 使用的模型 */
  model: string;
  /** 实际应用的情感 */
  emotionApplied: string;
  /** 是否使用了音色克隆 */
  voiceCloned: boolean;
  /** 推理耗时 (ms) */
  inferenceTimeMs: number;
}

/** 健康检查响应 */
export interface MomoiStatusResponse {
  error?: string;
  status: "ready" | "loading_model" | "error" | "offline";
  modelLoaded: string;
  uptimeSeconds: number;
  device?: string;
  requestedDevice?: string;
  precision?: string;
  fallbackReason?: string;
}

// ============================================================
// Store 状态
// ============================================================

export type MomoiConnectionStatus =
  | "unverified"
  | "checking"
  | "ready"
  | "loading"
  | "busy"
  | "offline"
  | "error";

export interface MomoiSettings {
  /** 是否启用语音引擎 */
  enabled: boolean;
  /** 对话时自动播放语音 */
  autoPlay: boolean;
  /** 音量 (0-1) */
  volume: number;
  /** 语速倍率 (0.5-2.0) */
  speed: number;
}

export const DEFAULT_MOMOI_SETTINGS: MomoiSettings = {
  enabled: false,
  autoPlay: true,
  volume: 0.8,
  speed: 1.0,
};

// ============================================================
// NPC 音色 Profile
// ============================================================

export interface VoiceProfile {
  /** NPC 名称（对应 StorySegment.speaker） */
  speaker: string;
  /** 所属世界 ID */
  worldId: string;
  /** 参考音频的公开 URL */
  referenceAudioUrl: string | null;
  /** 参考音频时长（秒） */
  referenceDuration: number | null;
  /** 创建时间 */
  createdAt: number;
  /** 是否使用默认音色（无参考音频） */
  useDefaultVoice: boolean;
}

// ============================================================
// 音频缓存
// ============================================================

export interface AudioCacheKey {
  worldId: string;
  speaker: string;
  emotion: string;
  /** 文本前 80 字符的 hash（用于缓存去重） */
  textHash: string;
}

// ============================================================
// TTS 任务
// ============================================================

export type TtsJobStatus = "queued" | "processing" | "done" | "failed";

export interface TtsJob {
  id: string;
  request: MomoiSynthesizeRequest;
  status: TtsJobStatus;
  result?: MomoiSynthesizeResponse;
  error?: string;
  createdAt: number;
  /** @internal Promise resolve，队列内部使用 */
  _resolve?: (result: MomoiSynthesizeResponse) => void;
  /** @internal Promise reject，队列内部使用 */
  _reject?: (err: Error) => void;
}
