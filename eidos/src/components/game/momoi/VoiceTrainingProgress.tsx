'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useState } from 'react';
import type { TrainingJob } from '@/lib/game/momoi/training-model';

function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}
export function VoiceTrainingProgress({ job }: { job: TrainingJob }) {
  const ui = useInterfaceText();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (job.status !== 'training') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [job.status]);
  if (job.status !== 'training') return job.gptElapsedSeconds !== undefined ? <p className="text-xs opacity-70">{ui("GPT 阶段用时约")}{duration(job.gptElapsedSeconds)}</p> : null;
  const elapsed = job.stageStartedAt ? Math.max(0, (now - job.stageStartedAt) / 1000) : job.stageElapsedSeconds ?? 0;
  const progress = job.trainingProgress;
  const percent = progress && progress.epochs > 0 ? Math.min(100, (progress.completedEpochs + (progress.completedEpochs < progress.epoch && progress.batches > 0 ? progress.batch / progress.batches : 0)) / progress.epochs * 100) : null;
  return <section aria-label={ui("训练进度")} className="eidos-audio-progress space-y-2">
    <p>{ui("本阶段累计")}{duration(elapsed)}{job.stage === '训练 GPT' ? ui(" · 日志里的短计时通常是单轮耗时") : ''}</p>
    {job.stage === '训练 GPT' && <>
      <progress aria-label={ui("GPT 训练进度")} max={100} {...(percent !== null ? { value: percent } : {})} />
      <p role="status">{!progress || progress.state === 'loading' ? ui("正在初始化 GPT 模型与训练数据，暂未开始计批次…") : progress.state === 'complete' ? ui("GPT 训练已结束，正在核验导出成品…") : ui("第 {0} / {1} 轮 · {2} / {3} 批次", {"0": progress.epoch, "1": progress.epochs, "2": progress.batch, "3": progress.batches})}</p>
    </>}
  </section>;
}
