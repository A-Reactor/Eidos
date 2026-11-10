
import { useInterfaceText } from "@/components/shell/useInterfaceText";
import type { PreparationProgress, TrainingJob } from '@/lib/game/momoi/training-model';
const labels = { reading: '读取素材', submitting: '提交素材', slicing: '切分音频', 'loading-asr': '加载转写模型', transcribing: '自动转写', complete: '整理校对素材' };

export function VoicePreparationProgress({ job, progress }: { job?: TrainingJob; progress?: PreparationProgress | null }) {
  const ui = useInterfaceText();
  const stopped = job?.status === 'failed' || job?.status === 'cancelled';
  if (!progress && (!job || !['preparing', 'review'].includes(job.status) && !(stopped && job.preparation && job.preparation.phase !== 'complete'))) return null;
  const current = progress ?? job?.preparation;
  const finished = !progress && job?.status === 'review';
  const known = current && Number.isFinite(current.total) && current.total! > 0 && Number.isFinite(current.completed) && current.completed! >= 0 && current.phase !== 'complete';
  const percent = finished ? 100 : known ? Math.min(100, Math.floor(current.completed! / current.total! * 100)) : undefined;
  const label = progress ? labels[progress.phase] : stopped ? job?.status === 'cancelled' ? ui("素材处理已取消") : ui("素材处理失败") : finished ? ui("素材处理完成，可以校对台词") : current ? labels[current.phase] : job?.stage || ui("准备素材");
  const counts = !finished && known ? current.phase === 'reading'
    ? `${(current.completed! / 1024 ** 2).toFixed(1)} / ${(current.total! / 1024 ** 2).toFixed(1)} MB`
    : `${current.completed} / ${current.total} ${current.phase === 'slicing' ? ui("份录音") : ui("段")}` : '';
  return <section aria-label={ui("导入与预处理进度")} className="eidos-audio-progress" data-stopped={stopped || undefined}>
    <div role="status" aria-live="polite"><span>{ui(label)}</span><span>{counts}{percent !== undefined ? ` · ${percent}%${finished ? '' : ui("（本步骤）")}` : ''}</span></div>
    <progress aria-label={ui("素材处理进度")} max={100} value={percent} />
    {current?.phase === 'loading-asr' && !stopped && !finished && <p>{ui("首次使用可能下载转写模型，加载耗时取决于网络和设备。")}</p>}
    {!finished && !stopped && <p>{progress ? ui("素材提交完成后，后台会继续切分与转写。") : ui("各步骤分别显示完成进度；当前后台任务会在离开页面后继续处理。")}</p>}
  </section>;
}
