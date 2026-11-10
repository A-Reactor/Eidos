"use client";

import { useCallback, useRef, useState } from "react";
import type { GamePhase } from "@/lib/game/types";
import { InteractionDialog } from "@/components/ui/InteractionDialog";
import { useI18n } from "@/components/shell/LocaleProvider";

export function useSavedNavigation(save: () => Promise<void>, setPhase: (phase: GamePhase) => void) {
  const { locale } = useI18n();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ target: GamePhase; message: string } | null>(null);
  const navigate = useCallback(async (target: GamePhase) => {
    if (locked.current) return;
    // Tool pages retain the live world. They do not need a blocking recovery point.
    if (!["title", "world_select", "world_create"].includes(target)) { setPhase(target); return; }
    locked.current = true; setBusy(true);
    try { await save(); setFailure(null); setPhase(target); }
    catch (error) { setFailure({ target, message: error instanceof Error ? error.message : "Save failed" }); }
    finally { locked.current = false; setBusy(false); }
  }, [save, setPhase]);
  const style = "eidos-focus eidos-dossier-action px-4 py-2 text-sm disabled:opacity-40";
  return {
    navigate, busy,
    dialog: failure ? <InteractionDialog title={text("保存失败，尚未离开", "Save failed — still on this page")} onClose={() => { if (!busy) setFailure(null); }}>
      <p role="alert" className="text-sm">{failure.message}</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className={style} onClick={() => setFailure(null)}>{text("留在这里", "Stay here")}</button>
        <button disabled={busy} className={style} onClick={() => void navigate(failure.target)}>{text("重试保存", "Retry saving")}</button>
        <button disabled={busy} className={style} onClick={() => { setPhase(failure.target); setFailure(null); }}>{text("不保存离开", "Leave without saving")}</button>
      </div>
    </InteractionDialog> : null,
  };
}
