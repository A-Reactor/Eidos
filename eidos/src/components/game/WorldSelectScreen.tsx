"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { WorldLibrary } from "@/components/library/WorldLibrary";
import { CardImportDialog, type CardMountRequest } from '@/components/library/CardImportDialog';
import { importCardAsset } from '@/lib/game/cards/storage';
import { mountCardWorld } from '@/lib/game/cards/binding';
import { exportWorldCardFiles, restoreWorldCardFiles } from '@/lib/game/cards/transfer';
import { buildWorldLibraryItems, type WorldLibraryItem } from "@/components/library/world-library-model";
import { createWorldContinuity } from "@/components/library/world-library-controller";
import { useI18n } from "@/components/shell/LocaleProvider";
import { getBuiltInWorld } from "@/lib/ai/builtin-worlds";
import {
  finalizeImportedWorld,
  parseWorldImportFiles,
  parseZipImport,
  type ImportSourceFile,
} from "@/lib/game/import-records";
import { collectArchiveRecovery, readArchiveRecovery, restoreArchiveRecovery } from "@/lib/game/archive-transfer";
import { exportPackage } from "@/lib/game/package-download";
import { sanitizeExportName } from '@/lib/game/export-records';
import type { PlaythroughMeta, SaveSlot, WorldDefinition } from "@/lib/game/types";
import {
  buildWorldArchiveExportPackage,
  buildWorldOnlyExportPackage,
} from "@/lib/game/world-export";
import { loadPlayerWorlds, renameWorldData, useGameStore } from "@/store/game-store";
import { assembleLibraryWorlds, rememberLibraryWorldRemoval } from '@/lib/game/library-worlds';
import { demoWorld, installArchivePreset } from '@/lib/game/archive-presets';

