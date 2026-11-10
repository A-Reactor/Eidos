'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from 'react';
import { EidosButton } from '@/components/ui/EidosScreen';
import { useGameStore } from '@/store/game-store';
import type { TrainingJob } from '@/lib/game/momoi/training-model';
import { releaseTrainedVoice, trainedVoiceTargets, TRAINING_JOBS_CHANGED } from '@/lib/game/momoi/trained-voice-bindings';

export function VoiceDeleteWeights({ job, disabled, onDeleted, onBusy }: { job: TrainingJob; disabled?: boolean; onDeleted: (job: TrainingJob) => void; onBusy?: (busy: boolean) => void }) {
  const ui = useInterfaceText();
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const config = useGameStore(state => state.voiceConfig);
  const generating = useGameStore(state => state.voiceServiceGenerating > 0);
  const targets = trainedVoiceTargets(config, job);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function remove() {
    setBusy(true); onBusy?.(true); setMessage('');
    try {
      const response = await fetch('/api/momoi/training', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: job.id, action: 'delete-weights', confirmed: true }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.job) throw new Error(data?.error || ui("删除失败，请检查本地训练服务"));
      const state = useGameStore.getState();
      state.setVoiceConfig(releaseTrainedVoice(state.voiceConfig, job));
      window.dispatchEvent(new Event(TRAINING_JOBS_CHANGED));
      if (mounted.current) { setConfirm(false); setMessage(data.job.warning || ui("训练权重已删除，录音与校对文本已保留。")); onDeleted(data.job); }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : ui("删除失败")); }
    finally { if (mounted.current) setBusy(false); onBusy?.(false); }
  }
  return <div className="space-y-3">
    {!confirm ? <EidosButton disabled={disabled || busy || generating} onClick={() => setConfirm(true)}>{ui("删除此音色权重")}</EidosButton> : <section role="alertdialog" aria-label={ui("确认删除训练权重")} className="eidos-audio-notice space-y-3">
      <p>{ui("删除「")}{job.name}{ui("」的全部训练权重、保存点及可重建的特征文件？此操作不可撤销。")}</p>
      <p className="text-xs leading-6">{ui("原始录音、台词校对和任务记录会保留，可重新训练；初始底模及已生成的对话录音不受影响。")}</p>
      {targets.length > 0 && <p className="text-xs leading-6">{ui("当前使用：")}{targets.join(ui("、"))}{ui("。删除后恢复初始或默认权重，保留参考录音。")}</p>}
      <p className="text-xs leading-6 opacity-70">{ui("其他存档或已保存方案里的旧权重路径会失效，需重新选择音色。")}</p>
      <div className="flex gap-2"><EidosButton disabled={disabled || busy || generating} onClick={() => void remove()}>{busy ? ui("正在删除…") : ui("确认删除权重")}</EidosButton><EidosButton disabled={busy} onClick={() => setConfirm(false)}>{ui("取消删除")}</EidosButton></div>
    </section>}
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
  </div>;
}
