import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RequestInputError } from '@/lib/api/request-input';
import { trainingActive, type TrainingClip, type TrainingJob } from './training-model';
import { trainingOptions } from './training-options';
import { inspectTrainingEnvironment, launchTrainingWorker, trainingDirectory, voiceInstallationRoot } from './training-runtime';
import { deleteTrainingOutputs } from './training-delete';
const checkId = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new RequestInputError('训练任务 ID 无效');
  return id;
};
interface Options { directory: string; root: string; launch: (directory: string, action: string) => Promise<void> }
export function createTrainingStore(options: Options) {
  const { directory } = options;
  const lock = path.join(directory, 'active.json');
  const file = (id: string) => path.join(directory, checkId(id), 'job.json');
  function settings(value: unknown) {
    try { return trainingOptions(value); }
    catch (error) { throw new RequestInputError(error instanceof Error ? error.message : '训练参数无效'); }
  }
  function save(job: TrainingJob) {
    const target = file(job.id), temp = `${target}.node.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ ...job, updatedAt: Date.now() })); fs.renameSync(temp, target);
  }
  function get(id: string): TrainingJob {
    const target = file(id);
    if (!fs.existsSync(target)) throw new RequestInputError('找不到训练任务', 404);
    const job: TrainingJob = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (trainingActive(job) && Date.now() - job.updatedAt > 5 * 60_000) {
      job.status = 'failed'; job.error = '后台任务已中断，请重试；素材和校对内容已保留'; save(job);
    }
    const progress = path.join(directory, job.id, 'preparation-progress.json');
    if (job.status !== 'training' && job.status !== 'complete' && fs.existsSync(progress)) job.preparation = JSON.parse(fs.readFileSync(progress, 'utf8'));
    return job;
  }
  function assertIdle() {
    fs.mkdirSync(directory, { recursive: true });
    if (fs.existsSync(lock)) {
      const active = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (fs.existsSync(file(active.id)) && trainingActive(get(active.id))) throw new RequestInputError('已有训练任务正在运行，请先完成或取消', 409);
      fs.unlinkSync(lock);
    }
  }
  async function start(job: TrainingJob, action: string) {
    assertIdle();
    try { fs.writeFileSync(lock, JSON.stringify({ id: job.id }), { flag: 'wx' }); }
    catch { throw new RequestInputError('已有训练任务正在启动', 409); }
    const cancel = path.join(directory, job.id, 'cancel');
    if (fs.existsSync(cancel)) fs.unlinkSync(cancel);
    if (action === 'prepare') fs.rmSync(path.join(directory, job.id, 'preparation-progress.json'), { force: true });
    delete job.preparation;
    job.status = action === 'prepare' ? 'preparing' : 'training'; job.error = ''; save(job);
    try { await options.launch(path.join(directory, job.id), action); }
    catch (error) { job.status = 'failed'; job.error = error instanceof Error ? error.message : '后台进程启动失败'; save(job); fs.unlinkSync(lock); throw error; }
    return get(job.id);
  }
  function uploads(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 10) throw new RequestInputError('请导入 1–10 份音频素材');
    let total = 0;
    return value.map((entry: { name: string; audioBase64: string }) => {
      if (!entry || typeof entry.name !== 'string' || typeof entry.audioBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(entry.audioBase64)) throw new RequestInputError('音频内容无效');
      const extension = entry.name.match(/\.(wav|mp3|ogg|m4a|flac)$/i)?.[1].toLowerCase();
      if (!extension) throw new RequestInputError('支持 WAV、MP3、OGG、M4A、FLAC');
      const bytes = Buffer.from(entry.audioBase64, 'base64'); total += bytes.length;
      if (!bytes.length || total > 30 * 1024 * 1024) throw new RequestInputError('素材总大小最多 30 MB', 413);
      return { extension, bytes };
    });
  }
  async function create(input: Record<string, unknown>) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || !['zh', 'en', 'ja'].includes(String(input.language)) || !['v2', 'v2ProPlus'].includes(String(input.version)) || typeof input.autoTranscribe !== 'boolean') throw new RequestInputError('名称、语种或训练版本无效');
    const sources = uploads(input.files);
    const parameters = settings(input.trainingOptions);
    assertIdle();
    const job: TrainingJob = { id: randomUUID(), name: input.name.trim(), language: input.language as string, version: input.version as TrainingJob['version'],
      autoTranscribe: input.autoTranscribe, trainingOptions: parameters, status: 'preparing', stage: '准备素材', clips: [], createdAt: Date.now(), updatedAt: Date.now() };
    const sourceDir = path.join(directory, job.id, 'sources'); fs.mkdirSync(sourceDir, { recursive: true });
    sources.forEach((source, i) => fs.writeFileSync(path.join(sourceDir, `input-${String(i).padStart(2, '0')}.${source.extension}`), source.bytes));
    save(job); return start(job, 'prepare');
  }
  function reviewed(job: TrainingJob, value: unknown, required = true): TrainingClip[] {
    if (!Array.isArray(value) || value.length !== job.clips.length) throw new RequestInputError('校对片段与任务不符');
    const ids = new Set<string>();
    const clips = value.map((v: { id: string; text: string; included: boolean }) => {
      const original = job.clips.find(c => c.id === v?.id);
      if (!original || ids.has(v.id) || typeof v.text !== 'string' || v.text.length > 2000 || /[|\r\n]/.test(v.text) || typeof v.included !== 'boolean') throw new RequestInputError('校对内容无效');
      ids.add(v.id); return { ...original, text: v.text.trim(), included: v.included };
    });
    const retained = clips.filter(c => c.included);
    if (required && (!retained.length || retained.some(c => !c.text) || !retained.some(c => c.duration >= 3 && c.duration <= 10))) throw new RequestInputError('请填写保留片段的台词，并保留至少一段 3–10 秒的参考音频');
    return clips;
  }
  async function action(input: Record<string, unknown>) {
    const job = get(checkId(input.id));
    if (input.action === 'cancel' && trainingActive(job)) { fs.writeFileSync(path.join(directory, job.id, 'cancel'), ''); return job; }
    if (trainingActive(job)) throw new RequestInputError('任务正在运行，请先取消', 409);
    if (input.action === 'delete-weights') {
      if (input.confirmed !== true) throw new RequestInputError('请确认删除训练权重');
      deleteTrainingOutputs(directory, job, save); return get(job.id);
    }
    if (input.action === 'recover' && ['failed', 'cancelled'].includes(job.status) && job.runDirectory) {
      job.stage = '核验已导出权重'; return start(job, 'recover');
    }
    if (input.action === 'save' && ['review', 'failed', 'cancelled'].includes(job.status)) {
      job.trainingOptions = settings(input.trainingOptions ?? job.trainingOptions);
      job.clips = reviewed(job, input.clips, false); save(job); return get(job.id);
    }
    if (input.action === 'prepare' && ['failed', 'cancelled'].includes(job.status)) return start(job, 'prepare');
    if (input.action === 'train' && ['review', 'failed', 'cancelled'].includes(job.status)) {
      job.trainingOptions = settings(input.trainingOptions ?? job.trainingOptions);
      job.clips = reviewed(job, input.clips); save(job); return start(job, 'train');
    }
    throw new RequestInputError('当前阶段不能执行此操作');
  }
  function audio(id: string, clipId: string) {
    const job = get(id), clip = job.clips.find(c => c.id === clipId);
    if (!clip || path.basename(clip.file) !== clip.file) throw new RequestInputError('找不到音频片段', 404);
    const filename = path.join(directory, job.id, 'clips', clip.file);
    if (!fs.existsSync(filename)) throw new RequestInputError('音频片段已丢失', 404);
    return fs.readFileSync(filename);
  }
  return { create, action, get, audio, list: () => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(id => /^[a-f0-9-]{36}$/.test(id) && fs.existsSync(file(id)))
      .map(get).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  } };
}
export function selectedTrainingVoice(job: TrainingJob, query: URLSearchParams): TrainingJob {
  if (!job.result) throw new RequestInputError('音色尚未训练完成');
  const result = { ...job.result };
  for (const type of ['gpt', 'sovits'] as const) {
    const selected = query.get(type);
    if (selected === null || selected === '') continue;
    if (!/^\d+$/.test(selected)) throw new RequestInputError('模型保存点无效');
    const checkpoint = job.checkpoints?.[type][Number(selected)];
    if (!checkpoint) throw new RequestInputError('模型保存点不存在');
    result[type === 'gpt' ? 'gptWeights' : 'sovitsWeights'] = checkpoint.path;
  }
  return { ...job, result };
}
export const trainingStore = () => createTrainingStore({ directory: trainingDirectory(), root: voiceInstallationRoot(), launch: launchTrainingWorker });
export async function checkTrainingPhase(input: Record<string, unknown>) {
  if (input.action !== 'train') return;
  const job = trainingStore().get(checkId(input.id)), environment = await inspectTrainingEnvironment();
  const version = environment.versions.find(v => v.id === job.version);
  if (!version?.ready) throw new RequestInputError(`训练环境缺少：${[...environment.missingModules, ...(version?.missing ?? [])].join('、')}`, 422);
}
