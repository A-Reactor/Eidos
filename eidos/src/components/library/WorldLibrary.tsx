"use client";
import { useMobileLayout } from "@/components/game/use-mobile-layout";
import { BackButton } from "@/components/ui/BackButton";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useGameStore } from "@/store/game-store";
import { formatUsage } from "@/lib/game/usage-format";
import { FileImportCard } from "@/components/ui/FileImportCard";
import { ActionButton } from '@/components/ui/ActionButton';
import { useI18n } from "@/components/shell/LocaleProvider";
import type { PlaythroughMeta, WorldDefinition } from "@/lib/game/types";
import type { WorldLibraryItem } from "./world-library-model";
import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import { ResponsiveSidebar } from "@/components/ui/ResponsiveSidebar";
import { useEscapeBack } from '@/components/ui/use-escape-back';
import { WorldLibraryCard, type WorldLibraryCloseGuard } from "./WorldLibraryCard";

export interface WorldLibraryManagement {
  onRenameWorld: (worldId: string, name: string, subtitle: string) => Promise<boolean>;
  onDeleteWorld: (worldId: string) => Promise<boolean>;
  onDeleteContinuity: (playthroughId: string) => Promise<boolean>;
  onDeleteSave: (saveId: string, playthroughId: string) => Promise<boolean>;
  onCreateInitialSave: (playthrough: PlaythroughMeta, world: WorldDefinition) => Promise<boolean>;
  onExportWorld: (world: WorldDefinition) => Promise<boolean>;
  onExportWorldArchive: (item: WorldLibraryItem) => Promise<boolean>;
}

export interface WorldLibraryProps {
  preview?: boolean;
  items: WorldLibraryItem[];
  sandboxMode?: boolean;
  sandboxDossierId?: string | null;
  notice: string | null;
  loadError: string | null;
  expandedWorldId: string | null;
  expandedContinuityId: string | null;
  onContinue: (saveId: string) => Promise<boolean>;
  onNewContinuity: (world: WorldDefinition) => Promise<boolean>;
  onCreateWorld: () => void;
  onImportWorldFiles: (files: File[]) => Promise<boolean>;
  onImportCard?: () => void;
  onOpenGallery: (world: WorldDefinition) => void;
  onOpenSettings: () => void;
  onBack: () => void;
  onToggleWorld: (worldId: string) => void;
  onToggleContinuity: (continuityId: string) => void;
  management: WorldLibraryManagement;
}