export function WorldSelectScreen({ preview = false }: { preview?: boolean } = {}) {
  const { t } = useI18n();
  const legacyWorld = useMemo(() => getBuiltInWorld(), []);
  const {
    setPhase, setCurrentWorld, loadGame, playerWorlds,
    createPlaythrough, setCurrentPlaythrough, initWorldLine,
    cachedSaveSlots, cachedPlaythroughs, loadIndices, setGalleryWorld,
    addPlayerWorld, deleteSave, deletePlaythrough,
    sandboxMode, sandboxDossierId, sandboxWorlds, loadSandboxWorlds,
    addSandboxWorld, removeSandboxWorld, exitSandboxDossier,
  } = useGameStore();
  const hasLegacyProgress = cachedPlaythroughs.some(pt => pt.worldId === legacyWorld.id)
    || cachedSaveSlots.some(save => save.worldId === legacyWorld.id);
  const [availableWorlds, setAvailableWorlds] = useState<WorldDefinition[]>(() =>
    sandboxMode ? sandboxWorlds : [demoWorld],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardImportOpen, setCardImportOpen] = useState(false);
  const viewKey = `eidos_library_view_${sandboxMode ? sandboxDossierId : "main"}`;
  const readView = (field: string): string | null => { try { return JSON.parse(sessionStorage.getItem(viewKey) ?? "{}")[field] ?? null; } catch { return null; } };
  const [expandedWorldId, setExpandedWorldId] = useState<string | null>(() => readView("world"));
  const [expandedContinuityId, setExpandedContinuityId] = useState<string | null>(() => readView("continuity"));
  useEffect(() => { if (preview) return; try { sessionStorage.setItem(viewKey, JSON.stringify({ world: expandedWorldId, continuity: expandedContinuityId })); } catch {} }, [preview, viewKey, expandedWorldId, expandedContinuityId]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparingArchive = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    preparingArchive.current = (async () => {
      try {
        await installArchivePreset({ sandboxMode, sandboxDossierId }, async world => {
          const worlds = await loadSandboxWorlds(sandboxDossierId);
          if (!worlds.some(existing => existing.id === world.id)) await addSandboxWorld(world, sandboxDossierId);
        });
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '预置周目读取失败');
      }
      if (!cancelled) await loadIndices();
    })().catch(error => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : '存档读取失败');
    });
    return () => { cancelled = true; preparingArchive.current = null; };
  }, [preview, loadIndices, sandboxDossierId, sandboxMode, loadSandboxWorlds, addSandboxWorld]);

  useEffect(() => {
    if (sandboxMode) {
      let cancelled=false;
      Promise.resolve(loadSandboxWorlds(sandboxDossierId)).catch(error=>{
        if(!cancelled) setLoadError(error instanceof Error ? error.message : '沙盒世界集合读取失败');
      });
      return ()=>{cancelled=true;};
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const presets = hasLegacyProgress ? [demoWorld, { ...legacyWorld, subtitle: `${legacyWorld.subtitle} · 旧版存档` }] : [demoWorld];
      try { setAvailableWorlds(assembleLibraryWorlds(presets, loadPlayerWorlds())); }
      catch (error) { setLoadError(error instanceof Error ? error.message : '世界集合读取失败'); }
    });
    return () => { cancelled = true; };
  }, [hasLegacyProgress, legacyWorld, loadSandboxWorlds, sandboxDossierId, sandboxMode]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  const assembledWorlds = useMemo(() => {
    if (sandboxMode) return sandboxWorlds;
    const worlds = [...availableWorlds];
    for (const world of playerWorlds) {
      if (!worlds.some((candidate) => candidate.id === world.id)) worlds.push(world);
    }
    return worlds;
  }, [availableWorlds, playerWorlds, sandboxMode, sandboxWorlds]);

  const items = useMemo(
    () => buildWorldLibraryItems(assembledWorlds, cachedPlaythroughs, cachedSaveSlots),
    [assembledWorlds, cachedPlaythroughs, cachedSaveSlots],
  );

  const showNotice = (message: string, duration = 2_500) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    // The result remains visible until the next operation; it must not vanish offscreen.
  };

  const handleNewContinuity = async (world: WorldDefinition): Promise<boolean> => {
    await preparingArchive.current;
    return createWorldContinuity(world, {
      setCurrentWorld,
      createPlaythrough,
      setCurrentPlaythrough,
      initWorldLine,
      deletePlaythrough,
      enterIdentityPhase: () => setPhase("identity"),
    });
  };

  const handleContinue = async (saveId: string): Promise<boolean> => {
    try {
      if (await loadGame(saveId)) {
        setPhase("playing");
        return true;
      }
    } catch {
      // The localized load error below is the recovery path for rejected and false outcomes.
    }
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setLoadError(t("library.loadError"));
    errorTimer.current = setTimeout(() => setLoadError(null), 3_000);
    return false;
  };

  const handleDeleteSave = async (saveId: string, playthroughId: string): Promise<boolean> => {
    try {
      const existed = cachedSaveSlots.some((save) => save.id === saveId);
      await deleteSave(saveId);
      const state = useGameStore.getState();
      if (!existed || state.cachedSaveSlots.some((save) => save.id === saveId)) return false;
      const remaining = (state.cachedSaveSlots as SaveSlot[]).filter(
        (save) => save.playthroughId === playthroughId,
      );
      if (remaining.length === 0) {
        const playthrough = (state.cachedPlaythroughs as PlaythroughMeta[]).find(
          (candidate) => candidate.id === playthroughId,
        );
        if (playthrough) {
          const world = state.playerWorlds?.find(
            (candidate: WorldDefinition) => candidate.id === playthrough.worldId,
          );
          if (world || state.currentWorld?.id === playthrough.worldId) {
            showNotice(t("library.deletedLastSave"), 4_000);
          }
        }
      } else {
        showNotice(t("library.deletedSave", { count: remaining.length }));
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleCreateInitialSave = async (playthrough: PlaythroughMeta, world: WorldDefinition): Promise<boolean> => {
    try {
      setCurrentWorld(world);
      setCurrentPlaythrough(playthrough.id);
      await initWorldLine(playthrough.id, world.id);
      setPhase("identity");
      showNotice(t("library.createdInitialSave"));
      return true;
    } catch {
      return false;
    }
  };

  const handleImportWorldFiles = async (files: File[]): Promise<boolean> => {
    try {
      await preparingArchive.current;
      const sources = await readImportFiles(files);
      const parsed = parseWorldImportFiles(sources);
      await restoreWorldCardFiles(sources, parsed.world);
      const recovery = readArchiveRecovery(sources, parsed.world);
      const existingWorldIds = new Set(assembledWorlds.map((world) => world.id));
      const imported = finalizeImportedWorld(parsed.world, { existingWorldIds });
      if (recovery) {
        await restoreArchiveRecovery(recovery, imported, { sandboxMode, sandboxDossierId });
        await loadIndices();
      }
      if (sandboxMode) {
        await addSandboxWorld(imported, sandboxDossierId);
      } else {
        addPlayerWorld(imported);
      }

      setAvailableWorlds((worlds) => {
        if (worlds.some((world) => world.id === imported.id)) return worlds;
        return [...worlds, imported];
      });
      showNotice(
        recovery
          ? t("library.importedWorldWithRestore", { name: imported.name })
          : t("library.importedWorld", { name: imported.name }),
        4_000,
      );
      setExpandedWorldId(imported.id);
      setExpandedContinuityId(null);
      return true;
    } catch {
      if (errorTimer.current) clearTimeout(errorTimer.current);
      setLoadError(t("library.importFailed"));
      errorTimer.current = setTimeout(() => setLoadError(null), 4_000);
      return false;
    }
  };

  const handleExportWorld = async (world: WorldDefinition): Promise<boolean> => {
    try {
      const result = await exportPackage(async () => buildWorldOnlyExportPackage(world, { cardFiles: await exportWorldCardFiles(world) }), `${sanitizeExportName(world.name)}_world.eidos.zip`);
      if (result === "cancelled") {
        showNotice(t("library.exportCancelled"));
        return true;
      }

      showNotice(t("library.exportedWorld", { name: world.name }), 3_000);
      return true;
    } catch {
      return false;
    }
  };

  const handleExportWorldArchive = async (item: WorldLibraryItem): Promise<boolean> => {
    try {
      const result = await exportPackage(
        async () => buildWorldArchiveExportPackage({
          world: item.world,
          cardFiles: await exportWorldCardFiles(item.world),
          continuities: item.continuities,
          recovery: await collectArchiveRecovery(item.world.id, item.continuities, { sandboxMode, sandboxDossierId }),
        }), `${sanitizeExportName(item.world.name)}_world_archive.eidos.zip`,
      );
      if (result === "cancelled") {
        showNotice(t("library.exportCancelled"));
        return true;
      }

      showNotice(t("library.exportedWorldArchive", { name: item.world.name }), 3_000);
      return true;
    } catch {
      return false;
    }
  };

  const handleDeleteContinuity = async (playthroughId: string): Promise<boolean> => {
    try {
      const existed = cachedPlaythroughs.some((playthrough) => playthrough.id === playthroughId);
      await deletePlaythrough(playthroughId);
      if (!existed || useGameStore.getState().cachedPlaythroughs.some((playthrough) => playthrough.id === playthroughId)) return false;
      setExpandedContinuityId(null);
      showNotice(t("library.deletedContinuity"));
      return true;
    } catch {
      return false;
    }
  };

  const handleRenameWorld = async (worldId: string, name: string, subtitle: string): Promise<boolean> => {
    try {
      if (sandboxMode) {
        const world = assembledWorlds.find((candidate) => candidate.id === worldId);
        if (!world) return false;
        const updatedWorld = { ...world, name, subtitle };
        await addSandboxWorld(updatedWorld, sandboxDossierId);
        setAvailableWorlds((worlds) =>
          worlds.map((candidate) => candidate.id === worldId ? updatedWorld : candidate),
        );
        return true;
      }

      const result = await renameWorldData(worldId, name, cachedSaveSlots, subtitle, assembledWorlds.find(world => world.id === worldId));
      if (!result) return false;
      const update = (world: WorldDefinition) => world.id === worldId
        ? { ...world, name, subtitle }
        : world;
      setAvailableWorlds((worlds) => worlds.map(update));
      useGameStore.setState({ playerWorlds: result.worlds, cachedSaveSlots: result.slots });
      return true;
    } catch {
      return false;
    }
  };

  const handleDeleteWorld = async (worldId: string): Promise<boolean> => {
    try {
      await preparingArchive.current;
      if (sandboxMode) {
        await removeSandboxWorld(worldId, sandboxDossierId);
        if (useGameStore.getState().sandboxWorlds.some((world: WorldDefinition) => world.id === worldId)) return false;
      } else {
        rememberLibraryWorldRemoval(worldId);
        useGameStore.getState().removePlayerWorld(worldId);
        if (loadPlayerWorlds().some((world) => world.id === worldId)) return false;
      }
      setAvailableWorlds((worlds) => worlds.filter((world) => world.id !== worldId));
      setExpandedWorldId(null);
      setExpandedContinuityId(null);
      showNotice(t("library.deletedWorld"));
      return true;
    } catch {
      return false;
    }
  };

  const handleToggleWorld = (worldId: string) => {
    setExpandedWorldId((current) => current === worldId ? null : worldId);
    setExpandedContinuityId(null);
  };

  const handleMountCard = async (request: CardMountRequest) => {
    const asset = await importCardAsset(request.bytes, request.filename);
    if (request.saveOnly) { showNotice(`已保存原卡：${asset.name}`); return; }
    const world = mountCardWorld({ asset, role: request.role, world: assembledWorlds.find(w => w.id === request.worldId), publicVariables: request.publicVariables });
    if (sandboxMode) await addSandboxWorld(world, sandboxDossierId); else addPlayerWorld(world);
    setAvailableWorlds(worlds => [...worlds, world]);
    setExpandedWorldId(world.id); showNotice(`已加入卡片世界：${world.name}`);
    setCardImportOpen(false);
  };

  return <><WorldLibrary
    preview={preview}
    items={items}
    sandboxMode={sandboxMode}
    sandboxDossierId={sandboxDossierId}
    notice={notice}
    loadError={loadError}
    expandedWorldId={expandedWorldId}
    expandedContinuityId={expandedContinuityId}
    onContinue={handleContinue}
    onNewContinuity={handleNewContinuity}
    onCreateWorld={() => {
      setPhase("world_create");
    }}
    onImportWorldFiles={handleImportWorldFiles}
    onImportCard={() => setCardImportOpen(true)}
    onOpenGallery={(world) => { setGalleryWorld(world); setPhase("gallery"); }}
    onOpenSettings={() => setPhase("settings")}
    onBack={() => { exitSandboxDossier(); setPhase("title"); }}
    onToggleWorld={handleToggleWorld}
    onToggleContinuity={(continuityId) => setExpandedContinuityId(continuityId)}
    management={{
      onRenameWorld: handleRenameWorld,
      onDeleteWorld: handleDeleteWorld,
      onDeleteContinuity: handleDeleteContinuity,
      onDeleteSave: handleDeleteSave,
      onCreateInitialSave: handleCreateInitialSave,
      onExportWorld: handleExportWorld,
      onExportWorldArchive: handleExportWorldArchive,
    }}
  />{cardImportOpen && <CardImportDialog worlds={assembledWorlds} onMount={handleMountCard} onClose={() => setCardImportOpen(false)} />}</>;
}

async function readImportFiles(files: File[]): Promise<ImportSourceFile[]> {
  // 1. 检查是否为 .eidos.zip 或 .zip 文件（单文件导入）
  const zipFile = files.find((file) => {
    const name = file.name.toLowerCase();
    return name.endsWith(".eidos.zip") || (name.endsWith(".zip") && !name.endsWith(".eidos.zip"));
  });

  if (zipFile && files.length === 1) {
    try {
      return await parseZipImport(zipFile);
    } catch (error) {
      console.warn("[WorldSelectScreen] ZIP parse failed, falling back to JSON import:", error);
      // ZIP 解析失败时继续尝试 JSON 导入
    }
  }

  // 2. 旧格式：多个 JSON 文件
  const jsonFiles = files.filter((file) => file.name.toLowerCase().endsWith(".json"));
  const sources = await Promise.all(
    jsonFiles.map(async (file) => ({
      path: file.webkitRelativePath || file.name,
      content: await readFileText(file),
    })),
  );

  return sources;
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read import file."));
    reader.readAsText(file);
  });
}
