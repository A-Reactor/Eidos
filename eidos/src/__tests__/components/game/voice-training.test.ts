// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceTrainingWorkspace } from '@/components/game/momoi/VoiceTraining';
import { useGameStore } from '@/store/game-store';
import { DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('embedded voice training', () => {
  it('shows real GPT batches and cumulative stage time while the redirected log contains no progress', async () => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('environment') ? { versions: [], asr: {} } : { jobs: [{ id: 'gpt', name: '训练中', version: 'v2', language: 'zh', status: 'training', stage: '训练 GPT', clips: [],
      stageElapsedSeconds: 610, trainingProgress: { phase: 'gpt', state: 'training', epoch: 5, epochs: 15, completedEpochs: 4, batch: 48, batches: 96, elapsedSeconds: 610 }, log: 'dataset.__len__(): 96' }] }));
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '' }));
    const progress = await screen.findByRole('progressbar', { name: 'GPT 训练进度' });
    expect(progress.getAttribute('value')).toBe('30');
    expect(screen.getByText(/48 \/ 96 批次/)).toBeTruthy();
    expect(screen.getByText(/本阶段累计.*10 分 10 秒/)).toBeTruthy();
  });
  it.each([
    ['warnings and tracebacks', '\x1b[32m模型下载 5%\x1b[0m\r模型下载 50%\r模型下载 100%\x1b[K\nWARNING: 请检查素材\nEpoch 1: 1/98\rEpoch 1: 98/98\nTraceback (most recent call last):\n  File "train.py", line 4\nValueError: example', '模型下载 100%\nWARNING: 请检查素材\nEpoch 1: 98/98\nTraceback (most recent call last):\n  File "train.py", line 4\nValueError: example'],
    ['Windows line endings', 'INFO: start\r\n下载 1%\r下载 9%\r\nINFO: done\r\n', 'INFO: start\n下载 9%\nINFO: done\n'],
    ['an unfinished live update', 'Epoch 1: 1/98\rEpoch 1: 2/98\r', 'Epoch 1: 2/98'],
  ])('replaces progress updates while preserving %s', async (_name, log, expected) => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('environment') ? { versions: [], asr: {} } : { jobs: [{ id: 'log', name: '日志', version: 'v2ProPlus', language: 'zh', status: 'failed', stage: '训练 SoVITS', clips: [], log }] }));
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '' }));
    const summary = await screen.findByText('查看训练日志');
    const output = summary.parentElement!.querySelector('pre')!;
    expect(output.textContent).toBe(expected);
  });
  it('shows editable training controls before the first import and submits them with the new task', async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.includes('environment')) return Response.json({ root: '/official', python: '/python', mac: true, ffmpeg: true, configuredModel: 'v2', missingModules: [], asr: { funasr: true }, versions: [{ id: 'v2ProPlus', ready: true, missing: [] }] });
      if (options?.method === 'POST') {
        submitted = JSON.parse(String(options.body));
        return Response.json({ job: { id: 'new', name: '新音色', version: 'v2ProPlus', language: 'zh', status: 'preparing', clips: [], trainingOptions: submitted!.trainingOptions } });
      }
      return Response.json({ jobs: [] });
    });
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '' }));
    const epochs = await screen.findByLabelText('新任务 · SoVITS 训练轮数');
    expect((epochs.closest('details') as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(screen.getByText(/新任务参数 · SoVITS/));
    expect((epochs.closest('details') as HTMLDetailsElement).open).toBe(true);
    fireEvent.change(epochs, { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('新任务 · GPT 训练轮数'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('新任务 · GPT 数据加载进程数'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('新音色名称'), { target: { value: '新音色' } });
    fireEvent.drop(screen.getByRole('button', { name: '导入训练录音' }), { dataTransfer: { files: [new File(['RIFF'], 'recording.wav', { type: 'audio/wav' }), new File(['ID3'], 'second.mp3', { type: 'audio/mpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: '导入并处理素材' }));
    await waitFor(() => expect(submitted).toMatchObject({ version: 'v2ProPlus', trainingOptions: { sovitsEpochs: 12, gptEpochs: 20, gptWorkers: 4 }, files: [{ name: 'recording.wav' }, { name: 'second.mp3' }] }));
  });
  it('shows submission progress beside the import action and hands off to durable worker progress', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.includes('environment')) return Response.json({ root: '/official', python: '/python', ffmpeg: true, versions: [], asr: {} });
      if (options?.method === 'POST') return new Promise<Response>(resolve => { finish = resolve; });
      return Response.json({ jobs: [] });
    });
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '' }));
    fireEvent.change(await screen.findByLabelText('新音色名称'), { target: { value: '素材进度' } });
    fireEvent.change(screen.getByLabelText('训练录音'), { target: { files: [new File(['RIFF'], 'recording.wav', { type: 'audio/wav' })] } });
    fireEvent.click(screen.getByRole('button', { name: '导入并处理素材' }));
    await screen.findByText('提交素材');
    expect(screen.getByRole('progressbar', { name: '素材处理进度' }).hasAttribute('value')).toBe(false);
    expect((screen.getByRole('button', { name: '导入并处理素材' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(Response.json({ job: { id: 'preparing', name: '素材进度', status: 'preparing', stage: '切分音频', clips: [],
      preparation: { phase: 'slicing', completed: 1, total: 2 } } })); });
    expect(screen.queryByText('提交素材')).toBeNull();
    expect(screen.getByRole('progressbar', { name: '素材处理进度' }).getAttribute('value')).toBe('50');
    expect(screen.getByText(/1 \/ 2 份录音/)).toBeTruthy();
  });
  it('starts another voice from a completed task, preserves drafts when switching back, and keeps the original model', async () => {
    const old = { id: 'old', name: '已有音色', version: 'v2ProPlus', language: 'ja', status: 'complete', stage: '完成', clips: [],
      checkpoints: { gpt: [{ name: 'old-e5.ckpt', path: '/old.ckpt', epoch: 5 }], sovits: [] } };
    let jobs: object[] = [old];
    let submitted: Record<string, unknown> | undefined;
    const actions: string[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.includes('environment')) return Response.json({ root: '/official', python: '/python', ffmpeg: true, configuredModel: 'v2', missingModules: [], asr: { funasr: true, faster_whisper: true }, versions: [{ id: 'v2ProPlus', ready: true, missing: [] }] });
      if (options?.method) actions.push(options.method);
      if (options?.method === 'POST') {
        submitted = JSON.parse(String(options.body));
        const next = { id: 'new', name: submitted!.name, language: submitted!.language, version: 'v2ProPlus', status: 'preparing', clips: [] };
        jobs = [next, old];
        return Response.json({ job: next });
      }
      return Response.json({ jobs });
    });
    useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, gptWeights: '/applied.ckpt', sovitsWeights: '/applied.pth' });
    const currentVoice = useGameStore.getState().voiceConfig;
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '' }));
    fireEvent.change(await screen.findByLabelText('GPT 模型保存点'), { target: { value: '0' } });
    const create = screen.getByRole('button', { name: '训练另一个音色' });
    expect(create.closest('details')).toBeNull();
    fireEvent.click(create);
    expect(screen.queryByRole('button', { name: '设为默认音色' })).toBeNull();
    const name = screen.getByRole('textbox', { name: '新音色名称' });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: '第二个音色' } });
    fireEvent.change(screen.getByLabelText('素材语言'), { target: { value: 'ja' } });
    fireEvent.click(screen.getByText(/新任务参数 · SoVITS/));
    fireEvent.change(screen.getByLabelText('新任务 · SoVITS 训练轮数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('训练录音'), { target: { files: [new File(['RIFF'], 'second.wav', { type: 'audio/wav' })] } });
    fireEvent.click(screen.getByRole('button', { name: '返回已有任务' }));
    expect((screen.getByLabelText('GPT 模型保存点') as HTMLSelectElement).value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '训练另一个音色' }));
    expect((screen.getByRole('textbox', { name: '新音色名称' }) as HTMLInputElement).value).toBe('第二个音色');
    expect((screen.getByLabelText('素材语言') as HTMLSelectElement).value).toBe('ja');
    fireEvent.click(screen.getByRole('button', { name: '导入并处理素材' }));
    await waitFor(() => expect(submitted).toMatchObject({ name: '第二个音色', language: 'ja', files: [{ name: 'second.wav' }], trainingOptions: { sovitsEpochs: 12 } }));
    await waitFor(() => expect((screen.getByLabelText('已有训练任务') as HTMLSelectElement).value).toBe('new'));
    expect(screen.getByLabelText('已有训练任务').textContent).toContain('已有音色');
    expect(actions).toEqual(['POST']);
    expect(useGameStore.getState().voiceConfig).toBe(currentVoice);
  });
  it('passes selected earlier export points to the voice API before applying', async () => {
    const result = { gptWeights: '/latest.ckpt', sovitsWeights: '/latest.pth', referencePath: '/ref.wav', referenceText: '你好', referenceId: 'one' };
    const job = { id: 'complete', name: '成品', version: 'v2ProPlus', language: 'ja', status: 'complete', clips: [], result,
      checkpoints: { gpt: [{ name: 'voice-e5.ckpt', path: '/early.ckpt', epoch: 5 }], sovits: [{ name: 'voice_e4_s4.pth', path: '/early.pth', epoch: 4 }] } };
    let selectedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('environment')) return Response.json({ versions: [], asr: {} });
      if (url.includes('view=voice')) { selectedUrl = url; return Response.json({ job: { ...job, result: { ...result, gptWeights: '/early.ckpt', sovitsWeights: '/early.pth' } }, referenceAudio: 'UklGRg==' }); }
      return Response.json({ jobs: [job] });
    });
    useGameStore.getState().setVoiceConfig(DEFAULT_VOICE_CONFIG);
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '爱丽丝' }));
    fireEvent.change(await screen.findByLabelText('GPT 模型保存点'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('SoVITS 模型保存点'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '应用到「爱丽丝」' }));
    await waitFor(() => expect(useGameStore.getState().voiceConfig.speakers.爱丽丝.gptWeights).toBe('/early.ckpt'));
    expect(new URL(selectedUrl, 'http://localhost').searchParams.get('gpt')).toBe('0');
    expect(new URL(selectedUrl, 'http://localhost').searchParams.get('sovits')).toBe('0');
    expect(useGameStore.getState().voiceConfig.language).toBe('zh');
  });
  it('shows environment blockers and lets the user review, train and apply a completed character voice', async () => {
    let job = { id: 'test', name: '角色音色', version: 'v2', language: 'zh', status: 'review', stage: '校对台词', createdAt: 1, updatedAt: 1, autoTranscribe: false,
      clips: [{ id: 'clip-0', file: 'one.wav', duration: 5, text: '自动识别的文字', included: true }] };
    const calls: { action: string; clips?: { text: string }[] }[] = [];
    vi.stubGlobal('fetch', async (url: string, options?: RequestInit) => {
      if (url.includes('environment')) return Response.json({ root: '/official', python: '/python', mac: true, ffmpeg: true, configuredModel: 'v2', missingModules: [], asr: { funasr: true }, versions: [{ id: 'v2', ready: true, missing: [] }] });
      if (url.includes('view=voice')) return Response.json({ job: { ...job, status: 'complete', result: { gptWeights: '/gpt.ckpt', sovitsWeights: '/sovits.pth', referencePath: '/ref.wav', referenceText: '我校对的台词', referenceId: 'clip-0' } }, referenceAudio: 'UklGRg==' });
      if (options?.method === 'PATCH') { const body = JSON.parse(String(options.body)); calls.push(body); job = { ...job, status: body.action === 'train' ? 'complete' : 'review', clips: body.clips ?? job.clips }; return Response.json({ job }); }
      return Response.json({ jobs: [job] });
    });
    useGameStore.getState().setVoiceConfig(DEFAULT_VOICE_CONFIG);
    render(React.createElement(VoiceTrainingWorkspace, { speaker: '爱丽丝' }));
    const text = await screen.findByLabelText('片段 1 台词');
    fireEvent.click(screen.getByText(/训练参数 · SoVITS/));
    fireEvent.change(screen.getByLabelText('SoVITS 训练轮数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('GPT 训练轮数'), { target: { value: '20' } });
    fireEvent.change(text, { target: { value: '我校对的台词' } });
    fireEvent.click(screen.getByRole('button', { name: '开始训练' }));
    await waitFor(() => expect(calls[0]).toMatchObject({ action: 'train', clips: [{ text: '我校对的台词' }], trainingOptions: { sovitsEpochs: 12, gptEpochs: 20 } }));
    fireEvent.click(await screen.findByRole('button', { name: '应用到「爱丽丝」' }));
    await waitFor(() => expect(useGameStore.getState().voiceConfig.speakers.爱丽丝).toMatchObject({ gptWeights: '/gpt.ckpt', referenceAudio: 'UklGRg==' }));
  });
});
