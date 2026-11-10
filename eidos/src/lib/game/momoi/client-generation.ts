import { validateVoiceConfiguration, type VoiceRequest } from './model';
import { translateVoiceMaterial } from './translated-material';
import { availableVoiceLanguages, translationTarget, VOICE_LANGUAGES } from './languages';
import { checkVoiceInstallation, requestInstallationInput } from './installation-client';
import { trackVoiceGeneration } from './service-status';
import type { AudioData } from './library';
import type { TokenUsage } from '@/lib/ai/types';
import { ensureLocalVoiceService } from './local-service';

/** Playback, batch generation and connection previews use the same material pipeline. */
export function generateVoiceAudio(request: VoiceRequest, signal: AbortSignal, account: (usage: TokenUsage) => void): Promise<AudioData> {
  return trackVoiceGeneration(async () => {
    const invalid = validateVoiceConfiguration(request.config, request.voice);
    if (invalid) throw new Error(invalid);
    const target = translationTarget(request.config);
    const local = request.config.provider === 'legacy';
    const taskSignal = AbortSignal.any([signal, AbortSignal.timeout(local ? (target ? 360_000 : 260_000) : target ? 165_000 : 65_000)]);
    if (target) {
      const report = await checkVoiceInstallation(requestInstallationInput(request), taskSignal, { maxAgeMs: 30_000 });
      if (!availableVoiceLanguages(report).includes(target)) throw new Error(`当前权重或语言资源尚未确认支持${VOICE_LANGUAGES[target]}，请先检查语音环境`);
    }
    if (local) await ensureLocalVoiceService(taskSignal);
    taskSignal.throwIfAborted();
    const spokenText = target ? await translateVoiceMaterial(request, target, taskSignal, account) : request.text;
    const payload = target ? { ...request, text: spokenText, referenceLanguage: request.referenceLanguage ?? request.config.language, config: { ...request.config, language: target } } : request;
    taskSignal.throwIfAborted();
    const response = await fetch('/api/momoi/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: taskSignal });
    const data = await response.json().catch(() => null);
    taskSignal.throwIfAborted();
    if (!response.ok || !data) throw new Error(data?.error ?? '语音服务未返回有效数据，请确认游戏后台正在运行');
    return target ? { ...data, spokenText, speechLanguage: target } : data;
  }, request.config);
}
