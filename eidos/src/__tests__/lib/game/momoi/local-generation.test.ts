// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { generateVoiceAudio } from '@/lib/game/momoi/client-generation';
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG } from '@/lib/game/momoi/model';
import { requestForSegment } from '@/lib/game/momoi/runtime';
import { useGameStore } from '@/store/game-store';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });
const request = () => ({ ...buildVoiceRequest({ type: 'dialogue', text: '你好', speaker: '爱丽丝' }, {
  ...DEFAULT_VOICE_CONFIG, referenceAudio: 'UklGRg==', referenceLanguage: 'ja', referenceText: 'こんにちは',
  gptWeights: '/trained.ckpt', sovitsWeights: '/trained.pth',
})!, worldId: 'world' });
it('does not replace an explicit reference path with a legacy profile during game dialogue generation', () => {
  localStorage.setItem('eidos_momoi_voice_profiles', JSON.stringify([{ id: 'old', name: '爱丽丝', referenceAudio: 'wrong-old-audio' }]));
  useGameStore.getState().setVoiceConfig({ ...DEFAULT_VOICE_CONFIG, referencePath: '/chosen.wav', referenceText: '选中的参考', referenceLanguage: 'zh' });
  const r = requestForSegment({ type: 'dialogue', speaker: '爱丽丝', text: '你好' })!;
  expect(r.voice.referencePath).toBe('/chosen.wav');
  expect(r.voice.referenceAudio).toBe('');
  expect(r.voice.referenceText).toBe('选中的参考');
});
it('waits for local startup to finish before sending the selected voice to synthesis', async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  let payload: unknown;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith('/start')) return Response.json({ ok: true, status: 'loading_model' });
    if (url.endsWith('/status')) return Response.json({ status: 'ready' });
    payload = JSON.parse(String(init?.body));
    return Response.json({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' });
  });
  const promise = generateVoiceAudio(request(), new AbortController().signal, () => {});
  await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({ audioBase64: 'UklGRg==' });
  expect(calls).toEqual(['/api/momoi/start', '/api/momoi/status', '/api/momoi/speak']);
  expect(payload).toMatchObject({ referenceLanguage: 'ja', voice: { gptWeights: '/trained.ckpt', referenceText: 'こんにちは' } });
});
it('reports startup failure without requesting synthesis', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { calls.push(url); return Response.json({ ok: false, error: '缺少模型文件' }, { status: 500 }); });
  await expect(generateVoiceAudio(request(), new AbortController().signal, () => {})).rejects.toThrow('缺少模型文件');
  expect(calls).toEqual(['/api/momoi/start']);
});
