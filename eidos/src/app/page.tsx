"use client";

import { stageChapterReview, persistChapterAdvice } from '@/lib/game/chapters/review';
import { ReadingScreen } from "@/components/game/ReadingScreen";
import { MapScreen } from "@/components/game/MapScreen";
import { NpcDossierScreen } from "@/components/game/NpcDossierScreen";

import { useEffect, useRef, type ComponentType } from "react";
import { useEscapeBack } from '@/components/ui/use-escape-back';
import type { GamePhase } from "@/lib/game/types";
import { useGameStore } from "@/store/game-store";
import { subscribeTokenUsage, subscribeKeiCorrection } from "@/lib/ai/client";
import { _lastOriginalCounts, submitKeiCausalRecheck, buildKeiValidationContext, cancelKeiQueue } from "@/lib/ai/kei-review";
import { setCurrentDirectorFrame } from "@/lib/ai/action-handler";
import { isCurrentKeiReview, isKeiReviewOnCurrentBranch } from "@/lib/game/stream-lifecycle";
import { buildMetaRealityPromptContext } from '@/lib/meta-reality/artifacts';
import { persistKeiReviewSnapshot } from "@/lib/game/kei-snapshot-persistence";
import { stageKeiAdvice, noteKeiReviewApplied, clearKeiAdvice } from "@/lib/game/kei-advice";
import { speculativeEngine } from "@/lib/ai/speculation";
import { appendKeiReviewAudit } from "@/lib/ai/kei-review-audit";
import type { KeiReviewResult } from "@/lib/ai/types";
import { TitleScreen } from "@/components/game/TitleScreen";
import { WorldLibraryFlow } from "@/components/game/WorldLibraryFlow";
import { IdentitySelect } from "@/components/game/IdentitySelect";
import { GameScreen } from "@/components/game/GameScreen";
import { WorldLineBrowser } from "@/components/game/WorldLineBrowser";
import { ReplayLoadScreen } from "@/components/game/ReplayLoadScreen";
import { InventoryScreen } from "@/components/game/InventoryScreen";

import { SettingsScreen } from "@/components/game/SettingsScreen";

import { DocumentsScreen } from "@/components/game/DocumentsScreen";
import { AudioScreen } from '@/components/game/MomoiPanel';
import { GalleryScreen } from "@/components/game/GalleryScreen";
import { loadSettings, applyFontSize, EIDOS_SETTINGS_CHANGE_EVENT } from "@/lib/game/settings";
import { initStorage } from "@/lib/game/storage-migration";

const toolScreens: Partial<Record<GamePhase, ComponentType>> = {
  world_line_view: WorldLineBrowser, reading: ReadingScreen, map: MapScreen,
  npc_dossiers: NpcDossierScreen, inventory: InventoryScreen, settings: SettingsScreen,
  encyclopedia: ReadingScreen, intel_wall: ReadingScreen, diary: ReadingScreen,
  gallery: GalleryScreen, audio: AudioScreen, documents: DocumentsScreen, creative_settings: SettingsScreen,
};

