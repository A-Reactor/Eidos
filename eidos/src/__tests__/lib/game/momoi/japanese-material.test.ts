// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { buildVoiceRequest, DEFAULT_VOICE_CONFIG, voiceIdentity } from '@/lib/game/momoi/model';
import { VoiceLibrary } from '@/lib/game/momoi/library';
import { generateVoiceAudio } from '@/lib/game/momoi/client-generation';
import { clearVoiceInstallationCache } from '@/lib/game/momoi/installation-client';
const request = (material?: 'japanese') => buildVoiceRequest({ type: 'dialogue', text: '明天见。', speaker: '甲' }, { ...DEFAULT_VOICE_CONFIG, material, provider: 'gpt-sovits', endpoint: 'http://localhost:9880', referencePath: '/voice.wav', gptWeights: '/g.ckpt', sovitsWeights: '/s.pth' })!;
const report = { checks: [], languageResources: [{ id: 'ja', ready: true }], models: [{ languages: ['ja'], ready: true }] };
afterEach(() => { clearVoiceInstallationCache(); vi.unstubAllGlobals(); localStorage.clear(); });
it('speaks Japanese without plugins, preserves source/reference language and reuses saved audio without paid calls', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith('installation') ? report : url.endsWith('translate') ? { text: 'また明日。', usage: { totalTokens: 12 } } : { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }));
  vi.stubGlobal('fetch', fetcher);
  const account = vi.fn();
  const library = new VoiceLibrary({}, async () => {}, (r, signal) => generateVoiceAudio(r, signal, account));
  const japanese = request('japanese');
  expect(await library.ensure(japanese)).toMatchObject({ text: '明天见。', spokenText: 'また明日。', speechLanguage: 'ja', material: 'japanese' });
  const body = JSON.parse(String(fetcher.mock.calls[2][1]?.body));
  expect(body).toMatchObject({ text: 'また明日。', referenceLanguage: 'zh', config: { language: 'ja' } });
  expect(account).toHaveBeenCalledWith({ totalTokens: 12 });
  expect(await voiceIdentity(japanese)).not.toBe(await voiceIdentity(request()));
  await library.ensure(japanese);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not pay for translation when selected weights or resources cannot support the language', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ ...report, models: [{ languages: ['en'], ready: true }] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(generateVoiceAudio(request('japanese'), new AbortController().signal, vi.fn())).rejects.toThrow('尚未确认支持日语');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/momoi/installation');
});
it('reports translation failures and permits a retry without persisting false success', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('installation') ? report : url.endsWith('translate') ? (++attempts === 1 ? { error: '翻译连接失败' } : { text: 'また明日。' }) : { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }, { status: url.endsWith('translate') && attempts === 1 ? 502 : 200 })));
  const persist = vi.fn(async () => {});
  const library = new VoiceLibrary({}, persist, (r, signal) => generateVoiceAudio(r, signal, vi.fn()));
  await expect(library.ensure(request('japanese'))).rejects.toThrow('翻译连接失败');
  expect(persist).not.toHaveBeenCalled();
  await expect(library.ensure(request('japanese'))).resolves.toMatchObject({ spokenText: 'また明日。' });
});
it('keeps original mode free of translation and inspection requests', async () => {
  const fetcher = vi.fn(async (_url: string) => Response.json({ audioBase64: 'UklGRg==', mimeType: 'audio/wav' })); vi.stubGlobal('fetch', fetcher);
  await generateVoiceAudio(request(), new AbortController().signal, vi.fn());
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/momoi/speak');
});
it('does not start paid translation when cancelled during inspection', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const abort = new AbortController();
  const pending = generateVoiceAudio(request('japanese'), abort.signal, vi.fn());
  abort.abort(); finish(Response.json(report));
  await expect(pending).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('separates translated-language caches and passes the chosen target to translation and synthesis', async () => {
  const r = request(); r.config.material = 'translated'; r.config.translationLanguage = 'en';
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => Response.json(url.endsWith('installation') ? { ...report, languageResources: [{ id: 'en', ready: true }], models: [{ languages: ['en'], ready: true }] } : url.endsWith('translate') ? { text: 'See you tomorrow.' } : { audioBase64: 'UklGRg==', mimeType: 'audio/wav' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await generateVoiceAudio(r, new AbortController().signal, vi.fn())).toMatchObject({ speechLanguage: 'en', spokenText: 'See you tomorrow.' });
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).targetLanguage).toBe('en');
  expect(await voiceIdentity(r)).not.toBe(await voiceIdentity(request('japanese')));
});
