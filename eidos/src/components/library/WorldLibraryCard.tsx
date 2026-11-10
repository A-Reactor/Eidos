"use client";

import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { useI18n } from "@/components/shell/LocaleProvider";
import { WorldLibraryHeading, type WorldLibraryHeadingHandle } from "./WorldLibraryHeading";
import { WorldSigil } from "@/components/ui/WorldSigil";
import { InteractionDialog } from "@/components/ui/InteractionDialog";
import type { WorldDefinition } from "@/lib/game/types";
import { formatRelativeUpdate } from "@/lib/ui/i18n";
import { resolveThemeForWorld } from "@/lib/ui/theme";
import type { WorldLibraryManagement } from "./WorldLibrary";
import type { WorldLibraryItem } from "./world-library-model";

export interface WorldLibraryCloseGuard { requestClose: (leave: () => void) => void }

interface WorldLibraryCardProps {
  closeGuardRef?: Ref<WorldLibraryCloseGuard>;
  item: WorldLibraryItem;
  index: number;
  expanded: boolean;
  expandedContinuityId: string | null;
  onToggle: () => void;
  onToggleContinuity: (id: string) => void;
  onContinue: (saveId: string) => Promise<boolean>;
  onNewContinuity: (world: WorldDefinition) => Promise<boolean>;
  onOpenGallery: (world: WorldDefinition) => void;
  management: WorldLibraryManagement;
}

type Confirmation = { kind: "world" | "continuity" | "save"; id: string; name: string; count?: number; action: () => Promise<boolean> };
const button = "eidos-focus eidos-archive-button disabled:cursor-wait disabled:opacity-45";