export default function Home() {
  const phase = useGameStore((s) => s.phase);
  const navigationStack = useGameStore((s) => s.navigationStack);
  const addTokenUsage = useGameStore((s) => s.addTokenUsage);
  const store = useGameStore;
  const root = useRef<HTMLElement>(null);
  useEscapeBack(root, () => {
    const s = store.getState();
    if (s.phase === 'world_create') s.setPhase('world_select');
    else s.goBack();
  }, phase !== 'title' && phase !== 'playing' && phase !== 'world_select');

  // 一次性初始化存储：清理旧数据 + 迁移
  useEffect(() => { initStorage(); }, []);

  useEffect(() => {
    const sync = () => {
      const settings = loadSettings();
      // An already selected prediction is the player's active action; let it finish.
      if (!settings.enableSpeculation && !speculativeEngine.hasSelectedWait) speculativeEngine.cancel();
      if (!settings.enableContentReview) { cancelKeiQueue(); clearKeiAdvice(store); }
    };
    sync();
    window.addEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, [store]);

  // 注册回调（Set 订阅模式，支持多消费者，组件卸载时自动取消订阅）
  useEffect(() => {
    const unsubToken = subscribeTokenUsage((usage) => addTokenUsage(usage), () => store.getState().currentWorld?.id ?? null);
    const unsubKei = subscribeKeiCorrection(async (result: KeiReviewResult) => {
      if (!loadSettings().enableContentReview) return;
      const s = store.getState();
      const background = result._reviewMode === 'background';
      const chapterStaged = stageChapterReview(store, result);
      if (background && !stageKeiAdvice(store, result)) { if (chapterStaged) await persistChapterAdvice(store, result); return; }
      if (!background && result._reviewOrigin && !isCurrentKeiReview(result._reviewOrigin, s)) return;
      const beforeSnapshot = s.createSnapshot();
      const { lastDirectorFrame: _beforeFrame, directorAdviceOrigin: _beforeOrigin, directorCueCandidate: _beforeCue, ...beforeFacts } = beforeSnapshot;
      const cu = result.correctedUpdates;
      if (cu && !background) {
        if (cu.encyclopediaUpdates) cu.encyclopediaUpdates.forEach((u: any) => s.upsertEncyclopediaEntry({ type: u.type, name: u.name, description: u.description, knowledge: u.knowledge }));
        if (cu.criticalFactsDiscovered) cu.criticalFactsDiscovered.forEach((f: string) => s.addCriticalFact(f));
        if (cu.encyclopediaDeletions) cu.encyclopediaDeletions.forEach((name: string) => { const e = s.encyclopedia.find((x: any) => x.name === name); if (e) s.deleteEncyclopediaEntry(e.id); });
      }

      // KEI 质量指标：记录审核结果
      if (typeof s.recordKeiReview === "function") {
        const orig = result._reviewOriginalCounts ?? _lastOriginalCounts;
        const corr = cu || { encyclopediaUpdates: [], criticalFactsDiscovered: [], questsDiscovered: [] };
        const corrEncCount = (corr.encyclopediaUpdates || []).length;
        const corrFactsCount = (corr.criticalFactsDiscovered || []).length;
        const corrQuestsCount = 0;

        // 估算实际被修改的条目数：原始和修正中差异的部分
        // （简化：如果 KEI 没直接 approved，且 corrections 非空，则假设所有条目都被检查过）
        const hasCorrections = result.corrections && result.corrections.trim().length > 0;
        const encyclopediasChanged = hasCorrections
          ? Math.abs(orig.encyclopedias - corrEncCount) + Math.min(orig.encyclopedias, corrEncCount)
          : 0;

        s.recordKeiReview({
          originalEncyclopedias: orig.encyclopedias,
          originalCriticalFacts: orig.criticalFacts,
          originalQuests: orig.quests,
          correctedEncyclopedias: corrEncCount,
          correctedCriticalFacts: corrFactsCount,
          correctedQuests: corrQuestsCount,
          encyclopediasChanged: result.approved ? 0 : encyclopediasChanged || (hasCorrections ? orig.encyclopedias : 0),
          approved: result.approved,
          spoilerWarningCount: result.spoilerWarnings?.length ?? 0,
          literaryWarningCount: result.literaryWarnings?.length ?? 0,
        });
      }

      if (background) { if (chapterStaged) await persistChapterAdvice(store, result); return; }

      // 文学控制：保存 KEI 生成的导演帧，供下一轮 ALICE 和快照/回溯使用
      if (result.directorFrame !== undefined && typeof s.setDirectorFrame === "function") {
        s.setDirectorFrame(result.directorFrame, result._reviewOrigin);
        setCurrentDirectorFrame(result.directorFrame);
      }
      // NPC 行为更新：KEI 建议的行为快照更新
      if (result.npcBehaviorUpdates?.length) {
        result.npcBehaviorUpdates.forEach((u: any) => {
          s.setNpcBehavior(u.npcName, {
            currentScene: s.currentSceneId,
            currentActivity: u.currentActivity,
            currentMood: u.currentMood,
            interactingWith: u.interactingWith || [],
            source: "kei_update",
          });
        });
      }

      // 因果推演：KEI 预测的连锁反应 → 存入世界状态（过滤低置信度 < 0.4）
      if (result.causalProjections?.length) {
        const gameTime = s.gameTime;
        const validRipples = result.causalProjections
          .filter((r: any) => (typeof r.confidence === "number" ? r.confidence : 0.5) >= 0.4)
          .map((r: any, i: number) => ({
            id: `ripple_${Date.now()}_${i}`,
            triggerAction: r.triggerAction || "",
            projectedOutcome: r.projectedOutcome || "",
            confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
            estimatedTime: r.estimatedTime || { day: gameTime.day + 1, hour: 8, minute: 0 },
            involvedNpcs: r.involvedNpcs || [],
            involvedScenes: r.involvedScenes || [],
            status: "pending" as const,
            createdAt: Date.now(),
            resolvedAt: null,
            resolutionNote: "",
          }));
        if (validRipples.length > 0) {
          const projection: any = {
            actionDescription: `玩家行动（游戏时间 第${gameTime.day}天${gameTime.hour}时）`,
            rippleEffects: validRipples,
            generatedAt: { ...gameTime },
          };
          s.setCausalProjections([projection]);
          // 终端通知：新因果预测
          for (const r of validRipples) {
            console.log(
              `[因果预测] 新预测: "${r.projectedOutcome}" → 预计第${r.estimatedTime.day}天${r.estimatedTime.hour}时 ` +
              `(置信度 ${Math.round(r.confidence * 100)}%, NPC: ${r.involvedNpcs.join(', ') || '无'})`
            );
          }
          // Telemetry: 记录因果预测
          for (const r of validRipples) {
            s.logCausalPrediction?.({
              predictionId: r.id,
              triggerAction: r.triggerAction,
              projectedOutcome: r.projectedOutcome,
              confidence: r.confidence,
              estimatedTime: r.estimatedTime,
              involvedNpcs: r.involvedNpcs || [],
              status: "pending",
              createdAt: r.createdAt,
              resolvedAt: null,
              resolutionNote: "",
            });
          }
        }
      }

      // 预测验证：KEI 判断之前的因果预测是否实现/打破
      if (result.projectionVerifications?.length) {
        result.projectionVerifications.forEach((v: any) => {
          s.resolveRippleEffect(v.rippleId, v.status, v.note || "");
          // 终端通知：预测状态变更
          const allRipples = s.causalProjections?.flatMap((cp: any) => cp.rippleEffects) || [];
          const matched = allRipples.find((r: any) => r.id === v.rippleId);
          const label = v.status === "fulfilled" ? "✅已实现" : "❌已打破";
          console.log(
            `[因果预测] ${label}: "${matched?.projectedOutcome || v.rippleId}" → ${v.note || '无备注'}`
          );
          // Telemetry: 更新因果预测状态
          s.updateCausalStatus?.(v.rippleId, v.status, v.note || "");
        });

        // 因果 → NPC 行为传播：fulfilled 的预测更新相关 NPC 的行为快照
        const fulfilledVerifications = result.projectionVerifications.filter((v: any) => v.status === "fulfilled");
        if (fulfilledVerifications.length > 0) {
          // 找到 fulfilled 的 ripple，更新其 involvedNpcs 的行为
          const allProjections = s.causalProjections;
          for (const fv of fulfilledVerifications) {
            for (const cp of allProjections) {
              const ripple = cp.rippleEffects.find((r: any) => r.id === fv.rippleId);
              if (ripple && ripple.involvedNpcs?.length) {
                const gameTime = s.gameTime;
                for (const npcName of ripple.involvedNpcs) {
                  // 更新 NPC 行为：预测实现 → NPC 的预测行为变为当前行为
                  s.setNpcBehavior(npcName, {
                    currentScene: ripple.involvedScenes?.[0] || s.currentSceneId,
                    currentActivity: ripple.projectedOutcome,
                    currentMood: "平静",
                    interactingWith: ripple.involvedNpcs.filter((n: string) => n !== npcName),
                    source: "kei_update",
                  });
                }
              }
            }
          }
        }
      }

      // Predictions were prepared while reading, before this review. Rebuild only if their inputs changed.
      const reviewedSnapshot = store.getState().createSnapshot();
      const { lastDirectorFrame: _afterFrame, directorAdviceOrigin: _afterOrigin, directorCueCandidate: _afterCue, ...afterFacts } = reviewedSnapshot;
      const changed = chapterStaged || JSON.stringify(beforeSnapshot) !== JSON.stringify(reviewedSnapshot);
      const factsChanged = JSON.stringify(beforeFacts) !== JSON.stringify(afterFacts);
      if (factsChanged) {
        speculativeEngine.cancel();
      }
      noteKeiReviewApplied(store, result, factsChanged);
      if (factsChanged && result._reviewTrigger === 'timeline_change' && result._reviewOrigin && s.currentWorld) {
        const origin = result._reviewOrigin;
        const latest = store.getState();
        submitKeiCausalRecheck(latest.currentWorld!, reviewedSnapshot,
          buildKeiValidationContext(latest.inventory, latest.clues, latest.encyclopedia, latest.criticalFacts, latest.questLog), {
            origin, continuationSceneId: latest.currentSceneId,
            narrativeContext: { playerInput: latest.history.at(-1)?.playerInput ?? '', responseText: latest.history.at(-1)?.aiResponse ?? '', recentHistory: latest.history.slice(-5) },
            isOnBranch: () => isKeiReviewOnCurrentBranch(origin, store.getState()),
            metaRealityContext: buildMetaRealityPromptContext({ artifacts: latest.realityArtifacts, boundaryEvents: latest.boundaryEvents, manifest: latest.metaChannelManifest ?? latest.currentWorld?.metaChannelManifest ?? null }),
          });
      }
      if (result._reviewOrigin) appendKeiReviewAudit({ timestamp: Date.now(), origin: result._reviewOrigin, phase: "applied" });
      if (changed && result._reviewOrigin) await persistKeiReviewSnapshot(store, result._reviewOrigin, reviewedSnapshot);
    });
    return () => { unsubToken(); unsubKei(); };
  }, [addTokenUsage, store]);

  // 存储初始化 + 字体设置 + 加载持久化 token
  useEffect(() => {
    initStorage(); // V2 存储初始化（幂等）
    applyFontSize(loadSettings().fontSize);
    void store.getState().loadPersistedTokens();
    void store.getState().hydrateModelAnalytics();
  }, [store]);

  // 子面板：覆盖在 GameScreen 之上，不卸载 GameScreen（保持 SSE 流不中断）
  const isGaming = phase !== "title" && phase !== "world_select" && phase !== "world_create" && phase !== "identity";
  const showOverlay = isGaming && phase !== "playing";

  return (
    <main ref={root} className="flex-1 w-full overflow-hidden relative">
      {/* GameScreen 在 gaming 期间始终挂载，visibility 控制 */}
      {isGaming && (
        <div className={phase === "playing" ? "contents" : "eidos-game-underlay"} inert={showOverlay} aria-hidden={showOverlay || undefined}>
          <GameScreen />
        </div>
      )}

      {/* Keep earlier cards mounted so dragging back reveals their directory and scroll position. */}
      {[...(navigationStack ?? []), phase].filter((route, index, routes) => toolScreens[route] && routes.lastIndexOf(route) === index).map((route, index, routes) => {
        const Screen = toolScreens[route]!;
        const active = index === routes.length - 1;
        return <div key={route} className={`absolute inset-0 z-10 bg-[var(--eidos-paper)] ${active ? '' : 'eidos-tool-underlay'}`}
          inert={!active} aria-hidden={!active || undefined}><Screen /></div>;
      })}

      {/* 非 gaming 阶段：正常渲染 */}
      {phase === "title" && <TitleScreen />}
      {(phase === "world_select" || phase === "world_create") && <WorldLibraryFlow />}
      {phase === "identity" && <IdentitySelect />}
    </main>
  );
}
