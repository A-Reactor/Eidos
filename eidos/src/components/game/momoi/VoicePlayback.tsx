'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useGameStore } from '@/store/game-store';
import { voiceStatusLabel } from '@/lib/game/momoi/service-status';
import { EidosButton } from '@/components/ui/EidosScreen';
import { SettingsField, SettingsToggle } from '../settings/SettingsField';
import { VoiceMaterial } from './VoiceMaterial';

export function VoicePlayback({ onModels, onInstallation }: { onModels: () => void; onInstallation: () => void }) {
  const ui = useInterfaceText();
  const settings = useGameStore(state => state.momoiSettings);
  const patch = useGameStore(state => state.setMomoiSettings);
  const status = useGameStore(voiceStatusLabel);
  return <>
    <div className="eidos-audio-overview-grid">
    <section className="eidos-audio-block" aria-label={ui("播放控制")}><h3>{ui("播放控制")}</h3>
    <div className="eidos-settings-fields">
      <SettingsToggle id="voice-enabled" label={ui("启用对话语音")} hint={ui("仅朗读角色对话，翻页会等待朗读结束。")} checked={settings.enabled} onChange={enabled => patch({ enabled })} />
      <p role="status" className="eidos-audio-service-state">{settings.enabled ? ui(status) : ui("已关闭")}</p>
      <SettingsToggle id="voice-autoplay" label={ui("首次读到对话时自动播放")} hint={ui("点击角色名字可重播。")} checked={settings.autoPlay} onChange={autoPlay => patch({ autoPlay })} />
      <SettingsField id="voice-volume" label={ui("音量 · {0}%", {"0": Math.round(settings.volume * 100)})}><input id="voice-volume" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={event => patch({ volume: Number(event.target.value) })} /></SettingsField>
      <SettingsField id="voice-speed" label={ui("播放速度 · {0}×", {"0": settings.speed.toFixed(1)})}><input id="voice-speed" type="range" min="0.5" max="2" step="0.1" value={settings.speed} onChange={event => patch({ speed: Number(event.target.value) })} /></SettingsField>
    </div>
    </section>
    <section className="eidos-audio-block" aria-label={ui("配音语言")}>
      <h3>{ui("配音语言")}</h3>
      <VoiceMaterial />
      <EidosButton onClick={onInstallation}>{ui("检查语言支持")}</EidosButton>
    </section>
    </div>
    <div className="eidos-audio-actions"><EidosButton onClick={onModels}>{ui("选择模型与音色")}</EidosButton></div>
  </>;
}