export function WorldLibrary(props: WorldLibraryProps) {
  const tokens = useGameStore(s => s.tokensUsed);
  const cost = useGameStore(s => s.estimatedCost);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const { t, locale } = useI18n();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  const viewKey = `eidos-library-controls-${props.sandboxMode ? "sandbox" : "main"}`;
  const [savedView] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(viewKey) ?? "{}") as { query?: string; sort?: string; scroll?: number }; }
    catch { return {}; }
  });
  const [query, setQuery] = useState(savedView.query ?? "");
  const [sort, setSort] = useState(savedView.sort ?? "recent");
  const stageRef = useRef<HTMLElement>(null);
  const restored = useRef(false);
  useEffect(() => {
    if (props.items.length && !restored.current && stageRef.current) {
      stageRef.current.scrollTop = savedView.scroll ?? 0;
      restored.current = true;
    }
  }, [props.items.length, savedView.scroll]);
  const rememberView = () => {
    if (props.preview) return;
    try { sessionStorage.setItem(viewKey, JSON.stringify({ query, sort, scroll: stageRef.current?.scrollTop ?? 0 })); }
    catch { /* 存储不可用时仍允许浏览和管理世界。 */ }
  };
  useEffect(() => {
    if (props.preview) return;
    try { sessionStorage.setItem(viewKey, JSON.stringify({ query, sort, scroll: stageRef.current?.scrollTop ?? 0 })); }
    catch { /* 会话状态只是导航便利，不阻止操作。 */ }
  }, [props.preview, query, sort, viewKey]);
  const filtered = props.items.filter((item) => `${item.world.name} ${item.world.subtitle}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? a.world.name.localeCompare(b.world.name) : (b.latestSave?.updatedAt ?? 0) - (a.latestSave?.updatedAt ?? 0));
  const { mobile } = useMobileLayout(false);
  const closeGuard = useRef<WorldLibraryCloseGuard>(null);
  const expandedItem = props.items.find(item => item.world.id === props.expandedWorldId);
  const mobileDetails = mobile && Boolean(expandedItem);
  const closeDetails = () => expandedItem && props.onToggleWorld(expandedItem.world.id);
  const afterHeadingSaved = (action: () => void) => closeGuard.current ? closeGuard.current.requestClose(action) : action();
  const goBack = () => afterHeadingSaved(props.onBack);
  useEscapeBack(stageRef, () => afterHeadingSaved(closeDetails), Boolean(expandedItem) && !mobile);
  const isSandbox = props.sandboxMode === true;

  const submitFiles = async (fileList: FileList | File[]) => {
    if (importingRef.current) return;
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.some((file) => !isSupportedImportFile(file))) { setImportError(text("请选择 JSON 或 EIDOS.ZIP 世界文件。", "Choose JSON or EIDOS.ZIP world files.")); return; }
    importingRef.current = true; setImporting(true); setImportError(null);
    try { if (!await props.onImportWorldFiles(files)) setImportError(t("library.actionFailed")); }
    catch { setImportError(t("library.actionFailed")); }
    finally { importingRef.current = false; setImporting(false); }
  };

  return <ArchiveScreen title={t("library.title")} className="eidos-library-screen" navigationPlacement="end" onBack={goBack} covered={mobileDetails}
    headerContent={<input id="world-library-search" type="search" className="eidos-focus eidos-library-search" aria-label={text("搜索世界", "Search worlds")} value={query} onChange={e => setQuery(e.target.value)} placeholder={text("世界名称或副标题", "World name or subtitle")} />}
    action={<div className="eidos-library-header-actions"><select className="eidos-focus eidos-library-sort" aria-label={text("世界排序", "Sort worlds")} value={sort} onChange={e => setSort(e.target.value)}><option value="recent">{text("最近游玩", "Recently played")}</option><option value="name">{text("名称", "Name")}</option></select><ActionButton icon="settings" iconOnly={mobile} label={t("common.settings")} onClick={() => afterHeadingSaved(props.onOpenSettings)} /><BackButton onClick={goBack} label={t("common.back")} /></div>}>
    <div className="eidos-library-layout" inert={mobileDetails} aria-hidden={mobileDetails || undefined}>
      <ResponsiveSidebar className="eidos-library-index" label={t("library.editActions")} current={text('创建 / 导入', 'Create / import')} closeLabel={text('收起菜单', 'Close menu')}>
        <div><p className="eidos-library-brand">{t("title.brand")}</p><p className="eidos-archive-eyebrow mt-2">{isSandbox ? `SANDBOX / ${props.sandboxDossierId ?? "002"}` : t("library.eyebrow")}</p></div>
        <nav aria-label={t("library.editActions")}>
          <button className="eidos-focus" onClick={() => afterHeadingSaved(props.onCreateWorld)}>{t("library.create")}</button>
          <button className="eidos-focus" disabled={importing} onClick={() => inputRef.current?.click()}>{t("library.importWorld")}</button>
          {props.onImportCard && <button className="eidos-focus" onClick={props.onImportCard}>{text('导入酒馆原卡', 'Import Tavern card')}</button>}
        </nav>
        <button className="eidos-focus eidos-library-usage eidos-library-index-usage" data-sidebar-keep-open aria-label={text('总 AI 用量', 'Total AI usage')} aria-expanded={usageExpanded} onClick={() => setUsageExpanded(v => !v)}>Total {formatUsage(tokens, cost, usageExpanded)}</button>
      </ResponsiveSidebar>
      <div className="eidos-library-workspace" data-detail-open={mobileDetails}>
      <main inert={mobileDetails} aria-hidden={mobileDetails || undefined} ref={stageRef} onScroll={rememberView} className="eidos-library-stage">
            {importing && <p role="status" className="mb-4 border-l-2 p-3 text-sm">{text("正在导入世界，请稍候…", "Importing worlds…")}</p>}
            {(importError || props.loadError || props.notice) && <div role={importError || props.loadError ? "alert" : "status"} className="mb-5 border-l-2 border-[var(--eidos-accent)] p-3 text-sm">{importError ?? props.loadError ?? props.notice}</div>}
            {query && !filtered.length && <p className="py-6 text-sm">{text("未找到匹配的世界。", "No matching worlds.")}</p>}
            <ul className="eidos-library-worlds">
              {filtered.map((item, index) => (
                <li key={`${item.world.id}:${index}`} data-expanded={!mobile && props.expandedWorldId === item.world.id}
                  style={{ "--world-expanded-row": Math.floor(index / 2) + 1 } as CSSProperties}>
                  <WorldLibraryCard
                    item={item}
                    closeGuardRef={!mobile && props.expandedWorldId === item.world.id ? closeGuard : undefined}
                    index={index + 1}
                    expanded={!mobile && props.expandedWorldId === item.world.id}
                    expandedContinuityId={props.expandedContinuityId}
                    onToggle={() => afterHeadingSaved(() => props.onToggleWorld(item.world.id))}
                    onToggleContinuity={props.onToggleContinuity}
                    onContinue={props.onContinue}
                    onNewContinuity={props.onNewContinuity}
                    onOpenGallery={props.onOpenGallery}
                    management={props.management}
                  />
                </li>
              ))}
              {isSandbox && props.items.length === 0 && (
                <li className="eidos-library-wide">
                  <div className="eidos-archive-empty">
                    <p className="eidos-archive-eyebrow">
                      SANDBOX / {props.sandboxDossierId ?? "002"}
                    </p>
                    <h2 className="mt-5 text-2xl font-semibold">
                      {t("library.sandboxEmptyTitle")}
                    </h2>
                    <p className="eidos-archive-muted mt-4 max-w-xl text-sm leading-7">
                      {t("library.sandboxEmptyHint")}
                    </p>
                  </div>
                </li>
              )}
              <li><button onClick={() => afterHeadingSaved(props.onCreateWorld)} className="eidos-focus eidos-library-create-card"><span className="block text-lg font-medium">+ {t("library.create")}</span><span className="eidos-archive-muted mt-2 block text-sm leading-6">{t("library.createHint")}</span></button></li>
              <li>
                <FileImportCard
                  label={t("library.importWorldFileLabel")}
                  inputLabel={text("选择世界文件", "Choose world files")}
                  inputRef={inputRef}
                  accept=".json,.zip,.eidos.zip,application/json,application/zip"
                  multiple disabled={importing} onFiles={submitFiles}
                  className="eidos-library-create-card"
                  heading={t("library.importWorld")} description={t("library.importWorldDropHint")} hint={t("library.importWorldHint")}
                />
              </li>

        </ul>
      </main>
      </div>
    </div>
    {mobileDetails && expandedItem && <ArchiveScreen className="eidos-library-detail" title={text('世界详情', 'World details')} subtitle={expandedItem.world.name}
      label={text('世界详情', 'World details')} onBack={closeDetails} swipeBack backLabel={text('返回世界集合', 'Back to worlds')}
      beforeBack={leave => closeGuard.current ? closeGuard.current.requestClose(leave) : leave()}>
      <main className="eidos-library-detail-content">
        <WorldLibraryCard key={expandedItem.world.id} closeGuardRef={closeGuard} item={expandedItem} index={0} expanded
          expandedContinuityId={props.expandedContinuityId} onToggle={closeDetails}
          onToggleContinuity={props.onToggleContinuity} onContinue={props.onContinue}
          onNewContinuity={props.onNewContinuity} onOpenGallery={props.onOpenGallery} management={props.management} />
      </main>
    </ArchiveScreen>}
  </ArchiveScreen>;
}

function isSupportedImportFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".json") || name.endsWith(".zip") || name.endsWith(".eidos.zip");
}
