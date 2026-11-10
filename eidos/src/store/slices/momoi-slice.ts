// ============================================================
// Eidos · MOMOI 语音引擎 Slice
// ============================================================

import type {
  MomoiConnectionStatus,
  MomoiSettings,
} from "@/lib/game/momoi/types";

import { DEFAULT_VOICE_CONFIG, normalizeVoiceConfig, type VoiceConfig, type VoiceAsset } from "@/lib/game/momoi/model";
import type { VoiceQueueItem } from "@/lib/game/momoi/generation-queue";

export interface MomoiSlice {
  voiceConfig: VoiceConfig;
  voiceQueue: VoiceQueueItem[];
  setVoiceConfig: (config: Partial<VoiceConfig>) => void;
  voiceAssets: Record<string, VoiceAsset>;
  voiceAssetScope: string | null;
  voiceSession: number;
  voiceError: string | null;
  voiceServiceMessage: string;
  voiceServiceCheckedAt: number | null;
  voiceServiceGenerating: number;
  /** 当前播放的语音标识（speaker:textHash） */
  currentVoiceId: string | null;
  setCurrentVoiceId: (id: string | null) => void;

  /** MOMOI 连接状态 */
  momoiStatus: MomoiConnectionStatus;
  setMomoiStatus: (status: MomoiConnectionStatus) => void;

  /** 语音设置 */
  momoiSettings: MomoiSettings;
  setMomoiSettings: (s: Partial<MomoiSettings>) => void;

  /** 语音生成状态 */
  voiceProgress: "idle" | "generating" | "done" | "failed" | null;
  setVoiceProgress: (p: "idle" | "generating" | "done" | "failed" | null) => void;

  /** 是否正在播放语音 */
  isVoicePlaying: boolean;
  setIsVoicePlaying: (playing: boolean) => void;

  /** 默认 NPC 音色（未匹配的 NPC 使用） */
  defaultVoiceProfileId: string | null;
  setDefaultVoiceProfileId: (id: string | null) => void;
  defaultVoiceEnabled: boolean;
  setDefaultVoiceEnabled: (v: boolean) => void;
}

export const createMomoiSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any
): MomoiSlice => ({
  voiceConfig: { ...DEFAULT_VOICE_CONFIG },
  voiceQueue: [],
  setVoiceConfig: (config) => set((s) => ({ voiceConfig: normalizeVoiceConfig({ ...s.voiceConfig, ...config }), ...(config.material !== undefined && (s.voiceConfig.material ?? 'original') !== config.material || config.translationLanguage !== undefined && config.translationLanguage !== s.voiceConfig.translationLanguage ? { voiceSession: s.voiceSession + 1 } : {}), momoiStatus: "unverified", voiceServiceMessage: "", voiceServiceCheckedAt: null, voiceServiceGenerating: 0 })),
  voiceAssets: {},
  voiceAssetScope: null,
  voiceSession: 0,
  voiceError: null,
  voiceServiceMessage: "",
  voiceServiceCheckedAt: null,
  voiceServiceGenerating: 0,
  currentVoiceId: null,
  setCurrentVoiceId: (id) => set({ currentVoiceId: id }),

  momoiStatus: "unverified",
  setMomoiStatus: (status) => set({ momoiStatus: status }),

  momoiSettings: { enabled: false, autoPlay: true, volume: 0.8, speed: 1.0 },
  setMomoiSettings: (s) =>
    set((st) => ({ momoiSettings: { ...st.momoiSettings, ...s } })),

  voiceProgress: null,
  setVoiceProgress: (p) => set({ voiceProgress: p }),

  isVoicePlaying: false,
  setIsVoicePlaying: (playing) => set({ isVoicePlaying: playing }),

  defaultVoiceProfileId: null,
  setDefaultVoiceProfileId: (id) => set({ defaultVoiceProfileId: id }),
  defaultVoiceEnabled: false,
  setDefaultVoiceEnabled: (v) => set({ defaultVoiceEnabled: v }),
});
