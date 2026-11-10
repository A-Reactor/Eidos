import type { VoiceConfig, SpeakerVoice } from './model';
import type { TrainingJob } from './training-model';

function uses(job: TrainingJob, voice: Partial<SpeakerVoice>) {
  const paths = [job.result?.gptWeights, job.result?.sovitsWeights, ...(job.checkpoints?.gpt ?? []).map(p => p.path), ...(job.checkpoints?.sovits ?? []).map(p => p.path)].filter(Boolean);
  const run = job.runDirectory?.replace(/\\/g, '/');
  const base = run && /\/run(?:-\d+)?$/.test(run) ? run.replace(/run(?:-\d+)?$/, '') : '';
  return voice.trainingJobId === job.id || [voice.gptWeights, voice.sovitsWeights].some(file => {
    if (!file) return false;
    const normalized = file.replace(/\\/g, '/');
    return paths.includes(file) || Boolean(base && normalized.startsWith(base) && /^run(?:-\d+)?\//.test(normalized.slice(base.length)));
  });
}
export function trainedVoiceTargets(config: VoiceConfig, job: TrainingJob) {
  if (config.provider !== 'legacy') return [];
  return [...(uses(job, config) ? ['默认音色'] : []), ...Object.entries(config.speakers).filter(([, voice]) => uses(job, voice)).map(([name]) => name)];
}
export function releaseTrainedVoice(config: VoiceConfig, job: TrainingJob): VoiceConfig {
  if (config.provider !== 'legacy') return config;
  const release = <T extends Partial<SpeakerVoice>>(voice: T) => uses(job, voice) ? { ...voice, gptWeights: '', sovitsWeights: '', trainingJobId: '', modelName: '' } : voice;
  return { ...release(config), ...(uses(job, config) ? { model: '' } : {}),
    speakers: Object.fromEntries(Object.entries(config.speakers).map(([name, voice]) => [name, release(voice)])) };
}
export const TRAINING_JOBS_CHANGED = 'eidos:training-jobs-changed';
