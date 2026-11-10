'use client';
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { ActionIcon, type ActionIconName } from '@/components/ui/ActionIcon';
import { useRef } from 'react';
import { useEscapeBack } from '@/components/ui/use-escape-back';
export function QuickToolIcon({ name }: { name: ActionIconName }) { return <ActionIcon name={name} />; }
function Toggle({ icon, label, active, onClick }: { icon: ActionIconName; label: string; active: boolean; onClick: () => void }) {
  const ui = useInterfaceText();
  return <button type="button" className="eidos-focus eidos-quick-toggle" aria-label={`${label} · ${active ? ui("开启") : ui("关闭")}`} aria-pressed={active} onClick={onClick}>
    <QuickToolIcon name={icon} /><span>{label}</span><i aria-hidden="true" data-active={active} />
  </button>;
}
export function QuickTools(props: {
  autoAdvance: boolean; autoSelect: boolean; voiceAuto: boolean; stream: boolean; delay: number;
  loading: boolean; canUndo: boolean; allowUndo: boolean;
  onAutoAdvance: () => void; onAutoSelect: () => void; onVoiceAuto: () => void; onStream: () => void;
  onVoice: () => void; onSave: () => void; onUndo: () => void; onSettings: () => void;
  onDelay: (delay: number) => void; onClose: () => void;
}) {
  const ui = useInterfaceText();
  const root = useRef<HTMLDivElement>(null);
  useEscapeBack(root, props.onClose);
  return <div ref={root} data-quick-tools role="dialog" aria-label={ui("播放与快捷设置")} className="eidos-quick-tools">
    <header><span>{ui("播放与快捷设置")}</span><button type="button" className="eidos-focus" aria-label={ui("收起快捷设置")} onClick={props.onClose}><QuickToolIcon name="close" /></button></header>
    <div className="eidos-quick-toggles">
      <Toggle icon="page" label={ui("自动翻页")} active={props.autoAdvance} onClick={props.onAutoAdvance} />
      <Toggle icon="walk" label={ui("自动行进")} active={props.autoSelect} onClick={props.onAutoSelect} />
      <Toggle icon="voice" label={ui("语音自动播放")} active={props.voiceAuto} onClick={props.onVoiceAuto} />
      <Toggle icon="stream" label={ui("流式显示")} active={props.stream} onClick={props.onStream} />
    </div>
    <div className="eidos-quick-delay" role="group" aria-label={ui("自动翻页间隔")}><span>{ui("间隔")}</span>{[1000, 2000, 3000, 5000, 10000].map(delay => <button key={delay} type="button" className="eidos-focus" aria-label={ui("自动翻页间隔 {0}s", {"0": delay / 1000})} aria-pressed={props.delay === delay} onClick={() => props.onDelay(delay)}>{delay / 1000}s</button>)}</div>
    <div className="eidos-quick-actions">
      <button type="button" className="eidos-focus" aria-label={ui("保存进度")} disabled={props.loading} onClick={props.onSave}><QuickToolIcon name="save" /><span>{ui("保存")}</span></button>
      {props.allowUndo && <button type="button" className="eidos-focus" aria-label={ui("撤销行动 · Ctrl+Z")} disabled={!props.canUndo || props.loading} onClick={props.onUndo}><QuickToolIcon name="undo" /><span>{ui("撤销")}</span></button>}
      <button type="button" className="eidos-focus" aria-label={ui("对话语音设置")} onClick={props.onVoice}><QuickToolIcon name="voice" /><span>{ui("语音")}</span></button>
      <button type="button" className="eidos-focus" aria-label={ui("系统设置")} onClick={props.onSettings}><QuickToolIcon name="settings" /><span>{ui("设置")}</span></button>
    </div>
  </div>;
}
