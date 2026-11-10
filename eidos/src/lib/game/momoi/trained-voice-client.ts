import type { TrainingJob } from './training-model';

export interface VoiceSavePoints { gpt?: string; sovits?: string }
export async function readTrainingResponse(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '无法读取本地训练音色，请确认游戏后台正在运行');
  return data;
}
export async function loadTrainedVoice(id: string, points: VoiceSavePoints = {}, signal?: AbortSignal): Promise<{ job: TrainingJob; referenceAudio: string }> {
  const query = new URLSearchParams({ view: 'voice', id, ...points });
  const data = await readTrainingResponse(`/api/momoi/training?${query}`, signal);
  if (data.job?.status !== 'complete' || !data.job.result || typeof data.referenceAudio !== 'string' || !data.referenceAudio) throw new Error('训练成品或参考录音不完整，请重新检查该训练任务');
  return data;
}
