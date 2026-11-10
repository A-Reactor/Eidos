"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useEffect, useMemo } from "react";

import { useGameStore } from "@/store/game-store";
import { getTool } from "@/lib/personality/tools";
import {
  isPermissionUiEffectActive,
  type PermissionUiEffect,
} from "@/lib/personality/ui-effects";

export function PermissionEscalationPanel() {
  const ui = useInterfaceText();
  const pending = useGameStore((s) => s.pendingPermissionRequests);
  const effects = useGameStore((s) => s.permissionUiEffects);
  const confirmPermissionRequest = useGameStore((s) => s.confirmPermissionRequest);
  const denyPermissionRequest = useGameStore((s) => s.denyPermissionRequest);
  const dismissPermissionUiEffect = useGameStore((s) => s.dismissPermissionUiEffect);
  const sandboxMode = useGameStore((s) => s.sandboxMode);

  const activeOverlays = useMemo(
    () => effects.filter((effect) => effect.type === "text_overlay" && isPermissionUiEffectActive(effect)).slice(-3),
    [effects],
  );

  useEffect(() => {
    const timers = activeOverlays
      .filter((effect) => effect.expiresAt)
      .map((effect) => {
        const delay = Math.max(0, (effect.expiresAt ?? 0) - Date.now());
        return window.setTimeout(() => dismissPermissionUiEffect(effect.id), delay);
      });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeOverlays, dismissPermissionUiEffect]);

  return (
    <>
      {activeOverlays.length > 0 && (
        <div className="pointer-events-none fixed left-1/2 top-8 z-[60] flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2">
          {activeOverlays.map((effect) => (
            <OverlayLine key={effect.id} effect={effect} />
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <aside className="fixed right-5 top-20 z-[61] w-[min(360px,calc(100vw-32px))] border border-amber-400/40 bg-black/88 p-4 text-zinc-100 shadow-2xl shadow-black/40 backdrop-blur" aria-label={ui("AI 提权确认")}>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[.18em] text-amber-300">
                {sandboxMode ? "SANDBOX ESCALATION" : "PERMISSION ESCALATION"}
              </p>
              <h2 className="mt-1 text-sm font-semibold">{ui("权限申请待确认")}</h2>
            </div>
            <span className="font-mono text-[10px] text-white/38">{pending.length}</span>
          </div>

          <div className="mt-3 space-y-3">
            {pending.slice(0, 3).map((request) => {
              const tool = getTool(request.toolId);
              return (
                <section key={request.id} className="border-l-2 border-amber-400/60 pl-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">{request.npcId}</p>
                    <span className="font-mono text-[9px] text-amber-200">L{request.decision.grantedLevel ?? "?"}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{tool?.name ?? request.toolId}</p>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-300">{request.motivation}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => confirmPermissionRequest(request.id)}
                      data-text-surface="light" className="eidos-focus bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110"
                    >
                      {ui("允许")}</button>
                    <button
                      type="button"
                      onClick={() => denyPermissionRequest(request.id)}
                      className="eidos-focus border border-white/15 px-3 py-1.5 text-xs text-zinc-300 hover:border-white/35 hover:text-white"
                    >
                      {ui("拒绝")}</button>
                  </div>
                </section>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}

function OverlayLine({ effect }: { effect: PermissionUiEffect }) {
  const text = effect.text?.trim() || "……";
  const style = effect.style === "static" ? "border-white/20 text-white/78" : effect.style === "flicker" ? "border-red-400/50 text-red-100" : "border-amber-300/40 text-amber-100";

  return (
    <div className={`border-l-2 bg-black/78 px-4 py-2 font-mono text-[11px] uppercase tracking-[.12em] shadow-lg backdrop-blur ${style}`}>
      {text}
    </div>
  );
}
