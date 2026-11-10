'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useId } from 'react';
import { SettingsField as EidosField } from '../settings/SettingsField';
import type { TrainingOptions } from '@/lib/game/momoi/training-options';
const control = 'eidos-field w-full rounded-sm border border-current/20 p-2.5 text-sm';
export function VoiceTrainingOptions({ value, onChange, disabled = false, newTask = false }: {
  value: TrainingOptions; onChange: (value: TrainingOptions) => void; disabled?: boolean; newTask?: boolean;
}) {
  const ui = useInterfaceText();
  const id = useId();
  const labelPrefix = newTask ? ui("新任务 · ") : '';
  function set(key: keyof TrainingOptions, next: number | boolean) {
    const options = { ...value, [key]: next };
    if (options.sovitsEpochs % options.sovitsSaveEvery) options.sovitsSaveEvery = 1;
    if (options.gptEpochs % options.gptSaveEvery) options.gptSaveEvery = 1;
    onChange(options);
  }
  return <details className="eidos-audio-options space-y-3">
    <summary className="cursor-pointer text-sm">{newTask ? ui("新任务参数") : ui("训练参数")} · SoVITS {value.sovitsEpochs} {ui("轮 / GPT")}{value.gptEpochs} {ui("轮")}</summary>
    <p className="eidos-audio-caption">{ui("默认 SoVITS 8 轮 / GPT 15 轮。少量素材不宜增加过多轮数；内存不足时减小批大小。")}</p>
    <div className="eidos-audio-options-grid">
      {(['sovits', 'gpt'] as const).map(type => {
        const title = type === 'gpt' ? 'GPT' : 'SoVITS';
        const epochs = type === 'gpt' ? 'gptEpochs' : 'sovitsEpochs';
        const batch = type === 'gpt' ? 'gptBatchSize' : 'sovitsBatchSize';
        const every = type === 'gpt' ? 'gptSaveEvery' : 'sovitsSaveEvery';
        return <fieldset key={type} disabled={disabled} className="min-w-0 space-y-3">
          <EidosField id={`${id}-${epochs}`} label={ui("{0}{1} 训练轮数", {"0": labelPrefix, "1": title})}><input id={`${id}-${epochs}`} type="number" min={type === 'gpt' ? 2 : 1} max={type === 'gpt' ? 50 : 25} step="1" className={control} value={Number.isFinite(value[epochs]) ? value[epochs] : ''} onChange={e => set(epochs, e.target.valueAsNumber)} /></EidosField>
          <EidosField id={`${id}-${batch}`} label={ui("{0}{1} 批大小", {"0": labelPrefix, "1": title})}><input id={`${id}-${batch}`} type="number" min="1" max={type === 'gpt' ? 40 : 64} step="1" className={control} value={Number.isFinite(value[batch]) ? value[batch] : ''} onChange={e => set(batch, e.target.valueAsNumber)} /></EidosField>
          <EidosField id={`${id}-${every}`} label={ui("{0}{1} 保存间隔", {"0": labelPrefix, "1": title})} hint={ui("保留各保存点供训练后试听比较；间隔须整除轮数。")}><select id={`${id}-${every}`} className={control} value={value[every]} onChange={e => set(every, Number(e.target.value))}>{Array.from({ length: Number.isFinite(value[epochs]) ? Math.max(0, Math.min(value[epochs], 50)) : 0 }, (_, i) => i + 1).filter(n => value[epochs] % n === 0).map(n => <option key={n} value={n}>{ui("每")}{n} {ui("轮")}</option>)}</select></EidosField>
        </fieldset>;
      })}
    </div>
    <EidosField id={`${id}-text-rate`} label={ui("{0}SoVITS 文本学习率比例", {"0": labelPrefix})} hint={ui("官方默认 0.4；首次训练可保持默认。")}><input id={`${id}-text-rate`} type="number" min="0.2" max="0.6" step="0.05" disabled={disabled} className={control} value={Number.isFinite(value.textLearningRate) ? value.textLearningRate : ''} onChange={e => set('textLearningRate', e.target.valueAsNumber)} /></EidosField>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={value.dpo} onChange={e => set('dpo', e.target.checked)} />{ui("GPT DPO（官方实验选项，默认关闭）")}</label>
    <EidosField id={`${id}-gpt-workers`} label={ui("{0}GPT 数据加载进程数", {"0": labelPrefix})} hint={ui("默认 1；增加进程会占用更多内存，不一定更快。")}><input id={`${id}-gpt-workers`} type="number" min="1" max="16" step="1" disabled={disabled} className={control} value={value.gptWorkers ?? 1} onChange={e => set('gptWorkers', e.target.valueAsNumber)} /></EidosField>
  </details>;
}
