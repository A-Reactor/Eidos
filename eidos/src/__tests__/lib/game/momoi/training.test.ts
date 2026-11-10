import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrainingStore, selectedTrainingVoice } from '@/lib/game/momoi/training-server';
import { DEFAULT_TRAINING_OPTIONS, trainingOptions } from '@/lib/game/momoi/training-options';
import { trainedVoiceConfig } from '@/lib/game/momoi/training-model';
import { DEFAULT_VOICE_CONFIG, buildVoiceRequest, voiceIdentity } from '@/lib/game/momoi/model';
import { trainedVoiceTargets } from '@/lib/game/momoi/trained-voice-bindings';
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-training-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const input = () => ({ name: '爱丽丝', language: 'zh', version: 'v2', autoTranscribe: false, files: [{ name: '../../unsafe.wav', audioBase64: 'UklGRg==' }] });
const store = () => createTrainingStore({ directory, root: '/official', launch: async () => {} });
describe('local training jobs', () => {
  it('identifies older runs of the same voice when deleting all of its exports', async () => {
    const job = { ...await store().create(input()), runDirectory: '/training/task/run-200' };
    expect(trainedVoiceTargets({ ...DEFAULT_VOICE_CONFIG, speakers: { 旧保存点: { gptWeights: '/training/task/run-100/gpt/voice.ckpt' }, 其他音色: { gptWeights: '/training/other/run-100/gpt/voice.ckpt' } } }, job)).toEqual(['旧保存点']);
  });
  it('deletes only owned training outputs, preserving source audio and review for another training run', async () => {
    const manager = store(), job = await manager.create(input());
    const base = path.join(directory, job.id), run = path.join(base, 'run-123');
    fs.mkdirSync(path.join(run, 'gpt'), { recursive: true }); fs.writeFileSync(path.join(run, 'gpt/voice-e15.ckpt'), 'weights');
    fs.mkdirSync(path.join(base, 'clips')); fs.writeFileSync(path.join(base, 'clips/ref.wav'), 'recording');
    const complete = { ...job, status: 'complete', runDirectory: run, clips: [{ id: 'ref', file: 'ref.wav', text: '你好', duration: 5, included: true }],
      result: { gptWeights: path.join(run, 'gpt/voice-e15.ckpt'), sovitsWeights: path.join(run, 'sovits/voice.pth') } };
    fs.writeFileSync(path.join(base, 'job.json'), JSON.stringify(complete));
    await expect(manager.action({ id: job.id, action: 'delete-weights' })).rejects.toThrow(/确认/);
    const next = await manager.action({ id: job.id, action: 'delete-weights', confirmed: true });
    expect(next.status).toBe('review'); expect(next.result).toBeUndefined();
    expect(fs.existsSync(run)).toBe(false);
    expect(fs.readFileSync(path.join(base, 'clips/ref.wav'), 'utf8')).toBe('recording');
    expect(fs.existsSync(path.join(base, 'sources/input-00.wav'))).toBe(true);
    expect(manager.get(job.id).clips[0].text).toBe('你好');
  });
  it('refuses to delete active jobs and symlinked output directories', async () => {
    const manager = store(), job = await manager.create(input());
    await expect(manager.action({ id: job.id, action: 'delete-weights', confirmed: true })).rejects.toThrow(/运行/);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'base.pth'), 'do not delete');
      fs.symlinkSync(outside, path.join(directory, job.id, 'run-123'));
      fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'complete' }));
      await expect(manager.action({ id: job.id, action: 'delete-weights', confirmed: true })).rejects.toThrow(/目录/);
      expect(fs.readFileSync(path.join(outside, 'base.pth'), 'utf8')).toBe('do not delete');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
  it('validates GPT data-loader workers without changing old saved defaults', () => {
    expect(trainingOptions({ gptWorkers: 4 })).toMatchObject({ gptWorkers: 4 });
    for (const gptWorkers of [0, 17, true, '4']) expect(() => trainingOptions({ gptWorkers })).toThrow(/gptWorkers/);
  });
  it('reads durable child progress and clears the old phase before retrying preparation', async () => {
    const manager = store(), job = await manager.create(input());
    const progress = path.join(directory, job.id, 'preparation-progress.json');
    fs.writeFileSync(progress, JSON.stringify({ phase: 'transcribing', completed: 3, total: 10 }));
    expect(store().list()[0].preparation).toEqual({ phase: 'transcribing', completed: 3, total: 10 });
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'failed' }));
    expect(store().get(job.id).preparation?.completed).toBe(3);
    await manager.action({ id: job.id, action: 'prepare' });
    expect(fs.existsSync(progress)).toBe(false);
    expect(manager.get(job.id).preparation).toBeUndefined();
  });
  it('stores uploads under generated names and survives a manager reload', async () => {
    const manager = store(), job = await manager.create(input());
    expect(job.status).toBe('preparing');
    expect(fs.readdirSync(path.join(directory, job.id, 'sources'))).toEqual(['input-00.wav']);
    expect(store().list()[0].name).toBe('爱丽丝');
    expect(fs.existsSync(path.join(directory, 'unsafe.wav'))).toBe(false);
    await expect(manager.create(input())).rejects.toThrow(/任务/);
    expect(manager.list()).toHaveLength(1);
  });
  it('rejects malformed uploads, versions and forged task identifiers', async () => {
    const manager = store();
    for (const value of [{ ...input(), version: 'v5' }, { ...input(), files: [] }, { ...input(), files: [{ name: 'a.exe', audioBase64: 'abc' }] }]) {
      await expect(manager.create(value)).rejects.toThrow();
    }
    expect(() => manager.get('../../etc')).toThrow();
  });
  it('cancels via a durable marker and refuses to replace active transcripts', async () => {
    const manager = store(), job = await manager.create(input());
    await manager.action({ id: job.id, action: 'cancel' });
    expect(fs.existsSync(path.join(directory, job.id, 'cancel'))).toBe(true);
    await expect(manager.action({ id: job.id, action: 'train', clips: [] })).rejects.toThrow();
  });
  it('accepts only known reviewed clips and keeps edits for training retries', async () => {
    const manager = store(), job = await manager.create(input());
    const filename = path.join(directory, job.id, 'job.json');
    fs.writeFileSync(filename, JSON.stringify({ ...job, status: 'review', clips: [{ id: 'clip-0', file: 'input-00-000.wav', duration: 5, text: '', included: true }] }));
    fs.unlinkSync(path.join(directory, 'active.json'));
    await expect(manager.action({ id: job.id, action: 'train', clips: [{ id: 'forged', text: '你好', included: true }] })).rejects.toThrow();
    await manager.action({ id: job.id, action: 'train', clips: [{ id: 'clip-0', text: '你好。', included: true }] });
    expect(manager.get(job.id).clips[0].text).toBe('你好。');
    expect(manager.get(job.id).status).toBe('training');
  });
  it('validates and persists official training controls across save, reload and train', async () => {
    const manager = store(), job = await manager.create(input());
    const clips = [{ id: 'one', file: 'one.wav', duration: 5, text: '你好', included: true }];
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'review', clips }));
    fs.unlinkSync(path.join(directory, 'active.json'));
    const parameters = { ...DEFAULT_TRAINING_OPTIONS, sovitsEpochs: 12, gptEpochs: 20, sovitsBatchSize: 2, gptBatchSize: 3, textLearningRate: 0.3, dpo: true };
    await manager.action({ id: job.id, action: 'save', clips, trainingOptions: parameters });
    expect(store().get(job.id).trainingOptions).toEqual(parameters);
    await expect(manager.action({ id: job.id, action: 'train', clips, trainingOptions: { ...parameters, gptEpochs: 0 } })).rejects.toThrow(/gptEpochs/);
    expect(manager.get(job.id).status).toBe('review');
    await store().action({ id: job.id, action: 'train', clips });
    expect(manager.get(job.id).trainingOptions).toEqual(parameters);
  });
  it('rejects nonnumeric, excessive and non-final-export training options', () => {
    for (const value of [{ gptEpochs: '15' }, { sovitsEpochs: 26 }, { gptBatchSize: 0 }, { gptEpochs: 16 }, { textLearningRate: NaN }, { dpo: 'true' }, []]) expect(() => trainingOptions(value)).toThrow();
    expect(trainingOptions()).toEqual(DEFAULT_TRAINING_OPTIONS);
  });
  it('selects only registered export points without changing the completed task', async () => {
    const job = await store().create(input());
    const complete = { ...job, status: 'complete' as const, result: { gptWeights: '/last.ckpt', sovitsWeights: '/last.pth', referencePath: '/ref.wav', referenceId: 'one', referenceText: '你好' },
      checkpoints: { gpt: [{ name: 'voice-e5.ckpt', path: '/early.ckpt', epoch: 5 }], sovits: [{ name: 'voice_e4_s4.pth', path: '/early.pth', epoch: 4 }] } };
    const result = selectedTrainingVoice(complete, new URLSearchParams({ gpt: '0', sovits: '0' }));
    expect(result.result).toMatchObject({ gptWeights: '/early.ckpt', sovitsWeights: '/early.pth' });
    expect(complete.result.gptWeights).toBe('/last.ckpt');
    for (const gpt of ['-1', '9', '/etc/passwd']) expect(() => selectedTrainingVoice(complete, new URLSearchParams({ gpt }))).toThrow();
  });
  it('does not expose arbitrary files through clip playback', async () => {
    const manager = store(), job = await manager.create(input());
    expect(() => manager.audio(job.id, '../../job.json')).toThrow();
  });
  it('applies a completed voice to one character and separates its audio cache', async () => {
    const manager = store(), job = await manager.create(input());
    const result = { gptWeights: '/trained/gpt.ckpt', sovitsWeights: '/trained/sovits.pth', referenceText: '你好', referencePath: '/trained/ref.wav', referenceId: 'ref' };
    const trained = trainedVoiceConfig(DEFAULT_VOICE_CONFIG, { ...job, status: 'complete', result }, 'UklGRg==', '爱丽丝');
    expect(trained.provider).toBe('legacy');
    expect(trained.speakers.爱丽丝).toMatchObject({ gptWeights: '/trained/gpt.ckpt', sovitsWeights: '/trained/sovits.pth', referenceAudio: 'UklGRg==' });
    const segment = { type: 'dialogue' as const, text: '你好', speaker: '爱丽丝' };
    const original = buildVoiceRequest(segment, DEFAULT_VOICE_CONFIG)!;
    expect(await voiceIdentity(buildVoiceRequest(segment, trained)!)).not.toBe(await voiceIdentity(original));
  });
  it('keeps dialogue language while using a foreign reference for one character', async () => {
    const job = await store().create(input());
    const result = { gptWeights: '/gpt.ckpt', sovitsWeights: '/sovits.pth', referenceText: 'Hello', referencePath: '/ref.wav', referenceId: 'ref' };
    const config = trainedVoiceConfig(DEFAULT_VOICE_CONFIG, { ...job, language: 'en', status: 'complete', result }, 'UklGRg==', '爱丽丝');
    expect(config.language).toBe('zh');
    const request = buildVoiceRequest({ type: 'dialogue', speaker: '爱丽丝', text: '你好' }, config)!;
    expect(request.referenceLanguage).toBe('en');
    expect(request.config.language).toBe('zh');
    expect(buildVoiceRequest({ type: 'dialogue', speaker: '船夫', text: '你好' }, config)!.referenceLanguage).toBeUndefined();
  });
});
