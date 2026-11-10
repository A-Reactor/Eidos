"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useRef } from "react";
import { useEscapeBack } from '@/components/ui/use-escape-back';
import type { SceneRegion } from "@/lib/game/types";

export function ExamineOverlay({ region, detailImageUrl, onClose }: {
  region: SceneRegion; detailImageUrl: string | null; backgroundUrl?: string | null; onClose: () => void;
}) {
  const ui = useInterfaceText();
  const root = useRef<HTMLDivElement>(null);
  useEscapeBack(root, onClose);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [onClose]);
  return <div ref={root} role="dialog" aria-modal="true" aria-label={region.name} className="fixed inset-0 z-40 bg-black/95 flex items-center justify-center cursor-zoom-out" onClick={onClose}>
    <div className="max-w-[90vw] text-center text-zinc-300" onClick={event => event.stopPropagation()}>
      {detailImageUrl && <img src={detailImageUrl} alt={region.name} className="max-h-[80vh] object-contain" />}
      <h2 className="mt-4 text-lg">{region.name}</h2>
      <p className="mt-2 text-sm text-zinc-400">{region.examineHint || ui("暂无细节说明")}</p>
      <button className="eidos-focus mt-5 px-4 py-2 text-sm" onClick={onClose}>{ui("关闭")}</button>
    </div>
  </div>;
}
