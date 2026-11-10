import type { VoiceConfig, VoiceRequest } from './model';
import type { VoiceInstallation } from './languages';
const reports = new Map<string, { report: VoiceInstallation; checkedAt: number }>();
export function clearVoiceInstallationCache() { reports.clear(); }
function weights(voice: Pick<VoiceConfig, 'gptWeights' | 'sovitsWeights'>) {
  return voice.gptWeights || voice.sovitsWeights ? { gptWeights: voice.gptWeights ?? '', sovitsWeights: voice.sovitsWeights ?? '' } : {};
}
export function installationInput(config: Pick<VoiceConfig, 'provider' | 'endpoint' | 'gptWeights' | 'sovitsWeights'>, voices: VoiceConfig['speakers'] = {}) {
  const models = [...new Map([config, ...Object.values(voices).filter(voice => voice.gptWeights || voice.sovitsWeights)].map(voice => {
    const model = weights(voice);
    return [JSON.stringify(model), model];
  })).values()];
  return { provider: config.provider, endpoint: config.endpoint, models };
}
export function installationModelNames(config: VoiceConfig): string[] {
  const names = new Map<string, string[]>();
  for (const [name, voice] of [['默认音色', config], ...Object.entries(config.speakers).filter(([, voice]) => voice.gptWeights || voice.sovitsWeights)] as const) {
    const key = JSON.stringify(weights(voice));
    names.set(key, [...(names.get(key) ?? []), name]);
  }
  return [...names.values()].map(names => names.join('、'));
}
export async function checkVoiceInstallation(input: ReturnType<typeof installationInput>, signal: AbortSignal, options: { maxAgeMs?: number } = {}): Promise<VoiceInstallation> {
  signal.throwIfAborted();
  const key = JSON.stringify(input), cached = reports.get(key), age = cached ? Date.now() - cached.checkedAt : Infinity;
  if (cached && age >= 0 && age < (options.maxAgeMs ?? 0)) return cached.report;
  try {
    const response = await fetch('/api/momoi/installation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal, cache: 'no-store' });
    const report = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok) throw new Error(report?.error || '无法连接安装检查服务，请确认游戏后台已启动后重试');
    if (!report || !Array.isArray(report.models) || !Array.isArray(report.checks) || !Array.isArray(report.languageResources)) throw new Error('安装检查报告无效');
    reports.delete(key);
    if (report.models.length && report.models.every((model: VoiceInstallation['models'][number]) => model.ready)) {
      reports.set(key, { report, checkedAt: Date.now() });
      if (reports.size > 16) reports.delete(reports.keys().next().value!);
    }
    return report;
  } catch (error) { reports.delete(key); throw error; }
}
export function requestInstallationInput(request: VoiceRequest) {
  return installationInput({ ...request.config, gptWeights: request.voice.gptWeights, sovitsWeights: request.voice.sovitsWeights });
}
