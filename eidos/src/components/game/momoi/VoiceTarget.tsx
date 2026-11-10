'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useGameStore } from '@/store/game-store';
import { SettingsField } from '../settings/SettingsField';

export function VoiceTarget({ speaker, onChange, training = false, disabled = false }: {
  speaker: string; onChange: (speaker: string) => void; training?: boolean; disabled?: boolean;
}) {
  const ui = useInterfaceText();
  const world = useGameStore(state => state.currentWorld);
  const speakers = useGameStore(state => state.voiceConfig.speakers);
  const names = [...new Set([...Object.keys(world?.npcs ?? {}), ...Object.keys(speakers), ...(speaker ? [speaker] : [])])];
  const id = training ? 'training-target' : 'voice-cast';
  return <SettingsField id={id} label={training ? ui("训练完成后应用到") : ui("为谁设置音色")} hint={training ? ui("训练本身不替换当前音色；完成后试听，再手动应用。") : ui("默认音色供所有未单独配置的角色使用。")}>
    <select id={id} className="eidos-settings-control" value={speaker} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">{ui("默认音色 · 所有未指定角色")}</option>
      {names.map(name => <option key={name}>{name}</option>)}
    </select>
  </SettingsField>;
}
