'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/game-store';
import { trainedVoiceConfig, type TrainingJob } from '@/lib/game/momoi/training-model';
import { loadTrainedVoice, readTrainingResponse, type VoiceSavePoints } from '@/lib/game/momoi/trained-voice-client';
import { EidosButton } from '@/components/ui/EidosScreen';
import { SettingsField } from '../settings/SettingsField';
import { VOICE_LANGUAGES, type VoiceLanguage } from '@/lib/game/momoi/languages';
import { VoiceDeleteWeights } from './VoiceDeleteWeights';
import { TRAINING_JOBS_CHANGED } from '@/lib/game/momoi/trained-voice-bindings';

export function VoiceTrainedModels({ speaker }: { speaker: string }) {
  const ui = useInterfaceText();
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selected, setSelected] = useState('');
  const [points, setPoints] = useState<VoiceSavePoints>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const target = useRef(speaker);
  useEffect(() => { target.current = speaker; return () => { controller.current?.abort(); }; }, [speaker]);
  const mounted = useRef(true);
  const job = jobs.find(job => job.id === selected);
  function refresh(signal?: AbortSignal) {
    void readTrainingResponse('/api/momoi/training', signal).then(data => {
      if (mounted.current && !signal?.aborted) setJobs((data.jobs ?? []).filter((job: TrainingJob) => job.status === 'complete' && job.result));
    }).catch(error => { if (mounted.current && !signal?.aborted) setMessage(error instanceof Error ? error.message : ui("读取失败")); })
      .finally(() => { if (mounted.current && !signal?.aborted) setLoading(false); });
  }
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController(); void refresh(abort.signal);
    const changed = () => refresh(abort.signal); window.addEventListener(TRAINING_JOBS_CHANGED, changed);
    return () => { mounted.current = false; abort.abort(); controller.current?.abort(); window.removeEventListener(TRAINING_JOBS_CHANGED, changed); };
  }, []);
  async function apply() {
    if (!job) return;
    const config = useGameStore.getState().voiceConfig;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setMessage(ui("正在读取模型与参考录音…"));
    try {
      const result = await loadTrainedVoice(job.id, points, abort.signal);
      if (!mounted.current || abort.signal.aborted || target.current !== speaker) return;
      if (useGameStore.getState().voiceConfig !== config) throw new Error(ui("配置已更改，请重新应用所选音色"));
      useGameStore.getState().setVoiceConfig(trainedVoiceConfig(config, result.job, result.referenceAudio, speaker));
      setMessage(speaker ? ui("已应用到「{0}」，可在下方试听。", {"0": speaker}) : ui("已设为默认音色，可在下方试听。"));
    } catch (error) { if (mounted.current && !abort.signal.aborted && target.current === speaker) setMessage(error instanceof Error ? error.message : ui("应用失败")); }
    finally { if (mounted.current && target.current === speaker) setBusy(false); }
  }
  return <section aria-label={ui("已训练音色库")} className="space-y-3">
    <SettingsField id="trained-voice" label={ui("已训练音色")} hint={ui("选择成品后，权重、参考录音、台词和语言一起应用；原文与译文配音设置保留。")}>
      <select id="trained-voice" className="eidos-settings-control" disabled={loading || busy} value={selected} onChange={event => { setSelected(event.target.value); setPoints({}); setMessage(''); }}>
        <option value="">{loading ? ui("正在读取…") : jobs.length ? ui("选择已完成的训练音色") : ui("暂无已完成音色，请先训练")}</option>
        {jobs.map(job => <option key={job.id} value={job.id}>{job.name} · {job.version} · {ui(VOICE_LANGUAGES[job.language as VoiceLanguage]) ?? job.language}</option>)}
      </select>
    </SettingsField>
    {job && <details className="space-y-3"><summary className="cursor-pointer text-xs">{ui("选择模型保存点")}</summary>
      {(['gpt', 'sovits'] as const).map(type => <SettingsField key={type} id={`trained-${type}`} label={ui("{0} 保存点", {"0": type === 'gpt' ? 'GPT' : 'SoVITS'})}>
        <select id={`trained-${type}`} className="eidos-settings-control" disabled={busy} value={points[type] ?? ''} onChange={event => setPoints(current => ({ ...current, [type]: event.target.value }))}>
          <option value="">{ui("最后导出的模型")}</option>
          {(job.checkpoints?.[type] ?? []).map((point, index) => <option key={point.path} value={index}>{point.epoch === null ? point.name : ui("第 {0} 轮 · {1}", {"0": point.epoch, "1": point.name})}</option>)}
        </select>
      </SettingsField>)}
    </details>}
    <div className="flex flex-wrap gap-2"><EidosButton disabled={!job || busy || loading} onClick={() => void apply()}>{busy ? ui("正在应用…") : ui("应用所选音色")}</EidosButton><EidosButton disabled={busy || loading} onClick={() => { setLoading(true); setMessage(''); void refresh(); }}>{ui("刷新音色列表")}</EidosButton></div>
    {job && <VoiceDeleteWeights key={job.id} job={job} disabled={busy || loading} onBusy={setBusy} onDeleted={() => { setSelected(''); setMessage(ui("训练权重已删除；录音和校对保留在训练页，可重新训练。")); refresh(); }} />}
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
  </section>;
}