export function WorldLibraryCard(props: WorldLibraryCardProps) {
  const { item, expanded } = props;
  const { locale, t } = useI18n();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const heading = useRef<WorldLibraryHeadingHandle>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const theme = useMemo(() => resolveThemeForWorld(item.world), [item.world]);
  const selected = item.continuities.find((c) => c.id === props.expandedContinuityId) ?? item.continuities[0];
  // Outside clicks may save a new title before React receives refreshed library props.
  const savedWorld = () => heading.current?.getWorld() ?? item.world;
  const closeEditOrNavigate = (action: () => void) => {
    const saved = heading.current?.commit() ?? true;
    if (typeof saved === 'boolean') { if (saved) action(); }
    else void saved.then(success => { if (success) action(); });
  };
  useImperativeHandle(props.closeGuardRef, () => ({ requestClose: action => {
    if (!pendingRef.current && !confirmation) closeEditOrNavigate(action);
  } }));
  const run = async (action: () => Promise<boolean>, success?: () => void) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setError(null);
    try {
      const saved = heading.current?.commit() ?? true;
      if (typeof saved === 'boolean' ? !saved : !await saved) return;
      if (await action()) success?.(); else setError(t("library.actionFailed"));
    } catch { setError(t("library.actionFailed")); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const date = (timestamp: number) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
  const toggleLabel = t(expanded ? "library.collapseWorld" : "library.expandWorld", { name: item.world.name });
  const confirmLabel = confirmation?.kind === "world" ? t("common.confirmRemove") : t("common.confirmDelete");
  const manual = selected?.saves.filter((s) => !s.id.startsWith("autosave_")) ?? [];
  const automatic = selected?.saves.filter((s) => s.id.startsWith("autosave_")) ?? [];
  const saveRows = (saves: typeof manual, system = false) => saves.map((save) => {
    const label = system ? (save.id.startsWith("autosave_prev_") ? text("上一步保护", "Previous recovery point") : t("library.autosave")) : save.name;
    return <li key={save.id} className="flex flex-wrap items-center gap-3 border-t border-current/15 py-4">
      <div className="min-w-0 flex-1"><b className="text-sm font-medium">{label}</b><p className="mt-1 text-xs opacity-65">{text("第", "Day ")}{save.gameTime.day}{text("日 · ", " · ")}{save.currentSceneName} · {date(save.updatedAt)}</p><p className="mt-1 line-clamp-2 text-sm opacity-65">{save.preview}</p></div>
      <button disabled={pending} aria-label={`${label} ${t("library.loadSave")}`} onClick={() => void run(() => props.onContinue(save.id))} className={button}>{text("载入", "Load")}</button>
      {!system && <button disabled={pending} aria-label={t("library.deleteSave")} className={`${button} text-red-600`} onClick={() => setConfirmation({ kind: "save", id: save.id, name: save.name, action: () => props.management.onDeleteSave(save.id, selected.id) })}>{text("删除", "Delete")}</button>}
    </li>;
  });

  return <article aria-busy={pending} className="eidos-library-world" data-expanded={expanded}>
    <header className="eidos-library-world-header" onClick={event => {
      if (!expanded || pendingRef.current || (event.target as HTMLElement).closest('[role="textbox"], button')) return;
      closeEditOrNavigate(props.onToggle);
    }}>
      <WorldSigil seed={theme.sigilSeed} accent={theme.accent} label={t("library.sigil", { name: item.world.name })} className="h-16 w-16 shrink-0 opacity-60" />
      {expanded ? <WorldLibraryHeading world={item.world} disabled={pending} editorRef={heading}
        onSave={(name, subtitle) => props.management.onRenameWorld(item.world.id, name, subtitle)} onError={setError} /> : <button type="button" disabled={pending} onClick={() => closeEditOrNavigate(props.onToggle)} aria-label={toggleLabel} aria-expanded={expanded} className="eidos-focus eidos-library-heading-trigger min-w-[150px] flex-1 cursor-pointer text-left">
        <span className="block text-2xl font-semibold" role="heading" aria-level={2}>{item.world.name}</span>
        <span data-edit-field="subtitle" className="mt-1 block text-sm opacity-65">{item.world.subtitle}</span>
      </button>}
    </header>

    {error && <p role="alert" className="border-l-4 border-red-600 bg-red-500/10 p-4 text-sm text-red-600">{error}</p>}
    {pending && <p role="status" className="px-5 py-2 text-sm">{text("正在处理，请稍候…", "Working…")}</p>}

    {!expanded ? <>
      <p className="mt-4 line-clamp-2 text-sm leading-6 opacity-65">{item.world.overview.replace(/^#+\s*/gm, "")}</p>
      <p className="mt-4 text-xs opacity-60">{t("library.worldMeta", { continuities: item.continuityCount, saves: item.saveCount })}</p>
      {item.latestSave && <button disabled={pending} onClick={() => void run(() => props.onContinue(item.latestSave!.id))} className={`${button} mt-4`} data-variant="primary">{t("library.continue")} →<span className="ml-2 text-xs opacity-70">{item.latestSave.playerName} · {formatRelativeUpdate(locale, item.latestSave.updatedAt)}</span></button>}
    </> : <>
      <details className="eidos-library-overview"><summary className="eidos-focus">{text("世界简介", "About this world")}</summary><p>{item.world.overview.replace(/^#+\s*/gm, "")}</p></details>
      <section aria-label={text("世界操作", "World actions")} className="eidos-library-world-actions border-b border-current/15 p-5">
        <div className="flex flex-wrap gap-2">
          <button disabled={pending} onClick={() => void run(() => props.management.onExportWorld(savedWorld()))} className={`${button} eidos-library-export`} title={text("仅世界设定，不含游戏进度", "World definition only; excludes progress")}>{t("library.exportWorld")}</button>
          <button disabled={pending} onClick={() => void run(() => props.management.onExportWorldArchive({ ...item, world: savedWorld() }))} aria-label={t("library.exportWorldArchive")} title={text("世界设定、全部周目、存档和世界线；从世界书库导入恢复", "World, all playthroughs, saves and timelines; restore from the library")} className={`${button} eidos-library-export`}>{text("导出全部", "Export all")}</button>
          <button disabled={pending} onClick={() => setConfirmation({ kind: "world", id: item.world.id, name: item.world.name, action: () => props.management.onDeleteWorld(item.world.id) })} className={`${button} text-red-600`}>{t("library.deleteWorld")}</button>
        </div>
      </section>
      <div className="eidos-library-records grid md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="eidos-library-continuities border-b border-current/15 p-5 md:border-b-0 md:border-r">
          <h3 className="mb-3 text-sm font-semibold">{text("周目", "Playthroughs")} · {item.continuityCount}</h3>
          <div className="eidos-library-continuity-list">{item.continuities.map((c) => <button key={c.id} disabled={pending} aria-pressed={selected?.id === c.id} onClick={() => { props.onToggleContinuity(c.id); setAutoOpen(false); }} className={`${button} eidos-library-continuity-row`}><span className="eidos-library-continuity-name">{c.name}</span><span className="eidos-library-continuity-meta">{c.playerName || text("尚未选择身份", "Identity pending")} · {t("library.active")}</span></button>)}</div>
          <button disabled={pending} aria-label={t("library.newContinuity")} title={text("开始新游戏", "New playthrough")} onClick={() => closeEditOrNavigate(() => void run(() => props.onNewContinuity(savedWorld())))} className={`${button} eidos-library-add-continuity mt-4`}>+</button>
        </aside>
        <section className="eidos-library-saves min-w-0 p-5">
          {selected ? <>
            <div className="mb-5 flex flex-wrap items-center gap-3"><h3 className="flex-1 text-lg font-semibold">{selected.name}</h3><button disabled={pending} aria-label={t("library.deleteContinuity")} className={`${button} eidos-library-delete-continuity text-red-600`} onClick={() => setConfirmation({ kind: "continuity", id: selected.id, name: selected.name, count: selected.saves.length, action: () => props.management.onDeleteContinuity(selected.id) })}>{text("删除此周目", "Delete playthrough")}</button></div>
            {selected.saves[0] ? <button disabled={pending} onClick={() => void run(() => props.onContinue(selected.saves[0].id))} className={`${button} mb-6 w-full py-3 text-left`} data-variant="primary"><b>{text("继续此周目", "Continue playthrough")} →</b><span className="mt-1 block text-xs">{text("最近存档：", "Latest save: ")}{selected.saves[0].currentSceneName} · {date(selected.saves[0].updatedAt)}</span></button> : <button disabled={pending} aria-label={t("library.createInitialSave")} onClick={() => void run(() => props.management.onCreateInitialSave(selected, savedWorld()))} className={`${button} mb-5`}>{text("完成开局设置", "Complete identity setup")}</button>}
            <h4 className="text-sm font-semibold">{text("手动存档", "Manual saves")} · {manual.length}</h4>
            {manual.length ? <ul>{saveRows(manual)}</ul> : <p className="py-4 text-sm opacity-60">{text("尚无手动存档。在游戏中点击“存档”创建。", "No manual saves yet. Use Save in the game.")}</p>}
            <button aria-expanded={autoOpen} disabled={pending} onClick={() => setAutoOpen((v) => !v)} className={`${button} mt-4 w-full text-left`}>{autoOpen ? "−" : "+"} {text("自动恢复点", "Automatic recovery points")} · {automatic.length}</button>
            {autoOpen && <div className="mt-3"><p className="text-xs opacity-65">{text("自动保护由系统维护，不占用手动存档。", "Maintained by the system, separate from manual saves.")}</p><ul>{saveRows(automatic, true)}</ul></div>}
          </> : <p className="py-12 text-center text-sm opacity-65">{text("暂无游戏记录，点击「＋」开始新游戏。", "No playthroughs yet. Choose + to begin.")}</p>}
        </section>
      </div>
    </>}
    {confirmation && <InteractionDialog title={`${confirmLabel} · ${confirmation.name}`} onClose={() => { if (!pending) setConfirmation(null); }}>
      <p className="text-sm leading-6">{confirmation.kind === "world" ? t("library.removeWorldNotice") : confirmation.kind === "continuity" ? text(`将永久删除此周目、${confirmation.count} 个存档和世界线历史。其他周目不受影响。`, `Permanently deletes this playthrough, ${confirmation.count} saves and its history. Other playthroughs are kept.`) : text("将永久删除这个手动存档，其他存档保留。", "Permanently deletes this manual save. Other saves are kept.")}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3"><button disabled={pending} className={button} onClick={() => setConfirmation(null)}>{t("common.cancel")}</button><button disabled={pending} className={`${button} text-red-600`} onClick={() => void run(confirmation.action, () => setConfirmation(null))}>{confirmLabel}</button></div>
    </InteractionDialog>}
  </article>;
}
