export const VOICE_LANGUAGES = { zh: '中文', ja: '日语', en: '英语', yue: '粤语', ko: '韩语' } as const;
export type VoiceLanguage = keyof typeof VOICE_LANGUAGES;
export const isVoiceLanguage = (value: unknown): value is VoiceLanguage => typeof value === 'string' && Object.hasOwn(VOICE_LANGUAGES, value);
export function translationTarget(config: { material?: string; translationLanguage?: string }): VoiceLanguage | null {
  return config.material === 'japanese' ? 'ja' : config.material === 'translated' && isVoiceLanguage(config.translationLanguage) ? config.translationLanguage : null;
}
export interface VoiceInstallation {
  checks: { label: string; ready: boolean; detail: string }[];
  languageResources: { id: VoiceLanguage; ready: boolean; detail: string }[];
  models: { version?: string; languages: VoiceLanguage[]; ready: boolean; error?: string }[];
}
export function availableVoiceLanguages(report: VoiceInstallation): VoiceLanguage[] {
  return report.models.length ? (Object.keys(VOICE_LANGUAGES) as VoiceLanguage[]).filter(language =>
    report.languageResources.some(resource => resource.id === language && resource.ready) &&
    report.models.every(model => model.ready && model.languages.includes(language))) : [];
}
