"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EidosButton } from "@/components/ui/EidosScreen";
import { SettingsField as EidosField } from "../settings/SettingsField";
import { deleteVoicePreset, loadVoicePresets, saveVoicePreset, useVoicePresets } from "@/lib/game/momoi/presets";
import { normalizeVoiceConfig, type VoiceConfig } from "@/lib/game/momoi/model";

export function VoicePresets({ onApply }: { onApply: (config: VoiceConfig) => Promise<void> }) {
  const ui = useInterfaceText();
  const config = useGameStore(s => s.voiceConfig);
  const { data, ready, error } = useVoicePresets();
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preset = data.presets.find(p => p.id === selected);
  const dirty = preset && JSON.stringify(preset.config) !== JSON.stringify(normalizeVoiceConfig(config));
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : ui("方案操作失败")); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border-b border-current/15 pb-4"><details className="space-y-3">
    <summary className="cursor-pointer text-sm">{ui("保存与管理方案")}</summary>
    <fieldset disabled={busy} className="space-y-3">
    <legend className="text-sm font-medium">{ui("模型与音色方案")}</legend>
    <EidosField id="voice-preset" label={ui("已保存方案")}><select id="voice-preset" disabled={!ready} className="eidos-field w-full border border-current/20 p-2.5 text-sm" value={selected} onChange={e => {
      const value = data.presets.find(p => p.id === e.target.value);
      if (!value) { setSelected(""); setName(""); return; }
      void run(async () => { await onApply(value.config); setSelected(value.id); setName(value.name); setMessage(ui("已应用「{0}」", {"0": value.name})); });
    }}><option value="">{ui("当前配置 · 未选择方案")}</option>{data.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></EidosField>
    <EidosField id="voice-preset-name" label={ui("方案名称")}><input id="voice-preset-name" className="eidos-field w-full border border-current/20 p-2.5 text-sm" placeholder={ui("例如：中文角色音色 / 日语配音")} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></EidosField>
    <div className="flex flex-wrap gap-2">
      <EidosButton disabled={!ready || !name.trim()} onClick={() => void run(async () => { setSelected(await saveVoicePreset(name, config)); setMessage(ui("已保存为新方案")); })}>{ui("另存为新方案")}</EidosButton>
      <EidosButton disabled={!ready || !preset || !name.trim()} onClick={() => void run(async () => { await saveVoicePreset(name, config, selected); setMessage(ui("方案已更新")); })}>{ui("更新方案")}</EidosButton>
      <EidosButton disabled={!ready || !preset} onClick={() => void run(async () => { await deleteVoicePreset(selected); setSelected(""); setName(""); setMessage(ui("已删除方案，当前配置继续保留")); })}>{ui("删除方案")}</EidosButton>
    </div>
    <p className="text-xs leading-6 opacity-60">{ui("保存在本机，包含默认与角色音色；连接凭据单独保存在当前会话。选择方案后仍需试听验证。")}{dirty && ui(" 当前修改尚未更新到方案。")}</p>
    </fieldset></details>
    {(message || error) && <p role="status" className="text-xs leading-6">{message || error}</p>}
    {!ready && error && <button type="button" disabled={false} onClick={() => void loadVoicePresets().catch(() => {})}>{ui("重新读取方案")}</button>}
  </div>;
}
