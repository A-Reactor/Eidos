import type { VoiceRequest } from './model';

const services = new Map<string, Promise<unknown>>();
export function gptSovitsBase(endpoint: string): string {
  return new URL(endpoint).toString().replace(/\/+$/, '').replace(/\/tts$/, '');
}
async function loadWeights(base: string, kind: 'gpt' | 'sovits', path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const url = new URL(`${base}/set_${kind}_weights`);
  url.searchParams.set('weights_path', path.trim());
  const label = kind === 'gpt' ? 'GPT' : 'SoVITS';
  const response = await fetch(url, { method: 'GET', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw new Error(`${label} 权重加载失败（${response.status}），请检查服务端路径、模型版本与 LoRA 所需底模`);
  const result = await response.json().catch(() => null);
  if (result !== 'success' && result?.message !== 'success') throw new Error(`${label} 权重切换未获确认，请检查是否为 GPT-SoVITS API v2 服务`);
}

/** Official API v2 mutates one shared model: loading and synthesis form one job. */
export async function withGptSovitsModel<T>(request: VoiceRequest, signal: AbortSignal, synthesize: () => Promise<T>): Promise<T> {
  const base = gptSovitsBase(request.config.endpoint);
  const previous = services.get(base) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    signal.throwIfAborted();
    if (request.voice.gptWeights && request.voice.sovitsWeights) {
      // Reapply both even after a previous success: the server can restart or be changed externally.
      await loadWeights(base, 'gpt', request.voice.gptWeights, signal);
      await loadWeights(base, 'sovits', request.voice.sovitsWeights, signal);
    }
    signal.throwIfAborted();
    return synthesize();
  });
  services.set(base, job);
  try { return await job; }
  finally { if (services.get(base) === job) services.delete(base); }
}
