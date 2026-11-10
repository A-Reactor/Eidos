'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from 'react';
import { EidosButton } from '@/components/ui/EidosScreen';
import { FileImportCard } from '@/components/ui/FileImportCard';
import { SettingsField as EidosField } from '../settings/SettingsField';
import { useGameStore } from '@/store/game-store';
import { buildVoiceRequest } from '@/lib/game/momoi/model';
import { generateVoiceAudio } from '@/lib/game/momoi/client-generation';
import { trainedVoiceConfig, trainingActive, type TrainingClip, type TrainingEnvironment, type TrainingJob, type PreparationProgress } from '@/lib/game/momoi/training-model';
import { DEFAULT_TRAINING_OPTIONS, trainingOptions, type TrainingOptions } from '@/lib/game/momoi/training-options';
import { formatTrainingLog } from '@/lib/game/momoi/training-log';
import { VoiceTrainingOptions } from './VoiceTrainingOptions';
import { VoiceTarget } from './VoiceTarget';
import { VoicePreparationProgress } from './VoicePreparationProgress';
import { loadTrainedVoice } from '@/lib/game/momoi/trained-voice-client';
import { VoiceTrainingProgress } from './VoiceTrainingProgress';
import { VoiceDeleteWeights } from './VoiceDeleteWeights';
import { TRAINING_JOBS_CHANGED } from '@/lib/game/momoi/trained-voice-bindings';
const api = '/api/momoi/training';
const control = 'eidos-field w-full rounded-sm border border-current/20 p-2.5 text-sm';
const labels = { preparing: '准备素材', review: '校对台词', training: '训练中', complete: '训练完成', failed: '任务失败', cancelled: '已取消' };
async function json(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '训练服务请求失败');
  return value;
}
function ClipReview({ clips, jobId, onChange }: { clips: TrainingClip[]; jobId: string; onChange: (index: number, value: Partial<TrainingClip>) => void }) {
  const ui = useInterfaceText();
  return <section className="eidos-audio-block" aria-label={ui("台词校对")}>
    <header className="eidos-audio-block-heading"><h3>{ui("逐段校对")}</h3><span>{clips.filter(clip => clip.included).length} / {clips.length} {ui("段保留")}</span></header>
    <div className="eidos-audio-clips">{clips.map((clip, index) => <details key={clip.id} className="eidos-audio-clip" open={index === 0}>
      <summary><span className="eidos-audio-clip-heading">{ui("片段")}{index + 1}<small>{clip.duration.toFixed(1)} {ui("秒 ·")}{clip.included ? ui("已保留") : ui("已排除")}</small></span><span className="eidos-audio-clip-preview">{clip.text || ui("待填写台词")}</span></summary>
      <div className="eidos-audio-clip-body">
        <label className="flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={clip.included} onChange={event => onChange(index, { included: event.target.checked })} />{ui("保留片段")}{index + 1}</label>
        <audio className="w-full max-w-full" controls preload="none" src={`${api}/audio?id=${encodeURIComponent(jobId)}&clip=${encodeURIComponent(clip.id)}`} aria-label={ui("试听片段 {0}", {"0": index + 1})} />
        <textarea aria-label={ui("片段 {0} 台词", {"0": index + 1})} className={control} value={clip.text} maxLength={2000} onChange={event => onChange(index, { text: event.target.value })} />
      </div>
    </details>)}</div>
  </section>;
}
export function VoiceTrainingWorkspace({ speaker, onSpeakerChange, onModels, active: visible = true }: { speaker: string; onSpeakerChange?: (speaker: string) => void; onModels?: () => void; active?: boolean }) {
  const ui = useInterfaceText();
  const [environment, setEnvironment] = useState<TrainingEnvironment | null>(null);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selected, setSelected] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('zh');
  const [version, setVersion] = useState('v2ProPlus');
  const [files, setFiles] = useState<File[]>([]);
  const [automatic, setAutomatic] = useState(true);
  const [newOptions, setNewOptions] = useState(DEFAULT_TRAINING_OPTIONS);
  const [parameters, setParameters] = useState<Record<string, TrainingOptions>>({});
  const [checkpoints, setCheckpoints] = useState<Record<string, { gpt?: string; sovits?: string }>>({});
  const [edits, setEdits] = useState<Record<string, TrainingClip[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [importProgress, setImportProgress] = useState<PreparationProgress | null>(null);
  const mounted = useRef(true), audio = useRef<HTMLAudioElement | null>(null), abort = useRef<AbortController | null>(null);
  const target = useRef(speaker);
  useEffect(() => { target.current = speaker; }, [speaker]);
  const container = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const newTask = creating || !jobs.length;
  const job = newTask ? undefined : jobs.find(j => j.id === selected) ?? jobs[0];
  const clips = job ? edits[job.id] ?? job.clips : [];
  const active = jobs.some(trainingActive);
  const step = !job || job.status === 'preparing' ? 0 : job.status === 'review' ? 1 : job.status === 'training' ? 2 : job.status === 'complete' ? 3 : -1;
  const trainingReady = environment?.versions.find(v => v.id === (job?.version ?? version))?.ready;
  useEffect(() => {
    mounted.current = true;
    const panel = container.current;
    void json(`${api}?view=environment`).then(value => { if (mounted.current) setEnvironment(value); }).catch(error => { if (mounted.current) setMessage(error.message); });
    async function refresh() {
      try { const value = await json(api); if (mounted.current) setJobs(value.jobs); }
      catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : ui("任务读取失败")); }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const changed = () => void refresh(); window.addEventListener(TRAINING_JOBS_CHANGED, changed);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener(TRAINING_JOBS_CHANGED, changed); abort.current?.abort(); audio.current?.pause(); panel?.querySelectorAll('audio').forEach(element => element.pause()); };
  }, [ui]);
  useEffect(() => {
    if (visible) return;
    abort.current?.abort(); audio.current?.pause();
    container.current?.querySelectorAll('audio').forEach(element => element.pause());
  }, [visible]);
  useEffect(() => {
    if (creating && visible) nameInput.current?.focus();
  }, [creating, visible]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current && !(error instanceof Error && error.name === 'AbortError')) setMessage(error instanceof Error ? error.message : ui("操作失败")); }
    finally { if (mounted.current) setBusy(false); }
  }
  function selectTask(id?: string) {
    abort.current?.abort(); audio.current?.pause();
    container.current?.querySelectorAll('audio').forEach(element => element.pause());
    setCreating(!id); if (id) setSelected(id);
    setMessage('');
  }
  function updateJob(next: TrainingJob) {
    if (!mounted.current) return;
    setJobs(current => [next, ...current.filter(j => j.id !== next.id)]); setSelected(next.id); setCreating(false);
  }
  async function command(action: string) {
    if (!job) return;
    const options = ['train', 'save'].includes(action) ? trainingOptions(parameters[job.id] ?? job.trainingOptions) : undefined;
    const value = await json(api, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: job.id, action, clips, trainingOptions: options }) });
    updateJob(value.job);
    if (action === 'save') setMessage(ui("校对内容已保存"));
    if (action === 'cancel') setMessage(ui("正在取消后台任务，素材与校对内容会保留"));
  }
  async function importFiles() {
    if (!name.trim() || !files.length) throw new Error(ui("请填写音色名称并导入音频"));
    const options = trainingOptions(newOptions);
    if (files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) throw new Error(ui("最多 10 份素材，总大小不超过 30 MB"));
    const loaded = files.map(() => 0), total = files.reduce((sum, file) => sum + file.size, 0);
    let reading = true;
    const report = () => { if (mounted.current && reading) setImportProgress({ phase: 'reading', completed: loaded.reduce((sum, size) => sum + size, 0), total }); };
    report();
    try {
      const encoded = await Promise.all(files.map((file, index) => new Promise<{ name: string; audioBase64: string }>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error(ui("素材读取失败")));
        reader.onprogress = event => { loaded[index] = Math.min(file.size, event.loaded); report(); };
        reader.onload = () => { loaded[index] = file.size; report(); resolve({ name: file.name, audioBase64: String(reader.result).split(',')[1] }); };
        reader.readAsDataURL(file);
      })));
      if (mounted.current) setImportProgress({ phase: 'submitting' });
      const value = await json(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, language, version, autoTranscribe: automatic, files: encoded, trainingOptions: options }) });
      if (!mounted.current) return;
      updateJob(value.job); setFiles([]); setName('');
      if (fileInput.current) fileInput.current.value = '';
    } finally { reading = false; if (mounted.current) setImportProgress(null); }
  }
  async function result(signal?: AbortSignal) {
    return loadTrainedVoice(job!.id, checkpoints[job!.id], signal);
  }
  async function apply() {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    const current = useGameStore.getState().voiceConfig;
    const { job: complete, referenceAudio } = await result(controller.signal);
    if (!mounted.current || controller.signal.aborted || target.current !== speaker) return;
    if (useGameStore.getState().voiceConfig !== current) throw new Error(ui("配置已更改，请重新应用训练音色"));
    useGameStore.getState().setVoiceConfig(trainedVoiceConfig(current, complete, referenceAudio, speaker));
    setMessage(speaker ? ui("已应用到「{0}」。可在“模型与音色”查看配置并试听；对话语音开关在“播放与语言”。", {"0": speaker}) : ui("已设为默认音色。可在“模型与音色”查看配置并试听；对话语音开关在“播放与语言”。"));
  }
  async function preview() {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller; audio.current?.pause();
    const { job: complete, referenceAudio } = await result(controller.signal);
    if (!mounted.current || controller.signal.aborted) return;
    const state = useGameStore.getState();
    const config = trainedVoiceConfig(state.voiceConfig, complete, referenceAudio, '');
    const sample = complete.language === 'en' ? 'Hello. Let us continue our story together.' : complete.language === 'ja' ? ui("こんにちは。一緒に物語の続きを始めましょう。") : ui("你好，这是训练后的音色。我们继续这个世界的故事吧。");
    const request = buildVoiceRequest({ type: 'dialogue', speaker: ui("训练试听"), text: sample }, { ...config, material: 'original', language: complete.language, speakers: {} })!;
    setMessage(ui("正在准备本地服务并生成试听，首次加载可能需要较长时间…"));
    const data = await generateVoiceAudio({ ...request, worldId: state.currentWorld?.id || 'voice-training' }, controller.signal, () => {});
    if (!mounted.current || controller.signal.aborted) return;
    const player = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`); audio.current = player;
    player.volume = useGameStore.getState().momoiSettings.volume; await player.play(); setMessage(ui("正在播放训练音色"));
  }
  function edit(index: number, value: Partial<TrainingClip>) {
    if (job) setEdits(current => ({ ...current, [job.id]: clips.map((clip, i) => i === index ? { ...clip, ...value } : clip) }));
  }
  return <div ref={container} className="eidos-audio-training space-y-4">
    {jobs.length > 0 && <div className="eidos-audio-task-toolbar">
      <div className="min-w-0 flex-1"><EidosField id="training-job" label={ui("已有训练任务")}><select id="training-job" value={newTask ? '' : job?.id ?? ''} disabled={busy} className={control} onChange={event => selectTask(event.target.value)}>
        {newTask && <option value="">{ui("正在新建音色 · 可切回已有任务")}</option>}
        {jobs.map(task => <option key={task.id} value={task.id}>{task.name} · {task.version} · {ui(labels[task.status])}</option>)}
      </select></EidosField></div>
      <EidosButton disabled={busy} onClick={() => selectTask(newTask ? jobs.find(task => task.id === selected)?.id ?? jobs[0].id : undefined)}>{newTask ? ui("返回已有任务") : ui("训练另一个音色")}</EidosButton>
    </div>}
    <div className="eidos-audio-sticky"><ol className="eidos-audio-steps" aria-label={ui("训练流程")}>{[ui("导入录音"), ui("校对台词"), ui("训练模型"), ui("试听并应用")].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol></div>
    {onSpeakerChange && <VoiceTarget speaker={speaker} onChange={onSpeakerChange} training disabled={busy} />}

    {!newTask && <VoicePreparationProgress job={job} />}
    {job && <div className="space-y-4">
      <p role="status" className="eidos-audio-job-status"><strong>{ui(labels[job.status])}</strong><span>{ui(job.stage)}{job.epoch !== undefined && job.status === 'training' ? ` · Epoch ${job.epoch}${job.epochTotal ? ` / ${job.epochTotal}` : ''}` : ''}</span></p>
      <VoiceTrainingProgress job={job} />
      <VoiceTrainingOptions value={parameters[job.id] ?? job.trainingOptions ?? DEFAULT_TRAINING_OPTIONS} onChange={value => setParameters(current => ({ ...current, [job.id]: value }))} disabled={busy || trainingActive(job) || job.status === 'complete'} />
      {job.error && <p role="alert" className="text-xs leading-6">{job.error}</p>}
      {job.warning && <p role="status" className="eidos-audio-notice">{job.warning}</p>}
      {job.duration !== undefined && <p className="eidos-audio-caption">{ui("素材共")}{Math.round(job.duration)} {ui("秒")}{job.duration < 60 ? ui(" · 素材较短，可先尝试。") : ui(" · 训练前请逐句校对。")}</p>}
      {!trainingActive(job) && job.status !== 'complete' && clips.length > 0 && <ClipReview clips={clips} jobId={job.id} onChange={edit} />}
      {!trainingActive(job) && job.status !== 'complete' && clips.length > 0 && <>
        <p className="eidos-audio-caption">{ui("离开前请保存校对；开始训练会同时保存。")}</p>
        {!trainingReady && <p role="status" className="text-xs leading-6">{ui("训练底模或依赖尚未齐全，请展开“本地环境”查看缺失项。素材可以先校对和保存。")}</p>}
        <div className="eidos-audio-review-actions"><EidosButton disabled={busy} onClick={() => void run(() => command('save'))}>{ui("保存校对")}</EidosButton><EidosButton disabled={busy || active || !trainingReady} onClick={() => void run(() => command('train'))}>{job.status === 'review' ? ui("开始训练") : ui("重新训练")}</EidosButton></div>
      </>}
      {trainingActive(job) && <EidosButton disabled={busy} onClick={() => void run(() => command('cancel'))}>{ui("取消后台任务")}</EidosButton>}
      {['failed', 'cancelled'].includes(job.status) && <EidosButton disabled={busy || active} onClick={() => void run(() => command('prepare'))}>{ui("重新处理素材")}</EidosButton>}
      {['failed', 'cancelled'].includes(job.status) && job.runDirectory && <EidosButton disabled={busy || active} onClick={() => void run(() => command('recover'))}>{ui("核验并恢复成品")}</EidosButton>}
      {job.status === 'complete' && <>
        {job.checkpoints && <details><summary>{ui("选择模型保存点")}</summary><p className="eidos-audio-caption">{ui("默认使用最后导出的模型，也可比较较早的保存点。")}</p><div className="eidos-audio-form-grid">{(['gpt', 'sovits'] as const).map(type => <EidosField key={type} id={`checkpoint-${type}`} label={ui("{0} 模型保存点", {"0": type === 'gpt' ? 'GPT' : 'SoVITS'})}><select id={`checkpoint-${type}`} className={control} value={checkpoints[job.id]?.[type] ?? ''} disabled={busy} onChange={e => { audio.current?.pause(); const value = e.target.value; setCheckpoints(current => ({ ...current, [job.id]: { ...current[job.id], [type]: value } })); }}>{[<option key="latest" value="">{ui("最后导出的模型")}</option>, ...job.checkpoints![type].map((point, index) => <option key={point.name} value={String(index)}>{point.epoch === null ? point.name : ui("第 {0} 轮 · {1}", {"0": point.epoch, "1": point.name})}</option>)]}</select></EidosField>)}</div></details>}
        <div className="flex flex-wrap gap-2"><EidosButton disabled={busy} onClick={() => void run(preview)}>{ui("试听训练音色")}</EidosButton><EidosButton disabled={busy} onClick={() => void run(apply)}>{speaker ? ui("应用到「{0}」", {"0": speaker}) : ui("设为默认音色")}</EidosButton></div>
        {onModels && <EidosButton onClick={onModels}>{ui("前往模型与音色")}</EidosButton>}
      </>}
      {job.log && <details><summary className="cursor-pointer text-xs">{ui("查看训练日志")}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{formatTrainingLog(job.log)}</pre></details>}
      {!trainingActive(job) && (job.result || job.runDirectory || job.weightsCleanupPending) && <VoiceDeleteWeights key={job.id} job={job} disabled={busy} onBusy={setBusy} onDeleted={updateJob} />}
    </div>}
    <section aria-label={ui("新建音色")} className="eidos-audio-block space-y-3" hidden={!newTask}>
      <h3>{ui("新建音色")}</h3>
      <p className="eidos-audio-caption">{ui("每次创建独立任务，保留已有音色。")}</p>
      {active && <p role="status" className="text-xs leading-6">{ui("已有任务正在处理，可以先填写信息，等待任务结束后再导入。")}</p>}
      <EidosField id="training-name" label={ui("新音色名称")}><input id="training-name" ref={nameInput} className={control} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></EidosField>
      <div className="eidos-audio-form-grid">
      <EidosField id="training-version" label={ui("训练底模")}><select id="training-version" className={control} value={version} onChange={e => setVersion(e.target.value)}><option value="v2">v2</option><option value="v2ProPlus">v2ProPlus</option></select></EidosField>
      <EidosField id="training-language" label={ui("素材语言")}><select id="training-language" className={control} value={language} onChange={e => setLanguage(e.target.value)}><option value="zh">{ui("中文")}</option><option value="en">{ui("英语")}</option><option value="ja">{ui("日语")}</option></select></EidosField>
      </div>
      <FileImportCard label={ui("导入训练录音")} inputLabel={ui("训练录音")} inputRef={fileInput} heading={ui("训练录音")} description={ui("拖入录音，或点击选择文件")} hint={ui("单人、无伴奏 · 最多 10 份 / 30 MB · 单份最长 15 分钟")}
        multiple accept=".wav,.mp3,.m4a,.ogg,.flac" disabled={busy || active} onFiles={async selected => { setFiles(selected); }} />
      {files.length > 0 && <p role="status" className="eidos-import-selection">{ui("已选")}{files.length} {ui("份素材 ·")}{files.map(file => file.name).join(ui("、"))}</p>}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} />{ui("自动转写台词（仍需人工校对）")}</label>
      {automatic && environment && !(environment.asr[language === 'zh' ? 'funasr' : 'faster_whisper']) && <p className="text-xs leading-6">{ui("缺少")}{language === 'zh' ? ' FunASR' : ' Faster Whisper'}{ui("；请安装后重试，或关闭自动转写后手动填写台词。")}</p>}
      <VoiceTrainingOptions value={newOptions} onChange={setNewOptions} disabled={busy || active} newTask />
      <VoicePreparationProgress progress={importProgress} />
      {environment && !environment.ffmpeg && <p role="alert" className="eidos-audio-notice">{ui("缺少 FFmpeg，请先补齐本地环境。")}</p>}
      <EidosButton disabled={busy || active || !files.length || !name.trim() || !environment?.ffmpeg} onClick={() => void run(importFiles)}>{ui("导入并处理素材")}</EidosButton>
    </section>
    {job && <EidosButton onClick={() => { abort.current?.abort(); audio.current?.pause(); container.current?.querySelectorAll('audio').forEach(element => element.pause()); }}>{ui("停止试听")}</EidosButton>}
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
    <div className="eidos-audio-support">
    <details><summary>{ui("素材与处理说明")}</summary><p className="eidos-audio-caption">{ui("建议使用一分钟左右的单人、无伴奏录音。素材在本机服务处理，首次转写可能下载模型。后台任务离开页面后继续，训练完成后需手动应用音色。")}</p></details>
    {environment && <details className="space-y-2"><summary>{ui("本地环境 · 默认")}{environment.configuredModel}</summary>
      <p className="break-all text-xs leading-6">Python：{environment.python}<br />GPT-SoVITS：{environment.root}<br />{environment.mac ? ui("Mac 训练使用 CPU，可能耗时较长。") : ui("有 CUDA 时使用 GPU，否则使用 CPU。")}</p>
      {environment.versions.map(v => <p key={v.id} className="break-all text-xs leading-6">{v.id}：{v.ready ? ui("训练文件齐全") : ui("缺少 {0}", {"0": [...environment.missingModules, ...v.missing].join(ui("、"))})}</p>)}
      {!environment.ffmpeg && <p role="alert">{ui("缺少 FFmpeg，暂不能处理素材。")}</p>}
      <p className="eidos-audio-caption">{ui("通过 MOMOI_PYTHON 指定 Python，模型文件按官方目录放置。")}</p>
      <a className="underline text-xs" href="https://github.com/RVC-Boss/GPT-SoVITS/blob/main/docs/cn/README.md" target="_blank" rel="noreferrer">{ui("官方环境与模型安装说明")}</a>
      <EidosButton onClick={() => void run(async () => setEnvironment(await json(`${api}?view=environment`)))}>{ui("重新检查环境")}</EidosButton>
    </details>}
    </div>
  </div>;
}
