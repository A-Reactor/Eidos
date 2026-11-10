import { loadSettings } from '@/lib/game/settings';
import type { VoiceRequest } from './model';
import type { TokenUsage } from '@/lib/ai/types';
import { VOICE_LANGUAGES, type VoiceLanguage } from './languages';
export async function translateVoiceMaterial(request: VoiceRequest, target: VoiceLanguage, signal: AbortSignal, account: (usage: TokenUsage) => void) {
  const settings = Object.fromEntries(Object.entries(loadSettings()).filter(([key]) => key.startsWith('alice') || key === 'reserveReasoningBudget'));
  const response = await fetch('/api/momoi/translate', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: request.text, speaker: request.speaker, emotion: request.emotion, targetLanguage: target, _settings: settings }) });
  const result = await response.json();
  if (result.usage) account(result.usage);
  signal.throwIfAborted();
  if (!response.ok) throw new Error(result.error ?? `${VOICE_LANGUAGES[target]}台词翻译失败`);
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('配音译文为空');
  return result.text.trim() as string;
}
