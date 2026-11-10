import fs from 'node:fs';
import path from 'node:path';
import { RequestInputError } from '@/lib/api/request-input';
import type { TrainingJob } from './training-model';

/** Only worker-owned output directories are disposable; clips and source recordings stay put. */
export function deleteTrainingOutputs(directory: string, job: TrainingJob, save: (next: TrainingJob) => void): TrainingJob {
  const base = path.join(directory, job.id);
  if (fs.lstatSync(base).isSymbolicLink()) throw new RequestInputError('训练目录不能是符号链接');
  const runs = fs.readdirSync(base).filter(name => /^run(?:-\d+)?$/.test(name));
  const pending = path.join(base, 'weights-pending-delete');
  for (const target of [...runs.map(name => path.join(base, name)), ...(fs.existsSync(pending) ? [pending] : [])]) {
    if (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isDirectory()) throw new RequestInputError('训练输出目录无效，未删除权重');
  }
  for (const file of [job.runDirectory, job.result?.gptWeights, job.result?.sovitsWeights].filter(Boolean) as string[]) {
    const relative = path.relative(base, file);
    if (!/^run(?:-\d+)?(?:[\\/]|$)/.test(relative)) throw new RequestInputError('模型不在此任务的训练输出目录中，未删除权重');
  }
  fs.mkdirSync(pending, { recursive: true });
  const moved: string[] = [];
  const next: TrainingJob = { ...job, status: 'review', stage: '权重已删除，素材已保留', error: '', warning: '' };
  for (const key of ['result', 'checkpoints', 'runDirectory', 'epoch', 'epochTotal', 'trainingProgress', 'stageStartedAt', 'stageElapsedSeconds', 'gptElapsedSeconds', 'weightsCleanupPending'] as const) delete next[key];
  try {
    for (const name of runs) { fs.renameSync(path.join(base, name), path.join(pending, name)); moved.push(name); }
    save(next);
  } catch (error) {
    for (const name of moved.reverse()) fs.renameSync(path.join(pending, name), path.join(base, name));
    throw error;
  }
  try { fs.rmSync(pending, { recursive: true, force: true }); }
  catch (error) {
    next.warning = `模型绑定已移除，部分文件未能清理，可再次删除重试：${error instanceof Error ? error.message : String(error)}`;
    next.weightsCleanupPending = true; save(next);
  }
  return next;
}
