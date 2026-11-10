"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useGameStore } from "@/store/game-store";

/** 右下角浮动返回按钮 —— 用于所有子界面 */
export function FloatingBack() {
  const ui = useInterfaceText();
  const goBack = useGameStore((s) => s.goBack);

  return (
    <button
      onClick={goBack}
      className="eidos-focus eidos-dossier-action fixed bottom-6 right-6 z-50 px-4 py-2 text-xs"
    >
      {ui("返回")}</button>
  );
}
