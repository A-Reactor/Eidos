"use client";
import { currentDocumentScope } from "@/lib/game/model-documents";
import { useGameStore } from "@/store/game-store";
import { exportGameRecords } from "@/lib/game/export-records";
import { exportUzqAuditLog } from "@/lib/ai/uzq-audit";
import { getKeiReviewAuditSnapshot } from "@/lib/ai/kei-review-audit";
import { archiveScopeSessionValue } from "@/lib/game/archive-scope";
import { useI18n } from "@/components/shell/LocaleProvider";

export function SettingsDataActions() {
 const { t, locale } = useI18n();
 const { currentWorld, playerName, history, aiCalls, causalLog, speculationHits, speculationMisses, segmentSkips, segmentSent, serializeState, exportPersonalityAudit, sandboxSnapshots, exportSandboxToolAudit } = useGameStore();
  const handleExportRecords = async () => {
    if (!currentWorld) {
      alert(t("settings.noGame"));
      return;
    }
    if (history.length === 0 && !currentDocumentScope(useGameStore.getState())) {
      alert(t("settings.noHistory"));
      return;
    }
    try {
      await exportGameRecords(
        currentWorld,
        playerName || t("settings.unknownPlayer"),
        history,
        currentWorld.name,
        {
          documentScope: currentDocumentScope(useGameStore.getState()) ?? undefined,
          telemetry: {
            aiCalls: aiCalls || [],
            causalLog: causalLog || [],
            speculationHits: speculationHits || 0,
            speculationMisses: speculationMisses || 0,
            segmentSkips: segmentSkips || 0,
            segmentSent: segmentSent || 0,
          },
          restoreState: serializeState(),
          personalityAuditJson: exportPersonalityAudit(),
          uzqAuditJson: exportUzqAuditLog(),
          keiReviewAuditJson: JSON.stringify(getKeiReviewAuditSnapshot({ worldId: currentWorld.id,
            playthroughId: useGameStore.getState().currentPlaythroughId, archiveScope: archiveScopeSessionValue(useGameStore.getState()) })),
          sandboxSnapshotsJson: JSON.stringify(
            {
              version: "sandbox_snapshots_v1",
              exportedAt: new Date().toISOString(),
              records: sandboxSnapshots,
            },
            null,
            2,
          ),
          sandboxToolExecutionsJson: exportSandboxToolAudit(),
        }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      alert(t("settings.exportFailed", { message }));
    }
  };

 return <section className="space-y-3">
   <h3 className="font-medium">{locale === 'en' ? 'Game records' : '游戏记录'}</h3>
   {!currentWorld || !playerName ? <p className="text-xs opacity-70">{locale === 'en' ? 'Enter a world and choose an identity to export records.' : '进入世界并选择身份后可导出记录。'}</p> : <>
   <p className="text-xs opacity-70">{locale === 'en' ? 'Export progress, narrative and debug records. Connection keys are excluded.' : '导出进度、叙事与调试记录，不含连接密钥。'}</p>
   <div className="flex flex-wrap gap-3">
     <button className="eidos-dossier-action eidos-focus px-4 py-2 text-sm disabled:opacity-40" disabled={!currentWorld} onClick={handleExportRecords}>{t("settings.exportRecords")}</button>
   </div></>}
   <details className="text-xs leading-6 opacity-70"><summary className="cursor-pointer">{locale === 'en' ? 'Backup and import' : '备份与导入'}</summary><p className="mt-2">{locale === 'en' ? 'Import records from the world library to resume. To back up all playthroughs and saves, choose “Export world and playthroughs” there.' : '在世界书库导入记录可继续游玩。备份全部周目与存档，请选择“导出世界与周目”。'}</p></details>
 </section>;
}
