import { DEFAULT_VOICE_CONFIG, type VoiceConfig } from './model';
import type { TrainingOptions } from './training-options';
export interface TrainingCheckpoint { name: string; path: string; epoch: number | null }
export type TrainingStatus = 'preparing' | 'review' | 'training' | 'complete' | 'failed' | 'cancelled';
export interface TrainingClip { id: string; file: string; duration: number; text: string; included: boolean }
export interface TrainedVoice { gptWeights: string; sovitsWeights: string; referencePath: string; referenceText: string; referenceId: string }
export interface PreparationProgress {
  phase: 'reading' | 'submitting' | 'slicing' | 'loading-asr' | 'transcribing' | 'complete';
  completed?: number; total?: number;
}
export interface TrainingJob {
  id: string; name: string; language: string; version: 'v2' | 'v2ProPlus'; status: TrainingStatus;
  stage: string; createdAt: number; updatedAt: number; clips: TrainingClip[]; duration?: number;
  autoTranscribe: boolean; error?: string; log?: string; epoch?: number; result?: TrainedVoice;
  trainingOptions?: TrainingOptions; epochTotal?: number;
  checkpoints?: { gpt: TrainingCheckpoint[]; sovits: TrainingCheckpoint[] };
  preparation?: PreparationProgress;
  runDirectory?: string; warning?: string; weightsCleanupPending?: boolean;
  stageStartedAt?: number; stageElapsedSeconds?: number;
  gptElapsedSeconds?: number;
  trainingProgress?: { phase: 'gpt'; state: 'loading' | 'training' | 'complete'; epoch: number; epochs: number; completedEpochs: number; batch: number; batches: number; elapsedSeconds: number };
}
export interface TrainingEnvironment {
  root: string; python: string; ffmpeg: boolean; mac: boolean; configuredModel: string;
  missingModules: string[]; versions: { id: string; ready: boolean; missing: string[] }[];
  asr: Record<string, boolean>;
}
export const trainingActive = (job?: TrainingJob | null) => job?.status === 'preparing' || job?.status === 'training';
export function trainedVoiceConfig(current: VoiceConfig, job: TrainingJob, audio: string, speaker: string): VoiceConfig {
  if (job.status !== 'complete' || !job.result) throw new Error('音色尚未训练完成');
  const base = current.provider === 'legacy' ? current : { ...DEFAULT_VOICE_CONFIG, language: current.language, material: current.material, translationLanguage: current.translationLanguage };
  const voice = { voice: job.name, ...job.result, referenceAudio: audio, referenceLanguage: job.language, trainingJobId: job.id, modelName: `${job.version} · ${job.name}` };
  return { ...base, provider: 'legacy',
    ...(speaker ? { speakers: { ...base.speakers, [speaker]: voice } } : { ...voice, model: `${job.version} · ${job.name}` }) };
}
