import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('@/lib/game/momoi/training-runtime', () => ({
  trainingDirectory: () => process.env.MOMOI_TRAINING_DIR!, voiceInstallationRoot: () => '/official', launchTrainingWorker: async () => {},
  inspectTrainingEnvironment: async () => ({ python: '/python', ffmpeg: true, versions: [{ id: 'v2', ready: true, missing: [] }], missingModules: [] }),
}));
import { GET, POST, PATCH } from '@/app/api/momoi/training/route';
import { GET as AUDIO } from '@/app/api/momoi/training/audio/route';
const url = 'http://localhost:3000/api/momoi/training';
const request = (body: object, headers = {}) => new Request(url, { method: 'POST', body: JSON.stringify(body), headers });
let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-route-')); vi.stubEnv('MOMOI_TRAINING_DIR', directory); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });
describe('training API', () => {
  it('requires confirmed same-origin management before deleting owned exports and retains the task', async () => {
    const created = await POST(request({ name: '删除测试', version: 'v2', language: 'zh', autoTranscribe: false, files: [{ name: 'a.wav', audioBase64: 'UklGRg==' }] }));
    const { job } = await created.json();
    const run = path.join(directory, job.id, 'run-123'); fs.mkdirSync(run); fs.writeFileSync(path.join(run, 'weights.pth'), 'weights');
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'complete', runDirectory: run }));
    expect((await PATCH(request({ id: job.id, action: 'delete-weights' }))).status).toBe(400);
    expect((await PATCH(request({ id: job.id, action: 'delete-weights', confirmed: true }, { origin: 'https://foreign.example' }))).status).toBe(403);
    expect(fs.existsSync(run)).toBe(true);
    const deleted = await PATCH(request({ id: job.id, action: 'delete-weights', confirmed: true }));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).job.status).toBe('review'); expect(fs.existsSync(run)).toBe(false);
    expect(fs.existsSync(path.join(directory, job.id, 'sources/input-00.wav'))).toBe(true);
  });
  async function audioFixture() {
    const created = await POST(request({ name: '试听', version: 'v2', language: 'zh', autoTranscribe: false, files: [{ name: 'a.wav', audioBase64: 'UklGRg==' }] }));
    const { job } = await created.json();
    // A valid one-second, mono PCM WAV, including its RIFF header.
    const bytes = Buffer.alloc(64044);
    bytes.write('RIFF'); bytes.writeUInt32LE(64036, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(32000, 24); bytes.writeUInt32LE(64000, 28);
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(64000, 40);
    fs.mkdirSync(path.join(directory, job.id, 'clips'));
    fs.writeFileSync(path.join(directory, job.id, 'clips/one.wav'), bytes);
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'review', clips: [{ id: 'one', file: 'one.wav', duration: 1, text: '你好', included: true }] }));
    return `${url}/audio?id=${job.id}&clip=one`;
  }
  it('serves a length-delimited WAV and the two-byte media probe used by WebKit', async () => {
    const audioUrl = await audioFixture();
    const full = await AUDIO(new Request(audioUrl));
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/wav');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('64044');
    expect((await full.arrayBuffer()).byteLength).toBe(64044);
    const probe = await AUDIO(new Request(audioUrl, { headers: { range: 'bytes=0-1' } }));
    expect(probe.status).toBe(206);
    expect(probe.headers.get('content-range')).toBe('bytes 0-1/64044');
    expect(probe.headers.get('content-length')).toBe('2');
    expect(await probe.text()).toBe('RI');
  });
  it.each([
    ['bytes=8-', 'bytes 8-64043/64044', 64036, 'WAVE'],
    ['bytes=-4', 'bytes 64040-64043/64044', 4, '\0\0\0\0'],
    ['bytes=64040-99999', 'bytes 64040-64043/64044', 4, '\0\0\0\0'],
  ])('supports seeking with %s', async (range, contentRange, length, prefix) => {
    const response = await AUDIO(new Request(await audioFixture(), { headers: { range } }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('content-length')).toBe(String(length));
    expect((await response.text()).startsWith(prefix)).toBe(true);
  });
  it.each(['bytes=64044-', 'bytes=10-5', 'bytes=-0'])('rejects an unsatisfiable range %s', async range => {
    const response = await AUDIO(new Request(await audioFixture(), { headers: { range } }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */64044');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });
  it('ignores unsupported multipart ranges without bypassing origin checks', async () => {
    const audioUrl = await audioFixture();
    expect((await AUDIO(new Request(audioUrl, { headers: { range: 'bytes=0-1,4-5' } }))).status).toBe(200);
    const denied = await AUDIO(new Request(audioUrl, { headers: { origin: 'https://foreign.example', range: 'bytes=0-1' } }));
    expect(denied.status).toBe(403);
  });
  it('serves only registered completed exports and rejects forged save points', async () => {
    const created = await POST(request({ name: '甲', version: 'v2', language: 'zh', autoTranscribe: false, files: [{ name: 'a.wav', audioBase64: 'UklGRg==' }] }));
    const { job } = await created.json();
    const latest = path.join(directory, 'latest.ckpt'), sovits = path.join(directory, 'latest.pth'), early = path.join(directory, 'early.ckpt');
    for (const file of [latest, sovits, early]) fs.writeFileSync(file, 'weights');
    const result = { gptWeights: latest, sovitsWeights: sovits, referenceId: 'one', referencePath: '/ref.wav', referenceText: '你好' };
    fs.mkdirSync(path.join(directory, job.id, 'clips'));
    fs.writeFileSync(path.join(directory, job.id, 'clips/one.wav'), 'test-audio');
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'complete', result,
      clips: [{ id: 'one', file: 'one.wav' }], checkpoints: { gpt: [{ name: 'early.ckpt', path: early, epoch: 5 }], sovits: [] } }));
    const response = await GET(new Request(`${url}?view=voice&id=${job.id}&gpt=0`));
    expect(response.status).toBe(200);
    expect((await response.json()).job.result).toMatchObject({ gptWeights: early, sovitsWeights: sovits });
    expect((await GET(new Request(`${url}?view=voice&id=${job.id}&gpt=999`))).status).toBe(400);
    fs.unlinkSync(early);
    const missing = await GET(new Request(`${url}?view=voice&id=${job.id}&gpt=0`));
    expect(missing.status).toBe(422);
    expect((await missing.json()).error).toMatch(/GPT.*文件/);
    expect((await GET(new Request(`${url}?view=voice&id=${job.id}`))).status).toBe(200);
  });
  it('rejects cross-site and oversized uploads before creating a job', async () => {
    expect((await POST(request({}, { origin: 'https://foreign.example' }))).status).toBe(403);
    expect((await POST(request({}, { 'content-length': String(50 * 1024 * 1024) }))).status).toBe(413);
    expect((await POST(request({ files: [] }))).status).toBe(400);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it('creates a durable task, lists it and allows cancellation without accepting forged media paths', async () => {
    const response = await POST(request({ name: '爱丽丝', version: 'v2', language: 'zh', autoTranscribe: false, files: [{ name: 'a.wav', audioBase64: 'UklGRg==' }] }));
    expect(response.status).toBe(202);
    const { job } = await response.json();
    expect((await (await GET(new Request(url))).json()).jobs[0].id).toBe(job.id);
    expect((await PATCH(request({ id: job.id, action: 'cancel' }))).status).toBe(200);
    expect((await AUDIO(new Request(url + '/audio?id=../../etc&clip=passwd'))).status).toBe(400);
    expect((await AUDIO(new Request(url + `/audio?id=${job.id}&clip=../../job.json`))).status).toBe(404);
  });
  it('saves review drafts before training and rejects unreadable labels', async () => {
    const response = await POST(request({ name: '甲', version: 'v2', language: 'zh', autoTranscribe: false, files: [{ name: 'a.wav', audioBase64: 'UklGRg==' }] }));
    const { job } = await response.json();
    fs.writeFileSync(path.join(directory, job.id, 'job.json'), JSON.stringify({ ...job, status: 'review', clips: [{ id: 'one', file: 'one.wav', duration: 5, text: '', included: true }] }));
    expect((await PATCH(request({ id: job.id, action: 'save', clips: [{ id: 'one', text: '校对后的文字', included: true }] }))).status).toBe(200);
    const saved = (await (await GET(new Request(url))).json()).jobs[0];
    expect(saved.clips[0].text).toBe('校对后的文字');
    expect((await PATCH(request({ id: job.id, action: 'train', clips: [{ id: 'one', text: '非法|标注', included: true }] }))).status).toBe(400);
  });
});
