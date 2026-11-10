import { useGameStore } from '@/store/game-store';
import { DEFAULT_VOICE_CONFIG, buildVoiceRequest, voiceIdentity, type VoiceAsset } from '@/lib/game/momoi/model';
import { getVoiceLibrary, voiceScope } from '@/lib/game/momoi/runtime';
import type { StorySegment } from '@/lib/ai/types';

const lines = [
  ['船夫', '水位已经落下去了，天亮前就能渡河。'], ['守卫', '钟楼今晚开放，记得带上通行证。'],
  ['旅人', '我在旧书里找到一张地图，上面标着一条从未听说的街。'], ['店主', '这盏灯留给你，雨天走石阶要小心。'],
  ['船夫', '沿着灯火往前走，就不会错过旧码头。'], ['守卫', '如果见到修钟的人，请告诉他北门的钟已经停了。'],
  ['旅人', '也许我们寻找的是同一个地方。'], ['店主', '回来时讲给我听，城外的天空是什么颜色。'],
  ['船夫', '准备好了吗？下一班船就要开了。'], ['守卫', '这条路通往上城区，请慢行。'],
  ['旅人', '雾散了，我终于看清远处的塔。'], ['店主', '愿你一路平安。'],
];
const clips = lines.slice(0, 6).map(([, text], index) => ({ id: `clip-${index}`, file: `recording-${index}.wav`, duration: 4.2 + index * .6, text, included: index !== 4 }));
const jobs = [
  { id: 'preview-review', name: '渡口旁白', version: 'v2ProPlus', language: 'zh', status: 'review', stage: '校对台词', createdAt: 1, updatedAt: 1, autoTranscribe: true, duration: 64, clips, preparation: { phase: 'complete' } },
  { id: 'preview-complete', name: '钟楼守卫', version: 'v2ProPlus', language: 'zh', status: 'complete', stage: '训练完成', createdAt: 1, updatedAt: 1, clips: [],
    result: { gptWeights: '/preview/guard.ckpt', sovitsWeights: '/preview/guard.pth', referencePath: '/preview/guard.wav', referenceText: lines[1][1], referenceId: 'clip-1' },
    checkpoints: { gpt: [{ name: 'guard-e15.ckpt', path: '/preview/guard.ckpt', epoch: 15 }], sovits: [{ name: 'guard-e8.pth', path: '/preview/guard.pth', epoch: 8 }] } },
];

// This scenario previews dense pages without contacting the local training service.
export function audioLayoutResponse(url: string, init?: RequestInit): Response | null {
  if (!url.startsWith('/api/momoi/installation') && !url.startsWith('/api/momoi/training')) return null;
  if (url.includes('installation')) return Response.json({ checks: [{ label: 'Python', ready: true, detail: '运行环境已就绪' }, { label: 'GPT-SoVITS', ready: true, detail: '模型与依赖齐全' }],
    languageResources: ['zh', 'ja', 'en'].map(id => ({ id, ready: true, detail: '语言资源已就绪' })), models: [{ version: 'v2ProPlus', ready: true, languages: ['zh', 'ja', 'en'] }] });
  if (init?.method && init.method !== 'GET') return Response.json({ error: '此场景仅预览界面，不执行后台任务。' }, { status: 409 });
  if (url.includes('view=environment')) return Response.json({ python: '/preview/python', root: '/preview/GPT-SoVITS', configuredModel: 'v2ProPlus', ffmpeg: true, mac: true,
    missingModules: [], asr: { funasr: true, faster_whisper: true }, versions: ['v2', 'v2ProPlus'].map(id => ({ id, ready: true, missing: [] })) });
  return Response.json({ jobs });
}

function silentWav() {
  const bytes = new Uint8Array(1644), view = new DataView(bytes.buffer);
  const word = (offset: number, text: string) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
  word(0, 'RIFF'); view.setUint32(4, 1636, true); word(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); word(36, 'data'); view.setUint32(40, 1600, true); bytes.fill(128, 44);
  return btoa(String.fromCharCode(...bytes));
}

export async function seedAudioLayout() {
  const config = { ...DEFAULT_VOICE_CONFIG, voice: '预览音色', referenceAudio: silentWav(), referenceText: lines[0][1] };
  const segments: StorySegment[] = lines.map(([speaker, text]) => ({ type: 'dialogue', speaker, text }));
  useGameStore.setState({ voiceConfig: config, savedSegments: segments, voiceAssets: {}, phase: 'audio', navigationStack: ['playing'] });
  const scope = voiceScope();
  await getVoiceLibrary();
  const assets: Record<string, VoiceAsset> = {};
  await Promise.all(segments.slice(0, 8).map(async segment => {
    const id = await voiceIdentity(buildVoiceRequest(segment, config)!);
    assets[id] = { id, text: segment.text, speaker: segment.speaker!, emotion: 'neutral', audioBase64: config.referenceAudio, mimeType: 'audio/wav', provider: 'legacy', model: 'GPT-SoVITS', createdAt: 1 };
  }));
  if (voiceScope() === scope) useGameStore.setState({ voiceAssets: assets, voiceAssetScope: scope });
}
