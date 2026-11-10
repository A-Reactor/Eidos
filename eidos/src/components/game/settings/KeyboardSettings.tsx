'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useState } from 'react';
import { DEFAULT_SHORTCUTS, LEGACY_SHORTCUTS, SHORTCUT_ACTIONS, validShortcutKey, type KeyboardShortcuts, type ShortcutAction } from '@/lib/game/keyboard-shortcuts';
import { SettingsField } from './SettingsField';

const labels: Record<ShortcutAction, [string, string]> = {
  advance: ['下一段 / 确认', 'Next / confirm'], previous: ['上一段', 'Previous'], focusInput: ['行动输入', 'Action input'],
  status: ['世界状态', 'World status'], worldline: ['世界线', 'Worldline'], gallery: ['图库', 'Gallery'],
};
export function KeyboardSettings({ value, onChange, english }: { value: KeyboardShortcuts; onChange: (value: KeyboardShortcuts) => void; english: boolean }) {
  const ui = useInterfaceText();
  const [error, setError] = useState('');
  const change = (action: ShortcutAction, raw: string) => {
    const key = raw.toLowerCase();
    if (!validShortcutKey(key)) { setError(english ? 'Use one letter, digit or punctuation key.' : ui("请输入一个字母、数字或标点按键。")); return; }
    const conflict = key && SHORTCUT_ACTIONS.find(other => other !== action && value[other] === key);
    if (conflict) { setError(english ? `This key is already used for ${labels[conflict][1]}.` : ui("此按键已用于「{0}」。", {"0": labels[conflict][0]})); return; }
    setError(''); onChange({ ...value, [action]: key });
  };
  return <section className="eidos-settings-page">
    <h2>{english ? 'Keyboard shortcuts' : ui("快捷键")}</h2>
    <p className="eidos-settings-description">{english ? 'Bind a single key, or leave blank to disable.' : ui("单键绑定，留空禁用。")}</p>
    <div className="eidos-settings-fields">{SHORTCUT_ACTIONS.map(action => <SettingsField key={action} id={`keyboard-${action}`} label={labels[action][english ? 1 : 0]}>
      <input id={`keyboard-${action}`} className="eidos-settings-control w-full p-2.5 text-sm" autoComplete="off" spellCheck={false} value={value[action]} maxLength={1}
        onChange={event => change(action, event.target.value)} />
    </SettingsField>)}</div>
    {error && <p role="alert" className="eidos-document-notice">{error}</p>}
    <details className="mt-4 text-xs leading-6 eidos-archive-muted"><summary className="cursor-pointer">{english ? 'Fixed shortcuts' : ui("固定快捷键")}</summary><p>{english ? 'Space, Enter and arrows: reading. Escape: close panels. Ctrl/Cmd+Z: undo.' : ui("空格、Enter、方向键：阅读；Esc：关闭面板；Ctrl/Cmd+Z：撤销。")}</p></details>
    <div className="mt-4 flex flex-wrap gap-3">{[[english ? 'Game layout (Z/X/C/A/S/D)' : ui("恢复游戏布局（Z/X/C/A/S/D）"), DEFAULT_SHORTCUTS], [english ? 'Original layout (M/W/G)' : ui("原有布局（M/W/G）"), LEGACY_SHORTCUTS]].map(([label, bindings]) =>
      <button key={String(label)} className="eidos-focus eidos-archive-button" type="button" onClick={() => { setError(''); onChange({ ...bindings as KeyboardShortcuts }); }}>{String(label)}</button>)}</div>
  </section>;
}
