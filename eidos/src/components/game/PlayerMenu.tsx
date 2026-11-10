"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { CausalTracker } from './CausalTracker';

interface Props {
  onClose: () => void;
  onSave: () => void;
  onSettings: () => void;
  onGallery: () => void;
  onImages: () => void;
  onVoices: () => void;
  onDocuments: () => void;
  onTrace: () => void;
  busy: boolean;
  usage: string;
}
export function PlayerMenu(props: Props) {
  const ui = useInterfaceText();
  const style = 'eidos-focus eidos-dossier-action px-4 py-3 text-left text-sm disabled:opacity-40';
  return <InteractionDialog title={ui("菜单")} onClose={props.onClose}>
    <div className="max-h-[70vh] space-y-4 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3">
        <button className={style} disabled={props.busy} onClick={props.onSave}>{ui("存档")}</button>
        <button className={style} disabled={props.busy} onClick={props.onSettings}>{ui("设置")}</button>
        <button className={style} disabled={props.busy} onClick={props.onGallery}>{ui("图像管理")}</button>
        <button className={style} onClick={props.onVoices}>{ui("音频管理")}</button>
        <button className={style} onClick={props.onDocuments}>{ui("文档管理")}</button>
        <button className={style} onClick={props.onImages}>{ui("图像服务")}</button>
        <button className={style} onClick={props.onClose}>{ui("继续游戏")}</button>
      </div>
      <details className="border-t border-black/20 pt-4">
        <summary className="eidos-focus cursor-pointer text-sm">{ui("开发诊断（含幕后信息）")}</summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm">{ui("AI 用量 ·")}{props.usage}</p>
          <button className={style} onClick={props.onTrace}>{ui("人格诊断")}</button>
          <CausalTracker />
        </div>
      </details>
    </div>
  </InteractionDialog>;
}
