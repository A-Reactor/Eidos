"use client";

import { useRef, useState, type MouseEvent } from "react";
import { useI18n } from "@/components/shell/LocaleProvider";
import { WorldSigil } from "@/components/ui/WorldSigil";
import { useGameStore } from "@/store/game-store";
import type { SandboxSnapshotRecord } from "@/lib/game/sandbox-snapshots";
import { useEscapeBack } from '@/components/ui/use-escape-back';

export function TitleScreen() {
  const {
    setPhase,
    sandboxMode,
    enterSandboxDossier,
    exitSandboxDossier,
    sandboxSnapshots,
    loadSandboxSnapshots,
    restoreSandboxSnapshot,
    createSandboxSnapshot,
    deleteSandboxSnapshot,
  } = useGameStore();
  const { t } = useI18n();
  const dossierNumber = sandboxMode ? t("title.sandboxDossierNumber") : t("title.dossierNumber");
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const snapshotPanel = useRef<HTMLElement>(null);
  useEscapeBack(snapshotPanel, () => setSnapshotDialogOpen(false), snapshotDialogOpen && sandboxMode);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const toggleSandboxDossier = () => {
    if (sandboxMode) {
      exitSandboxDossier();
    } else {
      enterSandboxDossier("002");
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const openSnapshotDialog = () => {
    if (!sandboxMode) return;
    longPressTriggered.current = true;
    setSnapshotDialogOpen(true);
    void loadSandboxSnapshots();
  };

  const handleDossierPointerDown = () => {
    if (!sandboxMode) return;
    clearLongPressTimer();
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(openSnapshotDialog, 600);
  };

  const handleDossierClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (longPressTriggered.current) {
      event.preventDefault();
      longPressTriggered.current = false;
      return;
    }
    toggleSandboxDossier();
  };

  const handleCreateSnapshot = async () => {
    const label = snapshotLabel.trim();
    if (!label) return;
    setCreatingSnapshot(true);
    try {
      await createSandboxSnapshot({ label });
      setSnapshotLabel("");
      await loadSandboxSnapshots();
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string) => {
    setRestoringSnapshotId(snapshotId);
    try {
      const restored = await restoreSandboxSnapshot(snapshotId);
      if (restored) setSnapshotDialogOpen(false);
    } finally {
      setRestoringSnapshotId(null);
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    setDeletingSnapshotId(snapshotId);
    try {
      const deleted = await deleteSandboxSnapshot(snapshotId);
      if (deleted) await loadSandboxSnapshots();
    } finally {
      setDeletingSnapshotId(null);
    }
  };

  return (
    <main className="eidos-title-stage relative grid h-full place-items-center overflow-hidden bg-[#0c0d0f] px-5 py-8 text-zinc-100">
      <div className="eidos-stage-grid pointer-events-none absolute inset-0 opacity-45 [background:repeating-linear-gradient(135deg,transparent_0_46px,rgba(255,255,255,.025)_46px_47px)]" />
      <div className="eidos-stage-diagonal pointer-events-none absolute left-[8%] top-0 h-[130%] w-px -rotate-[24deg] bg-[var(--eidos-accent)]/35" />
      <section className="eidos-glass eidos-cut-corner relative grid w-full max-w-5xl overflow-hidden border-l-2 border-l-[var(--eidos-accent)] md:grid-cols-[.72fr_1.28fr]" aria-labelledby="title-heading">
        <div className="eidos-paper relative flex min-h-64 items-center justify-center overflow-hidden p-10">
          <div className="absolute -right-20 top-8 h-px w-64 -rotate-45 bg-[var(--eidos-accent)]" />
          <WorldSigil seed="eidos-archive" accent="var(--eidos-accent)" label={t("title.sigil")} className="h-44 w-44 text-black/55" />
          <span className="absolute bottom-6 left-7 font-mono text-[9px] uppercase tracking-[.22em] text-black/45">
            {t("title.kickerPrefix")}{" "}
            <button
              type="button"
              aria-label={sandboxMode ? t("title.exitSandboxDossier") : t("title.enterSandboxDossier")}
              onPointerDown={handleDossierPointerDown}
              onPointerUp={clearLongPressTimer}
              onPointerCancel={clearLongPressTimer}
              onPointerLeave={clearLongPressTimer}
              onClick={handleDossierClick}
              className="eidos-focus rounded-[2px] text-black/45 transition-colors hover:text-[var(--eidos-accent)] focus-visible:text-[var(--eidos-accent)]"
            >
              {dossierNumber}
            </button>
          </span>
        </div>
        <div className="flex flex-col justify-center p-8 sm:p-12 md:p-16">
          <p className="font-mono text-[10px] uppercase tracking-[.3em] text-[var(--eidos-accent)]">{t("title.tagline")}</p>
          <h1 id="title-heading" className="mt-4 text-6xl font-semibold tracking-[-.06em] sm:text-8xl">{t("title.brand")}</h1>
          <div className="my-7 h-px w-full bg-white/15"><div className="h-px w-20 bg-[var(--eidos-accent)]" /></div>
          <p className="max-w-lg text-sm leading-7 text-zinc-400">{t("title.description")}</p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <button onClick={() => setPhase("world_select")} className="eidos-focus eidos-title-primary bg-[var(--eidos-accent)] px-7 py-3 text-xs font-semibold uppercase tracking-[.16em] text-white hover:brightness-110">{t("title.enter")} →</button>
            <button onClick={() => setPhase("settings")} className="eidos-focus border-b border-white/25 pb-1 text-xs uppercase tracking-[.14em] text-zinc-400 hover:border-[var(--eidos-accent)] hover:text-white">{t("common.settings")}</button>
          </div>
        </div>
      </section>
      {snapshotDialogOpen && sandboxMode && (
        <div
          data-testid="sandbox-snapshot-backdrop"
          onClick={() => setSnapshotDialogOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4"
        >
          <section
            ref={snapshotPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sandbox-snapshot-title"
            onClick={(event) => event.stopPropagation()}
            className="eidos-glass eidos-cut-corner w-full max-w-lg border border-white/18 bg-[#101114]/95 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="sandbox-snapshot-title" className="font-mono text-xs uppercase tracking-[.22em] text-[var(--eidos-accent)]">
                {t("title.sandboxSnapshots")}
              </h2>
              <button
                type="button"
                aria-label={t("title.closeSandboxSnapshots")}
                onClick={() => setSnapshotDialogOpen(false)}
                className="eidos-focus border-b border-white/20 pb-1 text-[10px] uppercase tracking-[.14em] text-zinc-400 hover:border-[var(--eidos-accent)] hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-2">
              <label htmlFor="sandbox-snapshot-label" className="font-mono text-[9px] uppercase tracking-[.16em] text-zinc-500">
                {t("title.sandboxSnapshotLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  id="sandbox-snapshot-label"
                  value={snapshotLabel}
                  onChange={(event) => setSnapshotLabel(event.target.value)}
                  placeholder={t("title.sandboxSnapshotLabelPlaceholder")}
                  className="eidos-focus min-w-0 flex-1 border border-white/15 bg-white/[.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
                />
                <button
                  type="button"
                  onClick={handleCreateSnapshot}
                  disabled={creatingSnapshot || !snapshotLabel.trim()}
                  className="eidos-focus bg-[var(--eidos-accent)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[.14em] text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {creatingSnapshot ? "..." : t("title.createSandboxSnapshot")}
                </button>
              </div>
            </div>

            <div className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {sandboxSnapshots.length === 0 ? (
                <div className="border border-white/10 bg-white/[.03] p-4">
                  <p className="text-sm text-zinc-400">{t("title.noSandboxSnapshots")}</p>
                </div>
              ) : (
                sandboxSnapshots.map((snapshot) => (
                  <SnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    restoring={restoringSnapshotId === snapshot.id}
                    deleting={deletingSnapshotId === snapshot.id}
                    restoreLabel={t("title.restoreSandboxSnapshot")}
                    deleteLabel={t("title.deleteSandboxSnapshot")}
                    protectedLabel={t("title.sandboxSnapshotProtected")}
                    onRestore={() => void handleRestoreSnapshot(snapshot.id)}
                    onDelete={() => void handleDeleteSnapshot(snapshot.id)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SnapshotRow({
  snapshot,
  restoring,
  deleting,
  restoreLabel,
  deleteLabel,
  protectedLabel,
  onRestore,
  onDelete,
}: {
  snapshot: SandboxSnapshotRecord;
  restoring: boolean;
  deleting: boolean;
  restoreLabel: string;
  deleteLabel: string;
  protectedLabel: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="border border-white/10 bg-white/[.03] p-3">
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-100">{snapshot.label}</span>
          <span className="mt-2 block font-mono text-[9px] uppercase tracking-[.12em] text-zinc-500">
            {formatSnapshotDate(snapshot.createdAt)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {snapshot.protected && (
            <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--eidos-accent)]">
              {protectedLabel}
            </span>
          )}
          <button
            type="button"
            aria-label={`${restoreLabel} ${snapshot.label}`}
            onClick={onRestore}
            disabled={restoring}
            className="eidos-focus border border-white/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-zinc-200 transition-colors hover:border-[var(--eidos-accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            {restoring ? "..." : restoreLabel}
          </button>
          <button
            type="button"
            aria-label={`${deleteLabel} ${snapshot.label}`}
            onClick={onDelete}
            disabled={deleting}
            className="eidos-focus border border-red-400/25 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-red-200/80 transition-colors hover:border-red-300/60 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {deleting ? "..." : deleteLabel}
          </button>
        </span>
      </span>
    </div>
  );
}

function formatSnapshotDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  return new Date(timestamp).toLocaleString();
}
