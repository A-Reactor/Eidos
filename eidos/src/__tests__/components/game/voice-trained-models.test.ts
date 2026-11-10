// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceCasting } from '@/components/game/momoi/VoiceCasting';
import { useGameStore } from '@/store/game-store';
import { DEFAULT_VOICE_CONFIG, buildVoiceRequest } from '@/lib/game/momoi/model';

const result = { gptWeights: '/last.ckpt', sovitsWeights: '/last.pth', referencePath: '/ja.wav', referenceId: 'ref', referenceText: 'こんにちは' };
const job = { id: 'complete', name: '日语音色', version: 'v2ProPlus', language: 'ja', status: 'complete', stage: '完成', clips: [], result,
  checkpoints: { gpt: [{ name: 'voice-e5.ckpt', path: '/early.ckpt', epoch: 5 }], sovits: [] } };
beforeEach(() => useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, referenceAudio: 'default', referenceText: '默认原话', referenceLanguage: 'zh' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('trained voices in model settings', () => {
  it('requires confirmation, deletes the selected exports and releases matching current model assignments', async () => {
    const mutations: object[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') { mutations.push(JSON.parse(String(init.body))); return Response.json({ job: { ...job, status: 'review', result: undefined } }); }
      return Response.json({ jobs: [job] });
    });
    useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, gptWeights: '/last.ckpt', sovitsWeights: '/last.pth', referenceAudio: 'keep-default',
      speakers: { 爱丽丝: { trainingJobId: 'complete', gptWeights: '/early.ckpt', sovitsWeights: '/last.pth', referenceAudio: 'keep-alice' }, 其他: { gptWeights: '/other.ckpt', sovitsWeights: '/other.pth' } } });
    render(React.createElement(VoiceCasting, { speaker: '', onSpeakerChange: () => {} }));
    fireEvent.change(await screen.findByLabelText('已训练音色'), { target: { value: 'complete' } });
    fireEvent.click(screen.getByRole('button', { name: '删除此音色权重' }));
    expect(mutations).toEqual([]);
    expect(screen.getByRole('alertdialog', { name: '确认删除训练权重' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认删除权重' }));
    await waitFor(() => expect(useGameStore.getState().voiceConfig.gptWeights).toBeUndefined());
    const config = useGameStore.getState().voiceConfig;
    expect(config.referenceAudio).toBe('keep-default');
    expect(config.speakers.爱丽丝.gptWeights).toBeUndefined();
    expect(config.speakers.爱丽丝.referenceAudio).toBe('keep-alice');
    expect(config.speakers.其他.gptWeights).toBe('/other.ckpt');
    expect(mutations).toEqual([{ id: 'complete', action: 'delete-weights', confirmed: true }]);
  });
  it('selects a completed voice and earlier weights for one character, then resolves its complete reference', async () => {
    vi.stubGlobal('fetch', async (url: string) => Response.json(url.includes('view=voice') ? {
      job: { ...job, result: { ...result, gptWeights: '/early.ckpt' } }, referenceAudio: 'alice-audio'
    } : { jobs: [job, { ...job, id: 'training', status: 'training' }] }));
    const { rerender } = render(React.createElement(VoiceCasting, { speaker: '爱丽丝', onSpeakerChange: () => {} }));
    const selector = await screen.findByLabelText('已训练音色');
    expect(selector.querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(selector, { target: { value: 'complete' } });
    fireEvent.change(screen.getByLabelText('GPT 保存点'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '应用所选音色' }));
    await waitFor(() => expect(useGameStore.getState().voiceConfig.speakers.爱丽丝?.gptWeights).toBe('/early.ckpt'));
    const config = useGameStore.getState().voiceConfig;
    expect(config.referenceAudio).toBe('default');
    expect(config.speakers.爱丽丝).toMatchObject({ trainingJobId: 'complete', referenceAudio: 'alice-audio', referenceText: 'こんにちは', referenceLanguage: 'ja' });
    rerender(React.createElement(VoiceCasting, { speaker: '爱丽丝', onSpeakerChange: () => {} }));
    expect((screen.getByLabelText('参考音频语言') as HTMLSelectElement).value).toBe('ja');
    expect((screen.getByLabelText('参考音频中的原话') as HTMLTextAreaElement).value).toBe('こんにちは');
    expect(buildVoiceRequest({ type: 'dialogue', speaker: '爱丽丝', text: '你好' }, config)).toMatchObject({
      referenceLanguage: 'ja', voice: { gptWeights: '/early.ckpt', sovitsWeights: '/last.pth', referenceAudio: 'alice-audio', referenceText: 'こんにちは' },
    });
  });
  it('does not apply a delayed result after the target character changes', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', async (url: string) => url.includes('view=voice') ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json({ jobs: [job] }));
    const { rerender } = render(React.createElement(VoiceCasting, { speaker: '爱丽丝', onSpeakerChange: () => {} }));
    fireEvent.change(await screen.findByLabelText('已训练音色'), { target: { value: 'complete' } });
    fireEvent.click(screen.getByRole('button', { name: '应用所选音色' }));
    rerender(React.createElement(VoiceCasting, { speaker: '其他角色', onSpeakerChange: () => {} }));
    await act(async () => { finish(Response.json({ job, referenceAudio: 'alice-audio' })); });
    expect(screen.queryByText(/已应用到/)).toBeNull();
    expect(useGameStore.getState().voiceConfig.speakers).toEqual({});
  });
  it('clears the old transcript when uploading a replacement, and can inherit the whole default reference again', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ jobs: [] }));
    useGameStore.getState().setVoiceConfig({ speakers: { 爱丽丝: { voice: '旧参考', referenceAudio: 'old-audio', referenceText: '旧台词', referenceLanguage: 'ja', gptWeights: '/a.ckpt', sovitsWeights: '/a.pth' } } });
    render(React.createElement(VoiceCasting, { speaker: '爱丽丝', onSpeakerChange: () => {} }));
    fireEvent.change(screen.getByLabelText('上传音色参考'), { target: { files: [new File(['RIFF'], 'new.wav', { type: 'audio/wav' })] } });
    await waitFor(() => expect(useGameStore.getState().voiceConfig.speakers.爱丽丝.referenceAudio).toBe('UklGRg=='));
    expect(useGameStore.getState().voiceConfig.speakers.爱丽丝).toMatchObject({ referenceText: '', referenceLanguage: 'auto', referencePath: '' });
    fireEvent.click(screen.getByRole('button', { name: '使用默认参考录音' }));
    const request = buildVoiceRequest({ type: 'dialogue', speaker: '爱丽丝', text: '你好' }, useGameStore.getState().voiceConfig)!;
    expect(request.voice).toMatchObject({ referenceAudio: 'default', referenceText: '默认原话', gptWeights: '/a.ckpt' });
    expect(request.referenceLanguage).toBe('zh');
  });
});
