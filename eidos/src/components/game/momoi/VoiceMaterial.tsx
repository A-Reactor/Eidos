'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useGameStore } from '@/store/game-store';
import { SettingsField as EidosField } from '../settings/SettingsField';
import { VOICE_LANGUAGES, availableVoiceLanguages, isVoiceLanguage, translationTarget } from '@/lib/game/momoi/languages';
import { useVoiceInstallation } from './VoiceInstallation';

export function VoiceMaterial() {
  const ui = useInterfaceText();
  const config = useGameStore(state => state.voiceConfig);
  const { report, checking, error } = useVoiceInstallation();
  const languages = report ? availableVoiceLanguages(report) : [];
  const target = translationTarget(config);
  const patch = useGameStore(state => state.setVoiceConfig);
  return <div className="eidos-settings-fields">
    <EidosField id="voice-material" label={ui("语音生成材料")} hint={ui("正文不变；译文由 ALICE 生成，计入模型用量。")}>
      <select id="voice-material" className="eidos-field w-full border border-current/20 p-2.5 text-sm" value={target ?? 'original'} onChange={event => {
        const language = event.target.value;
        patch(isVoiceLanguage(language) ? { material: language === 'ja' ? 'japanese' : 'translated', translationLanguage: language } : { material: 'original' });
      }}>
        <option value="original">{ui("原文朗读（默认）")}</option>
        {languages.map(language => <option key={language} value={language}>{ui(VOICE_LANGUAGES[language])}{ui("译文")}</option>)}
        {target && !languages.includes(target) && <option value={target} disabled>{ui(VOICE_LANGUAGES[target])}{ui("译文 · 尚未通过检查")}</option>}
      </select>
    </EidosField>
    {config.provider !== 'compatible' && !target && <EidosField id="voice-source-language" label={ui("原文朗读语言")}><select id="voice-source-language" className="eidos-field w-full border border-current/20 p-2.5 text-sm" value={config.language} onChange={event => patch({ language: event.target.value })}>
      <option value="auto">{ui("自动识别")}</option>
      {languages.map(language => <option key={language} value={language}>{ui(VOICE_LANGUAGES[language])}</option>)}
      {config.language !== 'auto' && !languages.includes(config.language as keyof typeof VOICE_LANGUAGES) && <option value={config.language} disabled>{ui(VOICE_LANGUAGES[config.language as keyof typeof VOICE_LANGUAGES]) ?? config.language} {ui("· 尚未通过检查")}</option>}
    </select></EidosField>}
    <p role="status" className="eidos-audio-caption">{checking ? ui("正在检查语言支持…") : error || (languages.length ? ui("仅显示当前模型支持的语言。") : ui("语言支持未确认，请查看安装检查。"))}</p>
  </div>;
}
