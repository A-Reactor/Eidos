import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/momoi/speak/route';
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG, type VoiceRequest } from '@/lib/game/momoi/model';
import { synthesizeVoice } from '@/lib/game/momoi/providers';

const request = (name = 'alice'): VoiceRequest => buildVoiceRequest({ type: 'dialogue', text: '你好。', speaker: name }, {
  ...DEFAULT_VOICE_CONFIG, provider: 'gpt-sovits', endpoint: 'http://localhost:9880/tts/', referencePath: '/ref.wav',
  gptWeights: `/models/${name} & 音色.ckpt`, sovitsWeights: `/models/${name}_lora.pth`,
})!;
const post = (r: VoiceRequest) => POST(new NextRequest('http://localhost:3000/api/momoi/speak', { method: 'POST', body: JSON.stringify(r) }));
const audio = () => new Response('RIFF', { headers: { 'Content-Type': 'audio/wav' } });
afterEach(() => vi.unstubAllGlobals());

describe('community GPT-SoVITS weights', () => {
  it('loads the paired weights through official API v2 before synthesis', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit) => {
      const target = new URL(url);
      calls.push(target.pathname);
      if (target.pathname === '/tts') {
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toMatchObject({ ref_audio_path: '/ref.wav', text: '你好。' });
        return audio();
      }
      expect(init.method).toBe('GET');
      expect(target.searchParams.get('weights_path')).toBe(target.pathname === '/set_gpt_weights' ? '/models/alice & 音色.ckpt' : '/models/alice_lora.pth');
      return Response.json({ message: 'success' });
    });
    const response = await post(request());
    expect(response.status).toBe(200);
    expect(calls).toEqual(['/set_gpt_weights', '/set_sovits_weights', '/tts']);
  });
  it('rejects incomplete, malformed or unbounded weight paths before touching the service', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const weights of [{ gptWeights: '/a.ckpt', sovitsWeights: '' }, { gptWeights: 12 }, { sovitsWeights: 'a'.repeat(2001) }, { sovitsWeights: '/a\0.pth' }]) {
      const r = request(); Object.assign(r.voice, weights);
      expect((await post(r)).status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('stops on a failed weight load, then permits a complete fresh attempt', async () => {
    const calls: string[] = [];
    let fail = true;
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const target = new URL(url); calls.push(target.pathname);
      if (fail && target.pathname === '/set_sovits_weights') return Response.json({ message: 'missing base model' }, { status: 400 });
      return target.pathname === '/tts' ? audio() : Response.json({ message: 'success' });
    });
    const failed = await post(request());
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatch(/SoVITS.*底模/);
    expect(calls).toEqual(['/set_gpt_weights', '/set_sovits_weights']);
    fail = false;
    expect((await post(request())).status).toBe(200);
    expect(calls.slice(2)).toEqual(['/set_gpt_weights', '/set_sovits_weights', '/tts']);
  });
  it('keeps loading and synthesis atomic across callers using the same service', async () => {
    const calls: string[] = [];
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const target = new URL(url);
      calls.push(target.pathname === '/tts' ? '/tts' : target.searchParams.get('weights_path')!);
      if (calls.length === 1) { enter(); await blocked; }
      return target.pathname === '/tts' ? audio() : Response.json({ message: 'success' });
    });
    const first = synthesizeVoice(request('alice'), new AbortController().signal);
    await entered;
    const secondRequest = request('bob'); secondRequest.config.endpoint = 'http://localhost:9880';
    const second = synthesizeVoice(secondRequest, new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    const duringLoad = [...calls];
    release(); await Promise.all([first, second]);
    expect(duringLoad).toEqual(['/models/alice & 音色.ckpt']);
    expect(calls).toEqual(['/models/alice & 音色.ckpt', '/models/alice_lora.pth', '/tts', '/models/bob & 音色.ckpt', '/models/bob_lora.pth', '/tts']);
  });
  it('never changes weights for an already cancelled request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); controller.abort();
    await expect(synthesizeVoice(request(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('skips a cancelled waiting caller and continues with the next model', async () => {
    const calls: string[] = [];
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const target = new URL(url); calls.push(target.searchParams.get('weights_path') ?? target.pathname);
      if (calls.length === 1) { enter(); await blocked; }
      return target.pathname === '/tts' ? audio() : Response.json({ message: 'success' });
    });
    const first = synthesizeVoice(request('alice'), new AbortController().signal); await entered;
    const cancelled = new AbortController();
    const second = synthesizeVoice(request('bob'), cancelled.signal);
    const rejection = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    cancelled.abort();
    const third = synthesizeVoice(request('carol'), new AbortController().signal);
    release(); await Promise.all([first, rejection, third]);
    expect(calls).toEqual(['/models/alice & 音色.ckpt', '/models/alice_lora.pth', '/tts', '/models/carol & 音色.ckpt', '/models/carol_lora.pth', '/tts']);
  });
});
