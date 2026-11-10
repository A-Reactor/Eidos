"use client";
import type { ActionNodeOptions } from '@/lib/game/action-entry';
import { useWorldImageLibrary } from './use-world-image-library';
import { ActionIcon } from '@/components/ui/ActionIcon';
import { validateChapterPreparation } from '@/lib/game/chapters/state';
import { chapterNarrativeEnabled } from '@/lib/game/chapters/context';
import { readingReference,readingOrigin } from '@/lib/game/reader-session';
import type { ReadingReference, ReadingView } from '@/lib/game/reader-session';
import { prepareObserverBranch,acceptObserverBranch,type ObserverBranchPlan } from '@/lib/game/observer-branch';
import { bindActionObservation,getActionObservation,observedActionState,observationContext } from '@/lib/game/action-observation';

import { PresentationDim } from './PresentationDim';
import { usePresentationArchive } from './use-presentation-archive';
import { usePresentationPlayback } from './use-presentation-playback';
import { PresentedRecordText } from './PresentedRecordText';
import { getSandboxDossierId } from '@/lib/game/archive-scope';
import { globalPluginRuntime } from '@/lib/game/global-plugins/runtime';
import { currentDocumentScope, documentScopeKey, saveModelDocument, type ResourceDocumentSelection } from '@/lib/game/model-documents';

import { recentActionsForModel } from '@/lib/ai/action-context-diagnostics';
import { rewindPolicy } from '@/lib/game/rewind';
import { applyGameRewindRequest } from '@/lib/game/game-rewind-request';
import { WorkspaceConflictDialog } from './WorkspaceConflictDialog';
import type { WorkspaceToolResult } from '@/lib/game/workspace/types';
import { loadBlob } from '@/lib/game/cas-storage';
import { mergeWorkspaceBranchAt, waitForWorkspaceBranchMerge } from '@/lib/game/workspace/branch';
import { actionDocumentReferences, selectComposerDocuments } from '@/lib/game/documents/composer';
import { inlineDocumentTokens, plainDocumentText } from '@/lib/game/documents/inline-links';
import { resolveBranchInlineDocuments } from '@/lib/game/documents/inline-links';
import { nextNarrativeCursor } from '@/lib/game/web-citations';
import { continueActionTools, assertFileOutcome } from '@/lib/game/action-tool-continuation';
import { assertNpcProfileChanges, commitNpcProfileChanges, requestsNpcProfileChange } from '@/lib/game/npc-profile';
import { requestActionContinuation } from '@/lib/game/action-continuation-stream';
import { canPreviewToolContinuation } from '@/lib/game/action-tool-prose';
import { actionInputIdentity } from '@/lib/game/documents/action-draft';
import { createActionWorkspace, workspaceInputRevision } from '@/lib/game/workspace/action-session';
import { getWorkspaceSession, registerWorkspaceSession } from '@/lib/game/workspace/session';
import { applyMetaWorkspaceEffects } from '@/lib/meta-reality/workspace-bridge';
import { prepareActionArtifacts, resolveDocumentItems, validateActionArtifactCandidate, ActionArtifactValidationError, type PreparedActionArtifacts } from '@/lib/game/documents/action-artifacts';
import { parseActionDocuments } from '@/lib/ai/document-response';
import { hasActionTool } from '@/lib/ai/workspace-tools';
import type { ActionActivityPhase } from '@/lib/game/action-activity';
import { workspacePromptContext } from '@/lib/game/workspace/context';
import { workspaceImageInputs } from '@/lib/game/workspace/image-inputs';
import { saveReadingView } from '@/lib/game/reading-view-state';
import { restoreNodePlayback } from '@/lib/game/playback-resume';


import { recordActionDiagnostics, recordActionRound, getActionDiagnostics } from '@/lib/game/action-diagnostics';
import { prepareRpgAction, type PreparedRpgAction } from '@/lib/game/action-runtime';
import { rpgActionStorePatch } from '@/lib/game/action-runtime/store-patch';
import { buildCardActionContext, preflightCardVariableContext } from '@/lib/game/cards/context';
import { snapshotForModel, worldForModel } from '@/lib/game/plugins/model-manifest';
import { narrativeInput, protectNarrativeResponse, type NarrativeRequest } from '@/lib/game/narrative';
import { nativeGameplayActions } from '@/lib/game/plugins/native-actions';
import { nativeReadingActions, nativeReadingPlugin } from '@/lib/game/plugins/native-reading';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { commitGameplayRule } from '@/lib/game/plugins/gameplay-commit';
import { useNativeReadingContinuation } from './use-native-reading-continuation';

import { evaluateGameplayEvents } from "@/lib/game/plugins/runtime";
import { getPlayerVisibleText, getPresentedText } from "@/lib/game/player-reading";
import { MapJourneyController } from "@/lib/game/map-journey-controller";
import { validateTravelPath } from "@/lib/game/map-journey";
import { buildPlayerMap } from "@/lib/game/player-map";
import { useSavedNavigation } from "./use-saved-navigation";
import { canAutoPlay, autoPlayLimitReached } from "@/lib/ui/auto-play";

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { useI18n } from "@/components/shell/LocaleProvider";
import { useGameStore, type GameStore } from "@/store/game-store";
import { RegionMap } from "./RegionMap";
import { GameplayHud } from './GameplayHud';
import { GameplayPluginDetails } from './GameplayPluginDetails';
import { GameplayModStages } from './GameplayModStages';
import { CardModPanels } from './CardModPanels';
import { prepareCardVariableTransition } from '@/lib/game/cards/adapter';
import { cardBindingActive } from '@/lib/game/cards/selection';
import { INITIAL_WORLD_OBSERVATION } from '@/lib/game/world-entry';
import { NpcInfoBar } from "./NpcInfoBar";
import { AliceContextMeter } from './AliceContextMeter';
import { RollingNumber } from "./RollingNumber";
import { ActionRecordPanel, type RecordLanding } from "./ActionRecordPanel";
import { usePanelWidth, PanelResizeHandle } from "@/components/ui/PanelResizeHandle";
import { ExcerptSelection } from "./ExcerptSelection";
import { SegmentNav } from "./SegmentNav";
import { ActionInput } from "./ActionInput";
import { MobilePlayBar } from './MobilePlayBar';
import { QuickTools } from './QuickTools';
import { MobileArchive } from './MobileArchive';
import { hasTextInputFocus, useMobileSwipe } from '@/components/ui/use-mobile-swipe';
import { useMobileLayout } from './use-mobile-layout';
import { WorldSelectScreen } from './WorldSelectScreen';
import { ToastContainer } from "./ToastContainer";
import { VisualNovelCanvas } from "./VisualNovelCanvas";
import { SegmentGlyphField } from "./SegmentGlyphField";
import { DialogueReadout } from "./DialogueReadout";
import { ConsoleBackdrop } from "./ConsoleBackdrop";
import { ArchiveStatButton } from "./ArchiveStatButton";
import { ArchiveResourceActions } from "./ArchiveResourceActions";
import { ConsoleRail } from "./ConsoleRail";
import type { SandboxToolExecutionResult } from "@/store/slices/sandbox-slice";

import { PersonalityTracePanel } from "./PersonalityTracePanel";
import { PermissionEscalationPanel } from "./PermissionEscalationPanel";
import { RegionTransition } from "./RegionTransition";
import type { AIGameResponse, StorySegment, TokenUsage } from "@/lib/ai/types";
import type { CriticalFactEntry, GameTime } from "@/lib/game/types";
import { EMPTY_TOKEN_TOTALS } from "@/store/slices/token-slice";
import { formatUsage } from "@/lib/game/usage-format";
import { loadSettings, saveSettings, EIDOS_SETTINGS_CHANGE_EVENT } from "@/lib/game/settings";
import { HOST_SHORTCUT_EVENT, isShortcutAction, isKeyboardInput, shortcutAction, type ShortcutAction } from '@/lib/game/keyboard-shortcuts';
import { imageCatalogForState } from '@/lib/game/midori/image-context';
import { rememberIllustrationDrafts } from '@/lib/game/midori/illustration-drafts';
import { speculativeEngine, speculationScope, speculationStateKey, missingSpeculationActions } from "@/lib/ai/speculation";
import {
  buildLongMemoryRetrievalContext,
  retrieveLongMemoryContext,
} from "@/lib/ai/long-memory-retrieval";
import { useMomoiPlayback } from "@/lib/game/momoi/use-momoi-playback";
import { useMomoiPrefetch } from "@/lib/game/momoi/use-momoi-prefetch";
import { useVoiceServiceMonitor } from "@/lib/game/momoi/service-status";
import {
  buildArchiveConsoleModel,
  type ArchiveConsoleTab,
} from "./archive-console-model";
import { buildNpcViewModels } from "@/lib/game/npc-view-model";
import {
  buildInterruptMetadata,
  shouldInterruptNarrative,
  isBeforeReadBoundary,
} from "./pipeline-early-stop";
import {
  setActiveStream, clearActiveStream,
  abortActiveStream,
  hasActiveStream, setPendingResult, takePendingResult, isStreamBusy, setStreamBusy,
  subscribePendingResult,
  isPipelineBusy,
  claimInitialActionAttempt,
  takePendingKeiApplication,
  storePendingKeiApplication,
  isCurrentKeiReview,
  isKeiReviewOnCurrentBranch,
  createStreamRequestScope,
  createStreamContinuationScope,
  canApplyStreamResult,
  isActiveStreamScope,
  isCurrentStreamContinuation,
  type StreamRequestScope,
} from "@/lib/game/stream-lifecycle";
import { submitKeiReview, buildKeiValidationContext, subscribeKeiIdle, hasBlockingKeiReviews, subscribeKeiActivity, hasPendingKeiReviews } from "@/lib/ai/kei-review";
import { logGameRuntimeEvent, startGameRuntimeSpan } from '@/lib/game/runtime-log';
import { activateKeiAdvice, activateKeiPromptAdvice, submitKeiStateVerificationIfNeeded } from '@/lib/game/kei-advice';
import { getPendingActionNodeSave, saveAcceptedActionNode, retryAcceptedActionNode, subscribeActionNodeSave } from '@/lib/game/action-node-commit';
import { normalizeSandboxToolRequests } from "@/lib/ai/sandbox-tool-pipeline";
import { buildMetaRealityPromptContext } from "@/lib/meta-reality/artifacts";
import { DocumentPicker } from './DocumentPicker';
import { importDocument } from '@/lib/game/documents/ingest';
import type { DocumentRef, DocumentLink } from '@/lib/game/documents/types';
import { applyActionRewriteEffects } from "@/lib/personality/ui-effects";

const GAME_UI = {
  "zh-CN": {
    active: "WORLD ACTIVE",
    archive: "世界档案",
    archiveSub: "WORLD ARCHIVE",
    closeConsole: "ESC / 关闭档案层",
    consoleTabs: {
      status: "世界状态",
      causal: "因果投影",
      worldline: "世界线",
      relations: "角色关系",
      intel: "情报档案",
      gallery: "资源与服务",
    },
    consoleHints: {
      status: "当前场景、物品与可达区域。",
      causal: "KEI 对行动后果的长期推演。",
      worldline: "历史节点、分支、回溯与重演。",
      relations: "现场人物、关系状态与行为快照。",
      intel: "线索、百科、关键事实与日记入口。",
      gallery: "管理图像、音频与当前周目的文档。",
    },
    actions: {
      openFullWorldline: "打开完整世界线",
      openIntel: "打开情报墙",
      openEncyclopedia: "打开百科",
      openDiary: "打开日记",
      openGallery: "打开资源与服务",
      openInventory: "打开背包",
      openSettings: "系统设置",
      manualSave: "写入恢复书签",
      creative: "创作模式",
    },
    labels: {
      inventory: "物品",
      clues: "线索",
      quests: "任务",
      npc: "现场人物",
      branches: "分支",
      nodes: "节点",
      pending: "待验证",
      confidence: "平均置信",
      noCausal: "暂无因果预测。下一次有世界影响的行动后，KEI 会在这里留下投影。",
      noQuests: "暂无进行中的任务",
      saveOk: "恢复书签已写入",
      saveFailed: "当前状态还不能写入书签",
    },
  },
  en: {
    active: "WORLD ACTIVE",
    archive: "World Archive",
    archiveSub: "WORLD ARCHIVE",
    closeConsole: "ESC / CLOSE ARCHIVE",
    consoleTabs: {
      status: "World State",
      causal: "Causal Projection",
      worldline: "Worldline",
      relations: "Relations",
      intel: "Intel Archive",
      gallery: "Resources & Services",
    },
    consoleHints: {
      status: "Current scene, inventory, and reachable regions.",
      causal: "KEI's long-range projections for action consequences.",
      worldline: "History nodes, branches, rollback, and replay.",
      relations: "Present characters, relationship state, and behavior snapshots.",
      intel: "Clues, encyclopedia entries, critical facts, and diary access.",
      gallery: "Manage images, audio, and documents for this playthrough.",
    },
    actions: {
      openFullWorldline: "Open full worldline",
      openIntel: "Open intel wall",
      openEncyclopedia: "Open encyclopedia",
      openDiary: "Open diary",
      openGallery: "Open resources & services",
      openInventory: "Open inventory",
      openSettings: "System settings",
      manualSave: "Write recovery bookmark",
      creative: "Creative mode",
    },
    labels: {
      inventory: "Inventory",
      clues: "Clues",
      quests: "Quests",
      npc: "Present NPCs",
      branches: "Branches",
      nodes: "Nodes",
      pending: "Pending",
      confidence: "Avg confidence",
      noCausal: "No causal projection yet. KEI will leave projections here after a world-shaping action.",
      noQuests: "No active quests",
      saveOk: "Recovery bookmark written",
      saveFailed: "Current state cannot be bookmarked yet",
    },
  },
} as const;

function criticalFactText(fact: CriticalFactEntry | string): string {
  return typeof fact === "string" ? fact : fact.text;
}

function buildSandboxActionRequestContext() {
  const state = useGameStore.getState();
  return {
    _sandboxMode: Boolean(state.sandboxMode),
    _sandboxToolAudit: (state.sandboxToolAudit ?? []).slice(-8).map((entry) => ({
      id: entry.id,
      npcId: entry.npcId,
      toolId: entry.toolId,
      result: entry.result,
      afterSummary: entry.afterSummary,
      createdAt: entry.createdAt,
    })),
  };
}

function buildMetaRealityRuntimeContext(state = useGameStore.getState()) {
  return buildMetaRealityPromptContext({
    artifacts: state.realityArtifacts,
    boundaryEvents: state.boundaryEvents,
    manifest: state.metaChannelManifest ?? state.currentWorld?.metaChannelManifest ?? null,
  });
}

function buildMetaRealityActionRequestContext() {
  return {
    _metaRealityContext: buildMetaRealityRuntimeContext(),
  };
}

// Keep the original request through a component remount and the first tool handoff.
const capturedActionRequests = new WeakMap<StreamRequestScope, string>();

function buildLongMemoryActionRequestContext(playerInput: string, scope?:StreamRequestScope) {
  const state = observedActionState(useGameStore.getState(),scope);
  const context = buildLongMemoryRetrievalContext(
    retrieveLongMemoryContext({
      playerInput,
      inventory: state.inventory,
      clues: state.clues,
      encyclopedia: state.encyclopedia,
      criticalFacts: state.criticalFacts,
      diary: state.diary,
      allNodes: state.allNodes,
      currentNodeId: state.currentNode?.id ?? null,
      rememberedNodeIds: state.rewindMemory?.sourceNodeIds,
    }),
  );
  const combined=context+observationContext(scope);
  return combined ? { _longMemoryContext: combined } : {};
}

export function GameScreen() {
  const { locale } = useI18n();
  const ui = GAME_UI[locale];
  const store = useGameStore();
  const imageLibraryError = useWorldImageLibrary();
  const {
    currentScene,
    sceneNarrative,
    isLoading,
    setIsLoading,
    addToHistory,
    createSnapshot,
    setSceneNarrative,
    setAvailableActions,
    availableActions,
    history,
    currentSceneId,
    playerName,
    currentWorld,
    gameTime,
    weather,
    protagonistState,
    notebookEvents,
    inventory,
    clues,
    autoSave,
    saveGame,
    encyclopedia,
    worldTokenUsage,
    criticalFacts,
    questLog,
    markEncyclopediaUpdated,
    savedSegments,
    savedSegmentIndex,
    savedIsShowingSegments,
    saveSegmentState,
    setPhase,
    restoreSnapshot,
    pendingInput,
    setPendingInput,
    justLoadedSave,
    clearLoadedSaveFlag,
    setGalleryWorld,
    // 世界线
    worldLine,
    currentNode,
    addActionNode,
    tryMatchChildNode,
    replayState,
    startReplayMode,
    replayStep,
    exitReplayMode,
    causalProjections,
    sceneImageUrl,
    // MOMOI 语音
    momoiSettings,
    // NPC 信息（仅展示，不做视角切换）
    npcBehaviors,
    npcStates,
    relationships,
    permissionUiEffects,
    addRealityArtifact,
    addBoundaryEvent,
  } = store;

  // 区域过渡状态
  const [regionTransition, setRegionTransition] = useState<{
    regionName: string;
    regionDescription: string;
  } | null>(null);
  const lastRegionRef = useRef(currentScene?.region ?? "");

  // 撤销用：保存每次行动前的快照 + 输入文字
  const preActionSnapshot = useRef(createSnapshot());
  const preActionInput = useRef("");

  // 分段显示状态
  const mapJourneyRef = useRef<MapJourneyController | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>(savedSegments);
  const [segmentIndex, setSegmentIndex] = useState(savedSegmentIndex);
  const [isShowingSegments, setIsShowingSegments] = useState(savedIsShowingSegments);
  // 用 ref 追踪最新 segments，避免 processActionResponse 闭包读到旧值
  const [readingNodeId, setReadingNodeId] = useState<string | null>(store.currentNode?.id ?? null);
  const historyView = store.readingView && store.readingSegments && store.allNodes[store.readingView.nodeId]
    ? { ...store.readingView, segments:store.readingSegments,node:store.allNodes[store.readingView.nodeId] } : null;
  const historyViewing=Boolean(store.readingView);
  useEffect(()=>{
    if(store.readingView && store.currentNode && store.worldLine && !store.allNodes[store.readingView.nodeId]) {store.closeReadingView();return;}
    if(store.readingView && !store.readingSegments && store.allNodes[store.readingView.nodeId]) {
      void store.openReadingNode(store.readingView.nodeId,store.readingView.originId).catch(()=>store.closeReadingView());
    }
  },[store.readingView,store.readingSegments,store.allNodes,store.currentNode,store.worldLine,store.openReadingNode,store.closeReadingView]);
  const readingActionRef = useRef<string | null>(getPendingActionNodeSave(useGameStore)?.action.id ?? null);
  const [nodeSaveTick, refreshNodeSave] = useState(0);
  const latestSegmentsRef = useRef<StorySegment[]>(savedSegments);
  const toolPreviewRollback = useRef<(() => void) | null>(null);
  const toolPreviewVisible = useRef(false);
  const [voiceStream, setVoiceStream] = useState<{ segments: StorySegment[]; lastIsDraft: boolean } | null>(null);

  const [rejectedAttempt, setRejectedAttempt] = useState<string | null>(null);
  const attemptOrigin = useRef<{ nodeId: string | null; segments: StorySegment[]; lastTimeSpent: GameTime | null; index: number; showing: boolean; draft: boolean;
    readingView: ReadingView | null; readingSegments: StorySegment[] | null; focused: boolean; scrollTop: number; historyLength: number; readingActionId: string | null; accepted?: boolean } | null>(null);
  const pendingRecordSource = useRef<{ nodeId: string | null; originId: string | null; scope: StreamRequestScope;
    branch?: ObserverBranchPlan; reference?: ReadingReference } | null>(null);
  const [sandboxApplying, setSandboxApplying] = useState(false);
  const [inputValue, setInputValue] = useState(pendingInput);
  const [workspaceConflict, setWorkspaceConflict] = useState<{ nodeId: string; segmentIndex: number } | null>(null);
  const [workspaceAttempt, setWorkspaceAttempt] = useState<WorkspaceToolResult[]>([]);
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false);
  const [inlinePreviewOpen, setInlinePreviewOpen] = useState(false);
  useEffect(() => {
    const opened = new Set<string>();
    const update = (event: Event) => { const { id, open } = (event as CustomEvent<{ id: string; open: boolean }>).detail; if (open) opened.add(id); else opened.delete(id); setInlinePreviewOpen(Boolean(opened.size)); };
    window.addEventListener('eidos-document-preview-state', update);
    return () => window.removeEventListener('eidos-document-preview-state', update);
  }, []);
  const workspacePlaybackBlocked = Boolean(workspaceConflict && workspaceConflict.nodeId === store.currentNode?.id) || Boolean(store.currentNode?.workspaceBranch?.mergeFailure);
  const documentOverlayOpen = documentPickerOpen || documentPreviewOpen || inlinePreviewOpen || workspacePlaybackBlocked;
  const activeDocumentScope = useMemo(() => currentDocumentScope({ currentWorld, currentPlaythroughId: store.currentPlaythroughId,
    sandboxMode: store.sandboxMode, sandboxDossierId: store.sandboxDossierId }), [currentWorld, store.currentPlaythroughId, store.sandboxMode, store.sandboxDossierId]);
  const activeDocumentKey = activeDocumentScope ? documentScopeKey(activeDocumentScope) : '';
  const draftDocuments = store.documentDraft && documentScopeKey(store.documentDraft.scope) === activeDocumentKey ? store.documentDraft.links : [];
  const previousDraftDocuments = useRef<DocumentLink[]>([]);
  useEffect(() => {
    const next = store.documentDraft && documentScopeKey(store.documentDraft.scope) === activeDocumentKey ? store.documentDraft.links : [];
    const previous = previousDraftDocuments.current;
    previousDraftDocuments.current = next;
    if (!next.length && !previous.length) return;
    const cursor = inputRef.current?.selectionStart ?? Number.MAX_SAFE_INTEGER;
    setInputValue(source => {
      const selected = selectComposerDocuments(source, previous, next, cursor);
      if (selected.text !== source) requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(selected.cursor, selected.cursor); });
      return selected.text;
    });
  }, [store.documentDraft, activeDocumentKey]);

  useEffect(() => {
    setDocumentPickerOpen(false); setWorkspaceConflict(null);
    if (useGameStore.getState().documentDraft && documentScopeKey(useGameStore.getState().documentDraft!.scope) !== activeDocumentKey) {
      useGameStore.setState({ documentDraft: null });
    }
  }, [activeDocumentKey]);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [lastTimeSpent, setLastTimeSpent] = useState<GameTime | null>(null);
  const effectiveAvailableActions = useMemo(
    () => {
      const reading = nativeReadingPlugin(parseGameplayPlugins(currentWorld?.gameplayPlugins), store.worldFlags, store.currentSceneId)
        ? nativeReadingActions(segments) : [];
      const choices = segments.at(-1)?.choices?.length ? reading.map(action => action.label) : [];
      const actions = [...choices, ...nativeGameplayActions({ currentWorld, currentSceneId: store.currentSceneId, worldFlags: store.worldFlags, gameplayResources: store.gameplayResources, gameplayModState: store.gameplayModState }).map(action => action.displayLabel), ...availableActions, ...(!choices.length ? reading.map(action => action.label) : [])];
      return applyActionRewriteEffects([...new Set(actions)], permissionUiEffects ?? []);
    },
    [availableActions, permissionUiEffects, currentWorld, store.worldFlags, store.gameplayResources, store.gameplayModState, store.currentSceneId, segments],
  );
  const nativeActionLock = useRef(false);
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null);
  const [generationPhase, setGenerationPhase] = useState<ActionActivityPhase>('waiting');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Ref 追踪最新值，打破 handleSubmit 对频繁变化状态的闭包依赖
  const sceneNarrativeRef = useRef(sceneNarrative);
  sceneNarrativeRef.current = sceneNarrative;

  // 离线检测与输入队列
  const [isOnline, setIsOnline] = useState(true);
  const [artifactRetry, setArtifactRetry] = useState<{ data: AIGameResponse; input: string; introspection: boolean; scope: StreamRequestScope } | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<Array<{ input: string; narrativeRequest?: NarrativeRequest; documentRefs: DocumentRef[]; branch?:ObserverBranchPlan; reference?:ReadingReference; scope:StreamRequestScope }>>([]);

  const [toasts, setToasts] = useState<Array<{ id: number; text: string; color?: string }>>([]);
  const [showConsole, setShowConsole] = useState(false);
  useEffect(() => {
    if (store.phase === 'playing' && draftDocuments.length) setShowConsole(false);
  }, [store.phase, store.documentDraft, draftDocuments.length]);
  const [consolePreview, setConsolePreview] = useState(false);
  const [collectionPreview, setCollectionPreview] = useState(false);
  const consolePreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (consolePreviewTimer.current) clearTimeout(consolePreviewTimer.current); }, []);
  const [consoleTab, setConsoleTab] = useState<ArchiveConsoleTab>("status");
  const showMomoiPanel = store.phase === 'audio';
  const [tokenDetailRequested, setShowTokenDetail] = useState(false);
  const editingAtPointerDown = useRef(false);
  const [recordCollapsed, setRecordCollapsed] = useState(() => {
    try { return localStorage.getItem("eidos_record_collapsed") === "true"; } catch { return false; }
  });
  const [excerptActive, setExcerptActive] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const recordWidth = usePanelWidth("record", 480);
  const [recordPage, setRecordPage] = useState(0);
  const recordPageSequence = useRef(0);
  const recordSubmission = useRef(0);
  const advanceRecordPage = useCallback(() => {
    const page = ++recordPageSequence.current;
    setRecordPage(page);
    return page;
  }, []);
  const pendingRecordPage = useRef(false);
  const [recordLanding, setRecordLanding] = useState<RecordLanding | null>(null);
  const startRecordPage = useCallback(() => {
    if (!pendingRecordPage.current) return;
    pendingRecordPage.current = false;
    advanceRecordPage();
  }, [advanceRecordPage]);
  const [recordDirection, setRecordDirection] = useState<"up" | "down">("down");
  const [recordFocused, setRecordFocused] = useState(false);
  const [recordNavigating, setRecordNavigating] = useState(false);
  const recordNavigationLock = useRef(false);
  const [desktopFocusMode, setFocusMode] = useState(false);
  const { mobile, frame: mobileFrame } = useMobileLayout(!desktopFocusMode);
  const showTokenDetail = tokenDetailRequested && !mobile;
  const focusMode = desktopFocusMode && !mobile;
  const recordHidden = recordCollapsed && !mobile;
  useEffect(() => {
    if (!mobile || !showConsole || store.phase !== 'playing') return;
    const previous = document.activeElement as HTMLElement | null;
    mobileFrame.current?.querySelector<HTMLButtonElement>('.eidos-console-mobile-close')?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, [mobile, showConsole, mobileFrame, store.phase]);
  const [storyDisplayMode, setStoryDisplayMode] = useState<"visual" | "classic">(() => {
    try {
      return localStorage.getItem("eidos_story_display_mode") === "classic" ? "classic" : "visual";
    } catch {
      return "visual";
    }
  });
  const [autoCompleted, setAutoCompleted] = useState(0);
  const autoSubmitting = useRef(false);
  const [recordSelection, setRecordSelection] = useState<{ pageKey: number; focused: boolean } | null>(null);
  const presentationMount=useRef(crypto.randomUUID());
  const presentationKey=`${currentWorld?.id}:${store.currentPlaythroughId}:${presentationMount.current}:${recordPage}`;
  const segmentFocusKey = JSON.stringify([historyView?.nodeId ?? readingNodeId, recordPage, historyView?.segmentIndex ?? segmentIndex]);
  // Switching records previews their text; only selecting a paragraph starts playback.
  const segmentFocused = recordSelection?.pageKey === recordPage ? recordSelection.focused : !historyViewing;
  const [revealedCount, setRevealedCount] = useState(savedIsShowingSegments ? savedSegmentIndex + 1 : savedSegments.length);
  const readingViews = useRef(new Map<string, { index: number; showing: boolean; reviewing: boolean; revealed: number; text: string; typing: boolean; played: [number, string][] }>());
  const resumedTyping = useRef<{ index: number; text: string; fullText: string } | null>(null);
  const readingKey = useCallback((id: string) => `${useGameStore.getState().currentWorld?.id}:${useGameStore.getState().currentPlaythroughId}:${id}`, []);
  const [liveReviewing, setReviewing] = useState(!savedIsShowingSegments);
  const reviewing=liveReviewing || historyViewing;
  const [quickToolsOpen, setQuickToolsOpen] = useState(false);
  const [displaySettings, setDisplaySettings] = useState(() => loadSettings());
  const [autoSelectOn, setAutoSelectOn] = useState(() => loadSettings().autoSelect);
  const [speculationEnabled, setSpeculationEnabled] = useState(() => loadSettings().enableSpeculation);
  const [autoAdvanceOn, setAutoAdvanceOn] = useState(() => loadSettings().autoAdvance);
  const [streamMode, setStreamMode] = useState(() => {
    try { return JSON.parse(localStorage.getItem("eidos_stream_mode") ?? "true"); } catch { return true; }
  });
  const [generationBias, setGenerationBias] = useState(50); // 0=细节展示, 100=任务推进
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const isMountedRef = useRef(true);
  /** 自动模式下已完成步数（用于 autoStopSteps 限制） */
  const autoStepCountRef = useRef(0);
  /** 自动模式下目标步数缓存（避免每次 useEffect 读取 localStorage） */
  const autoStopTargetRef = useRef(0);
  /** KEI 审核完成计数（触发自动推进重新检查） */
  const [keiDoneTick, setKeiDoneTick] = useState(0);
  const keiReviewing = useSyncExternalStore(subscribeKeiActivity, hasPendingKeiReviews, () => false);
  const narrativeAttempt = useRef<{ input: string; request?: NarrativeRequest; scope: string } | null>(null);
  const queuedKeiActionRef = useRef<{ input: string; fromMap: boolean; inputSource?: import("@/lib/game/chapters/types").ChapterInputSource; narrativeRequest?: NarrativeRequest; documentRefs: DocumentRef[]; branch?:ObserverBranchPlan; reference?:ReadingReference; scope: StreamRequestScope; actionId: string | null } | null>(null);

  // KEI 完成时通知自动推进系统（无论是否有修正）
  useEffect(() => {
    return subscribeKeiIdle(() => {
      setKeiDoneTick((t) => t + 1);
    });
  }, []);

  useEffect(() => subscribeActionNodeSave(useGameStore, () => {
    refreshNodeSave(t => t + 1);
    const node = useGameStore.getState().currentNode;
    if (node && node.actionId === readingActionRef.current) setReadingNodeId(node.id);
  }), []);

  const persistSettingsPatch = (patch: Partial<ReturnType<typeof loadSettings>>) => {
    saveSettings({ ...loadSettings(), ...patch });
  };

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((text: string, color?: string) => {
    if (!isMountedRef.current) return;
    const id = ++toastIdRef.current;
    setToasts((t) => [...t, { id, text, color }]);
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(timer);
      if (isMountedRef.current) setToasts((t) => t.filter((x) => x.id !== id));
    }, 2500);
    toastTimersRef.current.add(timer);
  }, []);

  useEffect(() => { if (imageLibraryError) showToast(imageLibraryError, 'red'); }, [imageLibraryError, showToast]);

  const generateDiaryEntry = async (day: number, dayHistory: any[]) => {
    // 管线忙碌时推迟日记生成（下次跨天时再写）
    if (isLoading) return;
    try {
      const s = useGameStore.getState();
      const summaries = dayHistory.map((h: any) => h.summary).join("；");
      const res = await fetch("/api/game/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerInput: `为第${day}天写日记。根据以下事件摘要，用5-8条简短要点（每条15-25字）记录今天发生的事。重要的在前，琐事在后。最后附一句总结（不超过30字）。格式：{"entries":["要点1","要点2",...],"summary":"总结"}\n\n事件：${summaries}`,
          snapshot: snapshotForModel(s.createSnapshot()), recentHistory: dayHistory.slice(-20).map((h: any) => ({ playerInput: h.playerInput, summary: h.summary })),
          inventory: s.inventory, clues: s.clues, encyclopedia: s.encyclopedia, criticalFacts: s.criticalFacts, questLog: s.questLog, introspection: true, _settings: loadSettings() as any, _creativeConfig: null, ...buildMetaRealityActionRequestContext(),
        }),
      });
      const data = await res.json();
        delete data._workspaceSessionId;
      if (data.narrative) {
        try {
          const parsed = JSON.parse(data.narrative);
          if (parsed.entries) s.upsertDiaryEntry(day, parsed.entries, parsed.summary || "");
        } catch {
          s.upsertDiaryEntry(day, [data.narrative], "");
        }
      }
    } catch {}
  };

  const currentDetail = store.sceneDetailLevels[currentSceneId] ?? 10;

  const currentSegment =
    isShowingSegments && segmentIndex < segments.length
      ? segments[segmentIndex]
      : null;
  const viewIndex=historyView?.segmentIndex ?? segmentIndex;
  const viewSegments=historyView?.segments ?? segments;
  const viewSegment=historyView ? viewSegments[viewIndex] ?? null : currentSegment;
  const viewNodeId=historyView?.nodeId ?? readingNodeId;
  const pendingSourceNode = store.allNodes[pendingRecordSource.current?.nodeId ?? ''];
  const viewDepth=store.allNodes[viewNodeId ?? '']?.stepNumber ?? store.currentNode?.stepNumber ?? 0;
  const viewOrigin=historyView ? readingOrigin(store) : undefined;
  const viewPlaybackKey=historyView ? undefined : presentationKey;
  const canAdvanceReading=historyView ? segmentFocused : isShowingSegments;
  const allSegmentsShown = !isShowingSegments || segmentIndex >= segments.length;
  const [modReadingActive, setModReadingActive] = useState(false);
  const [modPresentation, setModPresentation] = useState<'scene-map' | null>(null);
  const sceneMapActive = modReadingActive && modPresentation === 'scene-map';
  const modOwnsReading = modReadingActive && !sceneMapActive;
  const { requestAutoSave, setAutoSaveReadingBusy } = store;
  const backgroundSavePhase = store.phase;
  const backgroundSaveNode = store.currentNode?.id;
  useEffect(() => {
    setAutoSaveReadingBusy(backgroundSavePhase === 'playing' && !allSegmentsShown || isLoading);
    if (allSegmentsShown && !isLoading && backgroundSavePhase === 'playing') requestAutoSave();
    return () => setAutoSaveReadingBusy(false);
  }, [allSegmentsShown, isLoading, backgroundSavePhase, backgroundSaveNode, requestAutoSave, setAutoSaveReadingBusy]);


  // MOMOI 语音播放
  // Browsing documents is a companion panel, like quick tools; only unresolved file effects block speech.
  const voicePaused = workspacePlaybackBlocked || showMomoiPanel || store.phase === 'map' || Boolean(generationError) || (!isLoading && segments === voiceStream?.segments);
  const { isPlaying: isVoicePlaying, isGenerating: isVoiceGenerating, replay: replayVoice } =
    useMomoiPlayback(viewSegment, { occurrence: `${viewNodeId ?? history.length}:${viewIndex}`, streaming: isLoading, paused: voicePaused, nodeId:viewNodeId ?? undefined, segmentIndex:viewIndex,playbackKey:viewPlaybackKey,originId:viewOrigin,autoPlay:!historyViewing });
  useVoiceServiceMonitor(momoiSettings.enabled);

  // 同步 store → 本地 segments state（回溯 / tryMatchChildNode 等操作会直接设置 store 的 savedSegments）
  const lastSyncedSegmentsRef = useRef<StorySegment[]>(savedSegments);
  useEffect(() => {
    if (mapJourneyRef.current) return;
    if (savedSegments === lastSyncedSegmentsRef.current) return;
    lastSyncedSegmentsRef.current = savedSegments;
    setRejectedAttempt(null);
    setReadingNodeId(useGameStore.getState().currentNode?.id ?? null);
    startRecordPage();
    setSegments(savedSegments);
    const live = useGameStore.getState();
    const nativeCommit = readingActionRef.current?.startsWith('gameplay:') && live.history.at(-1)?.id === readingActionRef.current;
    // Accepted local prose can arrive before its CAS node; never restore the parent's reading cursor.
    restoreReadingView(savedSegments, nativeCommit ? undefined : live.currentNode?.id, savedSegmentIndex, savedIsShowingSegments);
    latestSegmentsRef.current = savedSegments;
  }, [savedSegments, savedSegmentIndex, savedIsShowingSegments]);

  useEffect(() => {
    const node = useGameStore.getState().currentNode;
    if (segments.length || isLoading || !node?.segmentHash || savedSegments.length || hasActiveStream()) return;
    let cancelled = false;
    void restoreNodePlayback(node, useGameStore.getState().playbackPosition).then(restored => {
      const live = useGameStore.getState();
      if (!cancelled && live.currentNode?.id === node.id && live.currentNode.segmentHash === node.segmentHash && !live.isLoading && !live.savedSegments.length) useGameStore.setState(restored);
    });
    return () => { cancelled = true; };
  }, [currentNode?.id, savedSegments.length, segments.length, isLoading]);

  const { ensureSceneBehaviors } = store;
  useEffect(() => {
    if (currentSceneId) {
      ensureSceneBehaviors(currentSceneId);
    }
  }, [currentSceneId, ensureSceneBehaviors]);

  // 自动聚焦
  // 自动翻页
  const [autoSpeed, setAutoSpeed] = useState(() => loadSettings().autoAdvanceDelay || 2000);
  const [keyboardShortcuts, setKeyboardShortcuts] = useState(() => loadSettings().keyboardShortcuts);

  useEffect(() => {
    const sync = () => { const settings = loadSettings(); setDisplaySettings(settings); setAutoAdvanceOn(settings.autoAdvance); setAutoSelectOn(settings.autoSelect); setAutoSpeed(settings.autoAdvanceDelay || 2000); setSpeculationEnabled(settings.enableSpeculation); setKeyboardShortcuts(settings.keyboardShortcuts); };
    sync();
    window.addEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EIDOS_SETTINGS_CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);

  // 逐字打字效果——支持草稿段渐进增长
  const [displayedText, setDisplayedText] = useState("");
  const viewText=historyView ? viewSegment?.text ?? '' : displayedText;
  const [isTyping, setIsTyping] = useState(false);
  const typewriterRef = useRef<number | null>(null);
  // 追踪已播放过打字效果的 segment 索引 → 上次完整文本（用于检测草稿增长）
  const playedSegmentsRef = useRef<Map<number, string>>(new Map());
  // 最后一个 segment 是否还在服务端生成中
  const lastIsDraftRef = useRef(false);
  // Only the current request's closed lines may warm while the reply is pending.
  useMomoiPrefetch({ segments: isLoading && segments !== voiceStream?.segments ? [] : segments,
    index: segmentIndex, streaming: isLoading, lastIsDraft: segments === voiceStream?.segments && voiceStream.lastIsDraft,
    active: !historyViewing && store.phase === 'playing' && !rejectedAttempt && !voicePaused });

  const restoreReadingView = useCallback((next: StorySegment[], nodeId?: string, initialIndex = 0, initialShowing = false) => {
    const view = nodeId ? readingViews.current.get(readingKey(nodeId)) : undefined;
    const index = Math.min(view?.index ?? initialIndex, Math.max(0, next.length - 1));
    setSegmentIndex(index);
    setIsShowingSegments(view?.showing ?? initialShowing);
    setReviewing(view?.reviewing ?? !initialShowing);
    setRevealedCount(view?.revealed ?? (initialShowing ? index + 1 : next.length));
    playedSegmentsRef.current = new Map(view?.played ?? []);
    resumedTyping.current = view?.typing && next[index]?.text.startsWith(view.text) ? { index, text: view.text, fullText: next[index].text } : null;
    setDisplayedText(view?.text ?? '');
    setIsTyping(view?.typing ?? false);
  }, [readingKey, setSegmentIndex, setIsShowingSegments, setReviewing, setRevealedCount, setDisplayedText, setIsTyping]);
  const restoreAttemptOrigin = useCallback(() => {
    const origin = attemptOrigin.current;
    if (!origin || origin.accepted) return;
    const live = useGameStore.getState();
    // An accepted action owns its new progress; cancellation only returns uncommitted views.
    if ((live.currentNode?.id ?? null) !== origin.nodeId || live.history.length !== origin.historyLength) return;
    pendingRecordPage.current = false;
    setRejectedAttempt(null);
    setVoiceStream(null); lastIsDraftRef.current = origin.draft;
    readingActionRef.current = origin.readingActionId;
    // A failure restores the unaccepted reply, not a historical cursor the player moved meanwhile.
    if (!live.readingView) useGameStore.setState({ readingView: origin.readingView, readingSegments: origin.readingSegments });
    setSegments(origin.segments); latestSegmentsRef.current = origin.segments;
    restoreReadingView(origin.segments, origin.nodeId ?? undefined, origin.index, origin.showing);
    setReadingNodeId(origin.nodeId); setLastTimeSpent(origin.lastTimeSpent);
    if (!live.readingView) {
      const pageKey = advanceRecordPage();
      setRecordSelection({ pageKey, focused: origin.focused });
      setRecordLanding({ pageKey, scrollTop: origin.scrollTop });
      setRecordDirection('up');
    }
  }, [advanceRecordPage, restoreReadingView, setRejectedAttempt, setVoiceStream, setSegments, setReadingNodeId, setLastTimeSpent, setRecordSelection, setRecordLanding, setRecordDirection]);
  const beginPendingRecord = useCallback((input: string, source?: { branch?: ObserverBranchPlan; reference?: ReadingReference }) => {
    const submission = ++recordSubmission.current;
    const live = useGameStore.getState();
    // The viewed source can be an ancestor while real progress stays on its old child until acceptance.
    pendingRecordSource.current = { ...source, scope: createStreamRequestScope(live),
      nodeId: source?.branch?.interference.targetNodeId ?? source?.reference?.nodeId ?? live.currentNode?.id ?? null,
      originId: source?.branch?.interference.originNodeId ?? source?.reference?.originId ?? live.currentNode?.id ?? null };
    live.closeReadingView();
    setReadingNodeId(null); readingActionRef.current = null;
    setRejectedAttempt(null); setVoiceStream(null); lastIsDraftRef.current = false;
    resumedTyping.current = null; playedSegmentsRef.current.clear();
    setSegments([]); latestSegmentsRef.current = [];
    setSegmentIndex(0); setIsShowingSegments(true); setRevealedCount(0); setReviewing(false);
    preActionInput.current = input;
    setRecordDirection('down'); pendingRecordPage.current = true; startRecordPage();
    setIsLoading(true); setLoadingStartTime(Date.now()); setInputValue(''); setActiveCommand(null);
    return submission;
  }, [setIsLoading, startRecordPage, setReadingNodeId, setRejectedAttempt, setVoiceStream, setSegments, setSegmentIndex, setIsShowingSegments, setRevealedCount, setReviewing, setRecordDirection, setLoadingStartTime, setInputValue, setActiveCommand]);
  const failPendingRecord = useCallback((message: string, input: string) => {
    restoreAttemptOrigin();
    setGenerationError(message); setStreamBusy(false); setIsLoading(false);
    setInputValue(draft => draft.trim() ? draft : input);
  }, [restoreAttemptOrigin, setIsLoading, setGenerationError, setInputValue]);

  const showRejectedAttempt = (data: any, input: string) => {
    // This is a response to an unexecuted attempt, not another state on the world line.
    takePendingKeiApplication();
    const text = data.validity.fantasyResponse || data.validity.reason || '这个行动无法执行，换个方式试试。';
    const feedback: StorySegment[] = [{ type: 'narration', text }];
    setRejectedAttempt(input); setReadingNodeId(null); readingActionRef.current = null;
    setSegments(feedback); latestSegmentsRef.current = feedback; playedSegmentsRef.current.clear();
    resumedTyping.current = null; setRevealedCount(1); setReviewing(true);
    setSegmentIndex(0); setIsShowingSegments(true); setLastTimeSpent(null); setCanUndo(false);
    startRecordPage(); setStreamBusy(false); setIsLoading(false); setInputValue(input);
  };

  // 已展示范围单独前进，回点旧段落只改变播放焦点。
  useEffect(() => {
    setRevealedCount(count => Math.max(count, isShowingSegments ? segmentIndex + 1 : segments.length));
  }, [segmentIndex, isShowingSegments, segments]);

  // 当前显示的 segment 是否还在流式生成中
  const segmentIsStreaming =
    lastIsDraftRef.current && segmentIndex === segments.length - 1 && segments.length > 0;

  useEffect(() => {
    if (typewriterRef.current) clearInterval(typewriterRef.current);

    if(historyViewing) {
      if(currentSegment && isTyping) resumedTyping.current={index:segmentIndex,text:displayedText,fullText:currentSegment.text};
      return;
    }
    if (currentSegment) {
      const fullText = currentSegment.text;
      const lastPlayedText = playedSegmentsRef.current.get(segmentIndex);
      const resumed = resumedTyping.current;
      const resumeText = resumed?.index === segmentIndex && resumed.fullText === fullText ? resumed.text : null;
      if(resumed && resumeText===null) resumedTyping.current=null;

      // 完全相同的文本已经播过 → 跳过动画
      if (lastPlayedText === fullText && resumeText === null) {
        setDisplayedText(fullText);
        setIsTyping(false);
        return;
      }

      // 草稿增长：文本前缀相同但变长 → 从当前位置继续打字
      const isDraftGrowth = lastPlayedText != null && fullText.startsWith(lastPlayedText);
      const startIdx = resumeText?.length ?? (isDraftGrowth ? displayedText.length : 0);

      if (resumeText !== null) setDisplayedText(resumeText);
      else if (!isDraftGrowth) setDisplayedText("");
      // 始终记录已见文本（草稿用，以便下次检测增长）
      playedSegmentsRef.current.set(segmentIndex, fullText);

      const speed = 25; // 每字25ms
      let idx = startIdx;
      setIsTyping(true);
      typewriterRef.current = window.setInterval(() => {
        idx = nextNarrativeCursor(fullText, idx);
        if (idx <= fullText.length) {
          setDisplayedText(fullText.slice(0, idx));
          if(resumedTyping.current?.fullText===fullText && resumedTyping.current.index===segmentIndex) resumedTyping.current.text=fullText.slice(0,idx);
        } else {
          if (typewriterRef.current) clearInterval(typewriterRef.current);
          resumedTyping.current=null;
          setIsTyping(false);
        }
      }, speed);
      return () => { if (typewriterRef.current) clearInterval(typewriterRef.current); };
    } else {
      setDisplayedText("");
      setIsTyping(false);
    }
  }, [currentSegment?.text, segmentIndex, segmentIsStreaming, recordPage, historyViewing]);

  // 空格/回车跳过打字，直接显示完整文本
  const skipTyping = () => {
    resumedTyping.current=null;
    if (typewriterRef.current) clearInterval(typewriterRef.current);
    if (currentSegment) {
      setDisplayedText(currentSegment.text);
      playedSegmentsRef.current.set(segmentIndex, currentSegment.text);
    }
    setIsTyping(false);
  };

  useEffect(() => {
    // 自动翻页：语音播放中 → 等待；语音结束 → 读秒 → 翻页
    if (modOwnsReading || documentOverlayOpen || draftDocuments.length || quickToolsOpen || inputValue.trim() || recordFocused || recordNavigating || !autoAdvanceOn || !isShowingSegments || isTyping || showMomoiPanel || excerptActive || store.phase !== "playing") return;
    // 流式生成中但下一个 segment 还没到 → 等待 SSE 推送（不设 timer 空转）
    if (isLoading && segmentIndex + 1 >= segments.length) return;
    if (isVoiceGenerating || isVoicePlaying) return; // 等语音结束
    const timer = setTimeout(() => {
      // 手动翻页不能启动自动播放；计时器执行前也检查最新偏好。
      if (loadSettings().autoAdvance && !inputRef.current?.value.trim()) handleNextSegment();
    }, autoSpeed);
    return () => clearTimeout(timer);
  }, [documentOverlayOpen, draftDocuments.length, quickToolsOpen, inputValue, autoAdvanceOn, isShowingSegments, isLoading, segmentIndex, segments.length, autoSpeed, isTyping, isVoicePlaying, isVoiceGenerating, showMomoiPanel, excerptActive, store.phase, recordFocused, recordNavigating, modOwnsReading]);

  // 自动选择 + 步数限制检查
  const tryAutoSubmit = async () => {
    const settings = loadSettings();
    // Evidence choices and actor decisions require an explicit player choice.
    if (nativeGameplayActions(useGameStore.getState()).length || nativeReadingPlugin(parseGameplayPlugins(currentWorld?.gameplayPlugins), store.worldFlags, store.currentSceneId) && segments.at(-1)?.choices?.length) return;
    if (modOwnsReading || documentOverlayOpen || draftDocuments.length || generationError || reviewing || quickToolsOpen || autoSubmitting.current || !settings.autoAdvance || !settings.autoSelect ||
      !canAutoPlay({ draft: inputRef.current?.value ?? inputValue, panelOpen: recordFocused || recordNavigating || showConsole || showTokenDetail || layoutMenuOpen || showMomoiPanel, phase: useGameStore.getState().phase })) return;
    const target = settings.autoStopSteps;
    if (autoPlayLimitReached(autoStepCountRef.current, target)) {
      setAutoAdvanceOn(false);
      saveSettings({ ...settings, autoAdvance: false, autoSelect: false });
      showToast(`已完成 ${autoStepCountRef.current} 步，自动模式已停止`, "#fbbf24");
      return;
    }
    autoSubmitting.current = true;
    const before = useGameStore.getState();
    const historyLength = before.history.length;
    const nodeId = before.currentNode?.id;
    lastAutoAdvanceTime.current = Date.now();
    try {
      await handleSubmit(effectiveAvailableActions[0]);
      const after = useGameStore.getState();
      if (after.history.length > historyLength || after.currentNode?.id !== nodeId) {
        autoStepCountRef.current += 1;
        setAutoCompleted(autoStepCountRef.current);
      } else {
        setAutoAdvanceOn(false);
        persistSettingsPatch({ autoAdvance: false, autoSelect: false });
        showToast("行动未完成，自动游玩已暂停，请检查后再继续");
      }
    } catch {
      setAutoAdvanceOn(false);
      persistSettingsPatch({ autoAdvance: false, autoSelect: false });
      showToast("行动失败，自动游玩已暂停，请重试");
    } finally { autoSubmitting.current = false; }
  };

  // 自动选择：仅在非忙碌 + 最小间隔满足时生效
  useEffect(() => {
    if (!reviewing && !quickToolsOpen && !isLoading && allSegmentsShown && effectiveAvailableActions.length > 0 && canAutoPlay({ draft: inputValue, panelOpen: recordFocused || recordNavigating || showConsole || showTokenDetail || layoutMenuOpen || showMomoiPanel || excerptActive, phase: useGameStore.getState().phase })) {
      const settings = loadSettings();
      if (settings.autoAdvance && settings.autoSelect) {
        // 步数限制：首次进入自动模式时初始化目标
        if (autoStepCountRef.current === 0 && settings.autoStopSteps > 0) {
          autoStopTargetRef.current = settings.autoStopSteps;
        }
        const now = Date.now();
        const sinceLast = now - lastAutoAdvanceTime.current;

        // 背压：AI 管线忙碌时暂停自动推进（含 KEI 审核），等管线清空
        if (isPipelineBusy()) {
          // 管线忙 → 轮询等待（无硬超时，KEI 审核可能耗时较长）
          const checkInterval = setInterval(() => {
            if (!isPipelineBusy()) {
              clearInterval(checkInterval);
              if (!useGameStore.getState().isLoading) {
                tryAutoSubmit();
              }
            }
          }, 1000);
          return () => clearInterval(checkInterval);
        }

        // 最小间隔检查：刚完成一个请求时短暂延迟
        const delay = Math.max(AUTO_ADVANCE_MIN_INTERVAL - sinceLast, 500);
        const timer = setTimeout(() => { tryAutoSubmit(); }, delay);
        return () => clearTimeout(timer);
      } else {
        // 关闭自动模式时重置步数计数器
        autoStepCountRef.current = 0;
        autoStopTargetRef.current = 0;
      }
    }
  }, [documentOverlayOpen, draftDocuments.length, generationError, reviewing, quickToolsOpen, autoSelectOn, isLoading, allSegmentsShown, effectiveAvailableActions, keiDoneTick, autoAdvanceOn, autoCompleted, inputValue, showConsole, showTokenDetail, layoutMenuOpen, showMomoiPanel, excerptActive, recordFocused, recordNavigating]);

  useEffect(() => {
    if (!reviewing && !quickToolsOpen && !isLoading && allSegmentsShown) {
      inputRef.current?.focus();
    }
  }, [isLoading, allSegmentsShown]);

  // 保留玩家可见的等待计时；审核和预生成阶段的诊断信息写入终端。
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  useEffect(() => {
    if (!isLoading) { setLoadingElapsed(0); return; }
    setLoadingElapsed(0);
    const timer = setInterval(() => setLoadingElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [isLoading]);

  // 区域切换检测 → 展示过渡画面
  useEffect(() => {
    const newRegion = currentScene?.region;
    const prevRegion = lastRegionRef.current;
    if (newRegion && prevRegion && newRegion !== prevRegion && currentWorld) {
      // 获取区域描述
      const regionData = currentWorld.regions[newRegion];
      const desc = (regionData as any)?.description ?? "";
      setRegionTransition({ regionName: regionData?.name ?? newRegion, regionDescription: desc });
    }
    lastRegionRef.current = newRegion ?? "";
  }, [currentScene?.region, currentWorld]);

  // 离线检测
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // 恢复在线时处理离线队列
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && !isLoading) {
      const next = offlineQueue[0];
      setOfflineQueue((prev) => prev.slice(1));
      const current = createStreamContinuationScope(useGameStore.getState());
      if (next.scope.worldId!==current.worldId || next.scope.playthroughId!==current.playthroughId ||
          next.scope.worldLineId!==current.worldLineId || next.scope.archiveScope!==current.archiveScope ||
          (next.branch && !isCurrentStreamContinuation(next.scope,useGameStore.getState()))) {
        showToast('排队行动的来源已变化，请重新选择后发送。','red');
        return;
      }
      showToast("重新连接，正在发送排队的行动...");
      handleSubmit(next.input, false, next.narrativeRequest, { documentRefs: next.documentRefs,branch:next.branch,reference:next.reference });
    }
  }, [isOnline, offlineQueue.length, isLoading]);

  const handleUndo = () => {
    if (rewindPolicy(useGameStore.getState().currentWorld)) { showToast('回溯能力由游戏判断发动；已读经历可在回看中查阅。'); return; }
    // 管线忙碌时禁止撤销（防止并发状态破坏）
    if (isLoading) return;
    const snap = preActionSnapshot.current;
    restoreSnapshot(snap);
    setCanUndo(false);
    setIsShowingSegments(false);
    setSegments([]); setRevealedCount(0);
    latestSegmentsRef.current = [];
    setSegmentIndex(0);
    setRejectedAttempt(null);
    setInputValue(preActionInput.current);
    setActiveCommand(null);
    // 从快照恢复 UI 显示文本
    setSceneNarrative(snap.sceneNarrative ?? "");
    setAvailableActions(snap.availableActions ?? []);
    inputRef.current?.focus();
  };

  const savedNavigation = useSavedNavigation(autoSave, setPhase);

  const preserveReadingDraft = useCallback(() => {
    setPendingInput(inputValue);
    // Streamed prose is provisional. Tool navigation must not turn it into a saved record.
    if (isLoading) return;
    if (!rejectedAttempt) saveSegmentState(segments, segmentIndex, isShowingSegments);
    else {
      const origin = attemptOrigin.current;
      const view = origin?.nodeId ? readingViews.current.get(readingKey(origin.nodeId)) : undefined;
      if (origin && view) saveSegmentState(origin.segments, view.index, view.showing);
    }
  }, [inputValue, isLoading, segments, segmentIndex, isShowingSegments, rejectedAttempt, setPendingInput, saveSegmentState, readingKey]);

  useEffect(() => {
    const live = useGameStore.getState();
    if (isLoading || rejectedAttempt || !readingNodeId || live.currentNode?.id !== readingNodeId || !segments.length) return;
    const position = { nodeId: readingNodeId, index: segmentIndex, showing: isShowingSegments };
    if (JSON.stringify(live.playbackPosition) !== JSON.stringify(position)) useGameStore.setState({ playbackPosition: position });
  }, [isLoading, rejectedAttempt, readingNodeId, segmentIndex, isShowingSegments, segments]);

  // 子界面保留 GameScreen 和请求；只有退出世界需要等待行动完成。
  const navigateTo = useCallback(async (phase: "inventory" | "world_line_view" | "world_select" | "encyclopedia" | "settings" | "intel_wall" | "diary" | "gallery" | "audio" | "documents" | "reading" | "map" | "npc_dossiers") => {
    if (isLoading && phase === 'world_select') return;
    if (mapJourneyRef.current && !isLoading) { setPendingInput(inputValue); await mapJourneyRef.current.stop(); }
    else preserveReadingDraft();
    void savedNavigation.navigate(phase);
  }, [inputValue, isLoading, savedNavigation.navigate, setPendingInput, preserveReadingDraft]);

  const submitPendingKeiIfAny = useCallback(() => {
    const pending = takePendingKeiApplication(useGameStore.getState());
    if (!pending) return;
    submitKeiReview(
      pending.aliceResponse,
      pending.world,
      pending.snapshot,
      pending.validationContext,
      undefined,
      pending.creativeConfig ?? null,
      pending.metaRealityContext ?? "",
      {
        origin: pending.origin,
        narrativeContext: pending.narrativeContext,
        settingsOverride: loadSettings() as unknown as Record<string, string>,
        isCurrent: () => isCurrentKeiReview(pending.origin, useGameStore.getState()),
        isOnBranch: () => isKeiReviewOnCurrentBranch(pending.origin, useGameStore.getState()),
        continuationSceneId: pending.continuationSceneId,
      },
    );
  }, []);

  useEffect(() => () => { void mapJourneyRef.current?.stop(); }, []);

  useEffect(() => {
    const node = useGameStore.getState().currentNode;
    if (!node?.workspaceBranch || node.id !== readingNodeId || node.workspaceBranch.mergedThrough >= segmentIndex) return;
    void mergeWorkspaceBranchAt(useGameStore, node.id, isShowingSegments ? segmentIndex : segments.length - 1).catch(error => setGenerationError(error instanceof Error ? error.message : '文件合并失败，请重试播放'));
  }, [readingNodeId, segmentIndex, isShowingSegments, segments.length]);

  const handleNextSegment = useCallback(async () => {
    setRecordSelection({ pageKey: recordPage, focused: true });
    const reader=useGameStore.getState();
    if(reader.readingView) {
      const next=reader.readingView.segmentIndex+1;
      if(next<(reader.readingSegments?.length ?? 0)) reader.setReadingSegment(next); else reader.closeReadingView();
      return;
    }
    if ((isTyping || displayedText !== currentSegment?.text) && (!mobile || modOwnsReading)) { skipTyping(); return; }
    const journey = mapJourneyRef.current;
    if (journey && segmentIndex >= journey.index && segmentIndex + 1 < segments.length) {
      if (!isLoading) void journey.advance();
      return;
    }
    if (journey && segmentIndex + 1 >= segments.length && !isLoading) void journey.stop();
    if (segmentIndex + 1 < segments.length) {
      // 下一个 segment 已到达（流式渐进推送或全部就绪）→ 允许翻页
      const node = useGameStore.getState().currentNode;
      if (readingActionRef.current && node?.actionId !== readingActionRef.current) return;
      try { if (node?.workspaceBranch && node.id === readingNodeId && !toolPreviewVisible.current) await mergeWorkspaceBranchAt(useGameStore, node.id, segmentIndex + 1); }
      catch (error) { setGenerationError(error instanceof Error ? error.message : '文件合并失败，请重试播放'); return; }
      setSegmentIndex((i) => i + 1);
    } else if (!isLoading) {
      // 流已完成且所有 segment 都读完 → 结束放映，提交 KEI
      setIsShowingSegments(false);
      setSegmentIndex(0);
      submitPendingKeiIfAny();
    }
    // 流还在生成中但下一个 segment 还没到 → 静默等待 SSE 推送
  }, [isTyping, displayedText, currentSegment?.text, mobile, modOwnsReading, segmentIndex, segments.length, isLoading, readingNodeId, recordPage, submitPendingKeiIfAny]);

  useEffect(() => {
    if (mapJourneyRef.current) {
      const live = useGameStore.getState();
      if (live.currentNode?.sceneId === live.currentSceneId && currentSegment && live.currentNode.aiResponse === currentSegment.text) {
        const visible = getPresentedText([currentSegment], 0, true, displayedText,
          storyDisplayMode === "classic" || !recordHidden);
        live.setNodeReadText(live.currentNode.id, visible);
      }
      return;
    }
    if (historyViewing || !readingNodeId || store.phase !== "playing") return;
    const node = useGameStore.getState().allNodes[readingNodeId];
    if (!node || node.id !== useGameStore.getState().currentNode?.id) return;
    const visible = getPresentedText(segments, segmentIndex, isShowingSegments, displayedText,
      modOwnsReading ? !isTyping : storyDisplayMode === "classic" || !recordHidden);
    store.setNodeReadText(readingNodeId, visible);
  }, [readingNodeId, segments, segmentIndex, currentSegment, store.currentNode?.id, isShowingSegments, displayedText, storyDisplayMode, recordHidden, store.phase, store.setNodeReadText, modOwnsReading, isTyping, historyViewing]);

  usePresentationArchive([...new Set([readingNodeId,viewNodeId].filter((id):id is string=>Boolean(id)))]);
  usePresentationPlayback({ key:presentationKey, accepted:!isLoading && Boolean(readingNodeId && readingNodeId===store.currentNode?.id && (!readingActionRef.current || store.currentNode.actionId===readingActionRef.current)), nodeId: readingNodeId, segments, index: segmentIndex, chars: playedSegmentsRef.current.get(segmentIndex)===currentSegment?.text && currentSegment?.text.startsWith(displayedText) ? displayedText.length : 0, complete: !isTyping && !segmentIsStreaming && displayedText===currentSegment?.text && playedSegmentsRef.current.get(segmentIndex)===currentSegment?.text, showing: isShowingSegments, active: store.phase === 'playing' && !reviewing && !recordNavigating && !rejectedAttempt });

  // ========== SSE 流式处理器 ==========
  // 流控制器在共享模块 stream-lifecycle.ts 中管理，跨组件挂载存活
  const AUTO_ADVANCE_MIN_INTERVAL = 2500;
  const lastAutoAdvanceTime = useRef(0);

  // 组件挂载/卸载追踪
  useEffect(() => {
    isMountedRef.current = true;
    const toastTimers = toastTimersRef.current;
    const continuationScope = createStreamContinuationScope(useGameStore.getState());
    // 如果模块级有进行中的流（从子面板返回），恢复加载状态
    if (hasActiveStream(continuationScope)) {
      setIsLoading(true);
    }
    // 如果在离开期间流已完成，处理缓冲的结果
    const consumePending = () => {
      const pending = takePendingResult(createStreamContinuationScope(useGameStore.getState()));
      if (pending) void processActionResponse(pending.event, pending.input, pending.introspection === true, {
        scope: pending.scope, requireActive: false, usageAlreadyRecorded: pending.usageAlreadyRecorded,
      });
    };
    const unsubscribePending = subscribePendingResult(consumePending);
    consumePending();
    return () => {
      isMountedRef.current = false;
      // Late expiry callbacks must not update an unmounted reading screen.
      for (const timer of toastTimers) clearTimeout(timer);
      toastTimers.clear();
      unsubscribePending();
      // Once selected, this request owns the same lifecycle as a foreground ALICE stream.
      const phase = useGameStore.getState().phase;
      if (!speculativeEngine.hasSelectedWait || ['title', 'world_select', 'world_create'].includes(phase)) speculativeEngine.cancel();
    };
  }, []);

  // 首次进入新世界/加载初始存档 → 自动触发 ALICE 初次调用
  const autoSubmitRef = useRef<(text: string, fromMap?: boolean, narrativeRequest?: NarrativeRequest, options?: { inputSource?: import("@/lib/game/chapters/types").ChapterInputSource; documentRefs?: DocumentRef[]; branch?:ObserverBranchPlan; reference?:ReadingReference }) => void>(() => {});
  useEffect(() => {
    // Missing suggestions do not mean a restored narrative needs another paid opening.
    if (generationError || isLoading || segments.length > 0 || useGameStore.getState().currentNode?.aiResponse?.trim()) return;
    if (isPipelineBusy()) return;
    if (history.length <= 1 && availableActions.length === 0) {
      const timer = setTimeout(() => {
        if (claimInitialActionAttempt(useGameStore.getState())) autoSubmitRef.current(INITIAL_WORLD_OBSERVATION, false, undefined, { inputSource: 'automatic' });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [generationError, history.length, isLoading, availableActions.length, segments.length]);

  // One summary implementation keeps ability targets and engine receipts consistent across callers.
  const buildWorldLineSummary = () => useGameStore.getState().getWorldLineSummary();

  const handleSubmitStreaming = async (
    input: string,
    startTime: number,
    requestScope: StreamRequestScope,
    narrativeRequest?: NarrativeRequest,
    documentRefs: DocumentRef[] = [],
  ) => {
    const actionState=observedActionState(useGameStore.getState(),requestScope);
    const localSnapshot = actionState.createSnapshot();
    const snapshot = snapshotForModel(localSnapshot);
    const recentHistory = recentActionsForModel(actionState.history, true, actionState.historyEpochPlan);

    // 注册新流（自动取消旧流）
    const abortController = new AbortController();
    setActiveStream(abortController, requestScope);
    setStreamBusy(true);

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const log = startGameRuntimeSpan({ engine: 'ALICE', mode: 'action', worldId: requestScope.worldId ?? undefined,
      playthroughId: requestScope.playthroughId,
      scope: speculationScope(requestScope.worldId ?? undefined, requestScope.playthroughId, requestScope.nodeId ?? undefined) });
    let firstTextLogged = false;

    try {
      const workspace = await createActionWorkspace(actionState, documentRefs, requestScope,
        () => canApplyStreamResult(requestScope, useGameStore.getState()), undefined, () => observedActionState(useGameStore.getState(),requestScope));
      const imageInputs = await workspaceImageInputs(workspace, abortController.signal);
      if (abortController.signal.aborted || !canApplyStreamResult(requestScope, useGameStore.getState())) return;
      const requestBody = JSON.stringify({
          playerInput: input, narrativeRequest, imageInputs,
          workspaceContext: workspace ? workspacePromptContext(workspace) : undefined,
          cardContext: await buildCardActionContext({ world: actionState.currentWorld, snapshot: localSnapshot, playerInput: input, recentHistory }),
          snapshot,
          recentHistory,
          world: actionState.currentWorld ? worldForModel(actionState.currentWorld) : null,
          imageCatalog: imageCatalogForState(actionState),
          inventory:actionState.inventory,
          clues: actionState.clues.filter((c) => c.sceneId === actionState.currentSceneId),
          encyclopedia:actionState.encyclopedia,
          criticalFacts:actionState.criticalFacts,
          questLog:actionState.questLog,
          weather:actionState.weather,
          protagonistState:actionState.protagonistState,
          _settings: loadSettings(),
          _creativeConfig: null,
          ...buildMetaRealityActionRequestContext(),
          ...buildLongMemoryActionRequestContext(input,requestScope),
          _bias: generationBias,
          _worldLineSummary: actionState.getWorldLineSummary(),
          ...buildSandboxActionRequestContext(),
          // 读档后首次行动需要完整上下文（AI 缓存可能未命中）
          forceFull: justLoadedSave ? true : undefined,
        });
      capturedActionRequests.set(requestScope, requestBody);
      const res = await fetch("/api/game/action/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: abortController.signal,
      });

      if (!res.ok) {
        // Only a missing streaming endpoint warrants a transport fallback, never a paid failure.
        if (![404, 405, 501].includes(res.status)) {
          const failed = await res.json().catch(() => ({ error: `流式请求失败（HTTP ${res.status}）` }));
          log('failed', 'request_rejected');
          await processActionResponse({ ...failed, error: failed.error || `请求失败（${res.status}）` }, input, false, { scope: requestScope });
          return;
        }
        log('fallback', 'stream_unavailable');
        // SSE 端点不可用时回退到普通模式
        console.warn("[Stream] SSE 端点不可用，回退到普通模式");
        setStreamMode(false);
        // 重新用普通模式提交（带上 AbortSignal 防止卸载后 setState）
        const fallbackRes = await fetch("/api/game/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: abortController.signal,
        });
        const fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok && !fallbackData.error) fallbackData.error = `请求失败（HTTP ${fallbackRes.status}）`;
        if (!fallbackData.error) log('first_text');
        log(fallbackData.error ? 'failed' : 'succeeded', fallbackData.error ? 'provider_error' : undefined);
        await processActionResponse(fallbackData, input, false, {
          scope: requestScope,
          requireActive: true,
        });
        return;
      }

      reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let segmentsReceived = false;
      let receivedSegments: StorySegment[] = [];
      let charsReceived = 0;
      let doneEventReceived = false;

      while (true) {
        abortController.signal.throwIfAborted();
        const { done, value } = await reader.read();
        abortController.signal.throwIfAborted();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 保留未完成的行

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            // Usage belongs to the paid request; visible updates belong only to its current game scope.
            if (event.type !== 'usage' && !canApplyStreamResult(requestScope, useGameStore.getState())) continue;
            switch (event.type) {
              case 'activity':
                if (isMountedRef.current && ['waiting', 'thinking', 'generating', 'files', 'search', 'operation'].includes(event.phase)) setGenerationPhase(event.phase);
                break;
              case "usage":
                useGameStore.getState().addTokenUsage(event.usage, requestScope.worldId);
                break;
              case "progress":
                charsReceived = event.charsReceived || charsReceived;
                break;
              case "segments":
                if (!firstTextLogged && event.segments?.some((s: StorySegment) => s.text?.length)) {
                  firstTextLogged = true;
                  log('first_text');
                }
                receivedSegments = event.segments;
                // 组件已卸载 → 静默跳过 UI 更新，store 更新仍会生效
                if (!isMountedRef.current) break;
                // 第一次收到 segments 时初始化显示状态，后续渐进更新只更新数组
                if (!segmentsReceived) {
                  segmentsReceived = true;
                  setSegmentIndex(0);
                  setIsShowingSegments(true);
                }
                startRecordPage();
                setSegments(event.segments);
                setVoiceStream({ segments: event.segments, lastIsDraft: event.lastIsDraft === true });
                latestSegmentsRef.current = event.segments;
                lastIsDraftRef.current = event.lastIsDraft === true;
                break;
              case "done":
                if (!firstTextLogged && event.segments?.some((s: StorySegment) => s.text?.length)) log('first_text');
                log('succeeded');
                doneEventReceived = true;
                // 组件已卸载 → 缓冲结果，下次挂载时处理
                if (!isMountedRef.current) {
                  setPendingResult({ event: { ...event, segments: event.segments ?? receivedSegments }, input, scope: requestScope });
                  setStreamBusy(false);
                  clearActiveStream(abortController);
                  return;
                }
                // 如果 segments 还没收到，从 done 事件中获取
                if (!event.document && event.workspaceRequest === undefined && event.historyRequest === undefined && !segmentsReceived && event.segments) {
                  startRecordPage();
                setSegments(event.segments);
                  setSegmentIndex(0);
                  setIsShowingSegments(true);
                  latestSegmentsRef.current = event.segments;
                }
                // 流结束，清除草稿标记
                lastIsDraftRef.current = false;
                // Branch acceptance restores historical playback. Keep this request's
                // prose attached to its result before that restore can replace UI refs.
                await processActionResponse({ ...event, segments: event.segments ?? receivedSegments }, input, false, {
                  scope: requestScope,
                  requireActive: true,
                  preserveStreamCursor: segmentsReceived,
                });
                return;
              case "error":
                recordActionDiagnostics(requestScope, { input, status: 'failed', reason: event.message, context: event._contextDiagnostics });
                log('failed', 'provider_error');
                if (!isMountedRef.current) {
                  setPendingResult({ event: { error: event.message || '流式响应错误' }, input, scope: requestScope });
                  setStreamBusy(false);
                  clearActiveStream(abortController);
                  return;
                }
                throw new Error(event.message || "流式响应错误");
            }
          } catch (parseErr) {
            // 跳过解析失败的行
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      // 如果走到这里，说明 SSE 流在未收到 "done" 事件的情况下结束了
      if (!doneEventReceived) {
        log('failed', 'stream_incomplete');
        console.error("[Stream] SSE 流意外结束，未收到 done 事件，buffer:", buffer);
        if (isMountedRef.current && canApplyStreamResult(requestScope, useGameStore.getState())) {
          failPendingRecord("连接中断，未收到完整结果，本次行动未执行。请重试。", input);
        }
      }
    } catch (err: any) {
      log(err?.name === 'AbortError' ? 'discarded' : 'failed', err?.name === 'AbortError' ? 'cancelled' : 'provider_error');
      // AbortError 是正常的（组件卸载或新请求覆盖），不需要报错
      if (err?.name === "AbortError") return;

      console.error("Stream action error:", err);
      if (isMountedRef.current && canApplyStreamResult(requestScope, useGameStore.getState())) {
        recordActionDiagnostics(requestScope, { input, status: 'failed', reason: err instanceof Error ? err.message : '请求未能完成' });
        failPendingRecord(err instanceof Error ? err.message : '生成失败，本次行动未执行。请重试。', input);
      }
    } finally {
      // 释放 reader 锁，避免资源泄漏
      if (reader) {
        try { reader.releaseLock(); } catch {}
      }
      clearActiveStream(abortController);
    }
  };

  async function executeSandboxToolRequestsFromResponse(rawRequests: unknown): Promise<boolean> {
    const state = useGameStore.getState();
    if (!state.sandboxMode) return false;
    const normalized = normalizeSandboxToolRequests(rawRequests);
    if (normalized.accepted.length === 0 && normalized.rejected.length === 0) return false;

    const results: SandboxToolExecutionResult[] = [];
    for (const request of normalized.accepted) {
      results.push(await state.executeSandboxTool(request));
    }

    const lines = [
      ...normalized.rejected.map((request) =>
        `${request.toolId ?? "未知工具"} 被拒绝：${request.reason}${request.detail ? ` (${request.detail})` : ""}`,
      ),
      ...results.map((result) =>
        `${result.auditEntry.npcId} 请求 ${result.auditEntry.toolId}：`
        + `${result.success ? "已执行" : "未执行"}。${result.message}`,
      ),
    ];
    if (lines.length === 0) return false;

    const auditSegment: StorySegment = {
      type: "narration",
      text: `【沙箱审计】${lines.join("；")}`,
    };
    setSegments((prev) => {
      const next = [...prev, auditSegment];
      latestSegmentsRef.current = next;
      return next;
    });
    const nextNarrative = sceneNarrativeRef.current
      ? `${sceneNarrativeRef.current}\n\n${auditSegment.text}`
      : auditSegment.text;
    sceneNarrativeRef.current = nextNarrative;
    setSceneNarrative(nextNarrative);
    showToast(`沙箱工具 ${results.filter((result) => result.success).length}/${results.length} 已执行`, "#dc503c");
    return true;
  }

  // ========== 处理器（复用，流式和普通模式共享） ==========
  const processActionResponse = async (
    data: any,
    input: string,
    isIntrospection: boolean,
    options: {
      scope?: StreamRequestScope;
      requireActive?: boolean;
      usageAlreadyRecorded?: boolean;
      preserveStreamCursor?: boolean;
      toolsValidated?: boolean;
    } = {},
  ) => {
    // 注意：此函数在 handleSubmit 内部被调用，访问闭包变量
    if (options.scope) {
      const currentState = useGameStore.getState();
      const canApply = options.requireActive === false
        ? isCurrentStreamContinuation(options.scope, currentState)
        : canApplyStreamResult(options.scope, currentState);
      if (!canApply) {
        if (data._tokenUsage && !options.usageAlreadyRecorded) useGameStore.getState().addTokenUsage(data._tokenUsage, options.scope.worldId);
        // A stale response cannot release a newer request's busy state.
        return;
      }
    }

    if (!data.error && !options.toolsValidated && (hasActionTool(data) || data._npcProfileUpdates?.length || !isIntrospection && (requestsNpcProfileChange(input) || data.documents != null && (!Array.isArray(data.documents) || data.documents.length) || data.pluginEvents?.length || data.workspaceEffects?.length || data.operationEffects?.length || data.segments?.some((segment: StorySegment) => segment.workspaceEffects?.length)))) {
      const live = useGameStore.getState(), scope = options.scope ?? createStreamRequestScope(live);
      const state=observedActionState(live,scope);
      const controller = new AbortController();
      setActiveStream(controller, scope);
      setIsLoading(true); setGenerationPhase('waiting');
      const snapshot = state.createSnapshot(), recentHistory = recentActionsForModel(state.history, true, state.historyEpochPlan);
      const attempt = narrativeAttempt.current;
      const narrativeRequest = attempt?.input === input && attempt.scope === `${scope.worldId}:${scope.playthroughId}:${scope.nodeId}` ? attempt.request : undefined;
      let firstRead = true, progressShown = options.preserveStreamCursor === true && Boolean(data.segments?.length), priorProse: StorySegment[] = [];
      const origin = attemptOrigin.current;
      const previousView = { segments: origin?.segments ?? latestSegmentsRef.current, index: origin?.index ?? segmentIndex,
        showing: origin?.showing ?? isShowingSegments, draft: origin?.draft ?? lastIsDraftRef.current };
      const billedUsages = new WeakSet<object>();
      const rollback = () => {
        if (progressShown && isMountedRef.current && isCurrentStreamContinuation(scope, useGameStore.getState())) {
          setSegments(previousView.segments); latestSegmentsRef.current = previousView.segments;
          setSegmentIndex(previousView.index); setIsShowingSegments(previousView.showing); setVoiceStream(null); lastIsDraftRef.current = previousView.draft;
          setReadingNodeId(origin?.nodeId ?? null);
        }
        progressShown = false;
        if (toolPreviewRollback.current === rollback) { toolPreviewRollback.current = null; toolPreviewVisible.current = false; }
      };
      toolPreviewRollback.current = rollback;
      toolPreviewVisible.current = progressShown;
      const publish = (next: StorySegment[], lastIsDraft: boolean) => {
        if (!next.length || !isMountedRef.current || !canApplyStreamResult(scope, useGameStore.getState())) return;
        if (!progressShown) { startRecordPage(); setSegmentIndex(0); setIsShowingSegments(true); }
        progressShown = true; toolPreviewVisible.current = true; setSegments(next); latestSegmentsRef.current = next;
        setVoiceStream({ segments: next, lastIsDraft }); lastIsDraftRef.current = lastIsDraft;
      };
      const recordReadResponse = (candidate: Partial<AIGameResponse> & { _pendingKeyTokens?: TokenUsage[] }) => {
        if (candidate._tokenUsage && !billedUsages.has(candidate._tokenUsage)) {
          if (!firstRead || !options.usageAlreadyRecorded) useGameStore.getState().addTokenUsage(candidate._tokenUsage, scope.worldId);
          billedUsages.add(candidate._tokenUsage);
        }
        candidate._pendingKeyTokens?.forEach(usage => useGameStore.getState().addTokenUsage(usage, scope.worldId));
        firstRead = false;
      };
      try {
        if (isIntrospection || data._gameplayResult || narrativeRequest?.kind === 'result') {
          recordReadResponse(data);
          throw new Error('历史原文工具用于正常行动；本次请求尚未执行');
        }
        let workspace = getWorkspaceSession(scope.requestId);
        if (!workspace && data._workspaceSessionId) {
          workspace = getWorkspaceSession(data._workspaceSessionId);
          if (!workspace || workspace.closed || workspace.parentNodeId !== scope.nodeId) throw new ActionArtifactValidationError('预生成文件分支已失效，请重新发送行动');
          workspace.isCurrent = () => canApplyStreamResult(scope, useGameStore.getState());
          registerWorkspaceSession(scope.requestId, workspace);
        }
        workspace ??= await createActionWorkspace(state, [], scope,
          () => canApplyStreamResult(scope, useGameStore.getState()), undefined, () => observedActionState(useGameStore.getState(),scope));
        // This immutable action context is shared by every hidden model round.
        const captured = capturedActionRequests.get(scope);
        capturedActionRequests.delete(scope);
        const cardContext = captured ? undefined : await buildCardActionContext({ world: state.currentWorld, snapshot, playerInput: input, recentHistory });
        const fallbackBase = { playerInput: input, narrativeRequest, snapshot: snapshotForModel(snapshot), recentHistory, cardContext,
          world: state.currentWorld ? worldForModel(state.currentWorld) : null, imageCatalog: imageCatalogForState(state),
          inventory: state.inventory, clues: state.clues.filter(c => c.sceneId === state.currentSceneId), encyclopedia: state.encyclopedia,
          criticalFacts: state.criticalFacts, questLog: state.questLog, weather: state.weather, protagonistState: state.protagonistState,
          _settings: loadSettings(), _bias: generationBias, _worldLineSummary: state.getWorldLineSummary(),
          ...buildMetaRealityActionRequestContext(), ...buildSandboxActionRequestContext(), forceFull: justLoadedSave ? true : undefined };
        const requestBase: typeof fallbackBase & {
          _longMemoryContext?: string;
          workspaceContext?: ReturnType<typeof workspacePromptContext>;
        } = captured ? JSON.parse(captured) : fallbackBase;
        const initialMemory = captured ? requestBase._longMemoryContext ?? '' : buildLongMemoryActionRequestContext(input, scope)._longMemoryContext ?? '';
        let round = 0;
        const toolOperations: import('@/lib/game/action-operations').ActionOperationReceipt[] = [];
        // SSE may deliver prose only through segments events, leaving the final envelope metadata-only.
        const toolCandidate = !hasActionTool(data) && data.segments === undefined ? { ...data, segments: latestSegmentsRef.current } : data;
        const final = await continueActionTools({ response: toolCandidate, playerInput: input, historySource: state, session: workspace, engine: state, signal: controller.signal, settings: requestBase._settings as unknown as Record<string, string>,
          context: { longMemoryContext: initialMemory,
            workspaceContext: requestBase.workspaceContext ?? (workspace ? workspacePromptContext(workspace) : { draftRoot: 'drafts/history', mounts: [], results: [], nextOffset: null }) },
          isCurrent: () => !controller.signal.aborted && canApplyStreamResult(scope, useGameStore.getState()),
          onResponse: recordReadResponse,
          onRound: value => recordActionRound(scope, input, value),
          onOperation: receipt => {
            if (receipt.usage) useGameStore.getState().addTokenUsage(receipt.usage, scope.worldId);
            toolOperations.push(receipt);
            if (canApplyStreamResult(scope, useGameStore.getState())) recordActionDiagnostics(scope, { input, status: 'received', operations: [...toolOperations] });
          },
          onActivity: phase => { if (isMountedRef.current && canApplyStreamResult(scope, useGameStore.getState())) setGenerationPhase(phase); },
          validateFinal: candidate => {
            evaluateGameplayEvents(state.currentWorld ?? {}, state.worldFlags, state.gameplayResources, candidate.pluginEvents);
            const docs = parseActionDocuments(candidate.documents);
            if (candidate.itemsGained?.some(item => item.documentKey !== undefined && !docs.some(d => d.key === item.documentKey))) throw new ActionArtifactValidationError('物品引用了本轮不存在的文档 key');
            const docScope = currentDocumentScope(state);
            if (docScope) validateActionArtifactCandidate({ scope: docScope, actionId: workspace?.actionId ?? '', session: workspace,
              inputs: workspace?.actionInputs ?? [], documents: candidate.documents, effectIds: candidate.workspaceEffects, segments: candidate.segments, availableActions: candidate.availableActions });
          },
          onNarrative: next => { priorProse = next; if (canPreviewToolContinuation(workspace)) publish(next, false); },
          invoke: async context => {
            if (controller.signal.aborted || !canApplyStreamResult(scope, useGameStore.getState())) throw new DOMException('资料查阅已取消', 'AbortError');
            const turn = ++round;
            const result = await requestActionContinuation({ streaming: streamMode, signal: controller.signal,
              body: { ...requestBase, snapshot: { ...requestBase.snapshot, historyEpochPlan: context.historyEpochPlan ?? requestBase.snapshot.historyEpochPlan }, imageInputs: await workspaceImageInputs(workspace, controller.signal), chapterPreparation: context.chapterPreparation, _longMemoryContext: context.longMemoryContext, workspaceContext: context.workspaceContext },
              onActivity: activity => { if (isMountedRef.current && canApplyStreamResult(scope, useGameStore.getState())) setGenerationPhase(activity.phase); },
              onUsage: usage => {
                useGameStore.getState().addTokenUsage(usage, scope.worldId);
                recordActionRound(scope, input, { index: turn, callType: usage.callType ?? 'alice_action', usage });
              },
              onSegments: (next, draft) => {
                // Ordinary prose streams in order; write-result paragraphs wait for branch acceptance.
                if (canPreviewToolContinuation(workspace)) publish([...priorProse, ...next], draft);
              },
              onTiming: timing => { recordActionRound(scope, input, { index: turn, callType: 'alice_action', ...timing }); logGameRuntimeEvent({ engine: 'ALICE', mode: 'action', trigger: 'tool_continuation',
                phase: timing.completed ? 'succeeded' : 'failed', timestamp: Date.now(), requestId: `${scope.requestId}:tool:${turn}`,
                worldId: scope.worldId ?? undefined, durationMs: timing.elapsedMs,
                reason: `${timing.streaming ? 'sse' : 'json'};firstSegmentMs=${timing.firstSegmentMs ?? 'none'}` }); },
            });
            if (result.usageRecorded && result.response._tokenUsage) billedUsages.add(result.response._tokenUsage);
            return result.response;
          },
        });
        // Metadata-only done seals the last draft too; this round has its own SSE reader.
        lastIsDraftRef.current = false;
        if (!isMountedRef.current) { setPendingResult({ event: final, input, scope, usageAlreadyRecorded: Boolean(final._tokenUsage && billedUsages.has(final._tokenUsage)) }); return; }
        if (final.error || final.validity?.isPossible === false) rollback();
        await processActionResponse(final, input, false, { scope, requireActive: true,
          usageAlreadyRecorded: Boolean(final._tokenUsage && billedUsages.has(final._tokenUsage)), preserveStreamCursor: progressShown, toolsValidated: true });
        if (progressShown && workspace && !useGameStore.getState().history.some(action => action.id === workspace.actionId)) rollback();
      } catch (error) {
        if (canApplyStreamResult(scope, useGameStore.getState()) || !hasActiveStream() && isCurrentStreamContinuation(scope, useGameStore.getState())) rollback();
        if (canApplyStreamResult(scope, useGameStore.getState())) {
          const failed = { error: error instanceof Error ? error.message : '历史查阅失败，本次行动未执行' };
          if (!isMountedRef.current) setPendingResult({ event: failed, input, scope });
          else await processActionResponse(failed, input, false, { scope, requireActive: true });
        }
      } finally { if (toolPreviewRollback.current === rollback) { toolPreviewRollback.current = null; toolPreviewVisible.current = false; } clearActiveStream(controller); }
      return;
    }

    if (data._gameplayResult) {
      const now = useGameStore.getState();
      const supplied = data.segments;
      try { data = protectNarrativeResponse({ ...data, segments: supplied ?? latestSegmentsRef.current }, now.gameTime, { kind: 'result', result: data._gameplayResult }, now.createSnapshot()); data.segments = supplied; }
      catch { return; }
    }
    const diagnosticScope = options.scope ?? createStreamRequestScope(useGameStore.getState());
    capturedActionRequests.delete(diagnosticScope);
    if (!data._diagnosticRounds && !getActionDiagnostics().find(r => r.id === diagnosticScope.requestId)?.rounds?.length) recordActionRound(diagnosticScope, input, { index: 0, callType: data._tokenUsage?.callType ?? 'alice_action', usage: data._tokenUsage, context: data._contextDiagnostics, elapsedMs: data._elapsedMs, completed: !data.error });
    for (const round of data._diagnosticRounds ?? []) recordActionRound(diagnosticScope, input, round);
    const diagnosticDetail = { input, context: data._contextDiagnostics, usage: data._tokenUsage,
      fileOutcome: data.fileOutcome, operationOutcome: data.operationOutcome,
      selectedFileEffects: [...new Set<string>([...(data.workspaceEffects ?? []), ...(data.segments ?? []).flatMap((segment: StorySegment) => segment.workspaceEffects ?? [])])],
      ...(data._webToolReceipts?.length ? { operations: data._webToolReceipts } : {}),
      variableUpdates: data.cardVariableUpdates, pluginEvents: data.pluginEvents };
    recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: data.error ? 'failed' : 'received', reason: data.error });
    // Author evidence does not become world history or the next review model's material.
    const { _contextDiagnostics: _authorEvidence, _diagnosticRounds: _roundEvidence, _webToolReceipts: _webEvidence, ...simulationResponse } = data;
    data = simulationResponse;
    if (data._tokenUsage) {
      // Adopting a prediction reuses a request already charged by the page's subscription.
      if (!options.usageAlreadyRecorded) useGameStore.getState().addTokenUsage(data._tokenUsage);
      useGameStore.getState().setAliceContextUsage(data._tokenUsage);
    }
    data._pendingKeyTokens?.forEach((usage: any) => useGameStore.getState().addTokenUsage(usage));
    setRejectedAttempt(null);

    if (data.error) {
      failPendingRecord(String(data.error), input);
      return;
    }

    if (data.document) {
      const scope = currentDocumentScope(useGameStore.getState());
      if (!scope) { failPendingRecord('当前周目尚未建立，文档未保存', input); return; }
      // This branch must precede every game-state update, worldline commit and tool executor.
      const candidate = { document: data.document, request: input };
      let selection: ResourceDocumentSelection = { scope, initial: candidate };
      try {
        const saved = await saveModelDocument(scope, data.document, input);
        const current = currentDocumentScope(useGameStore.getState());
        if (!current || documentScopeKey(current) !== documentScopeKey(scope)) return;
        selection = { scope, initialId: saved.id };
      } catch { /* Keep the complete document available for retry in the resource page. */ }
      const afterDocument = useGameStore.getState();
      if (options.scope && !(options.requireActive === false ? isCurrentStreamContinuation(options.scope, afterDocument) : canApplyStreamResult(options.scope, afterDocument))) return;
      pendingRecordPage.current = false;
      restoreAttemptOrigin();
      setStreamBusy(false); setIsLoading(false); setInputValue('');
      useGameStore.setState({ documentSelection: selection, pendingInput: '' });
      setShowConsole(false);
      afterDocument.setPhase('documents');
      return;
    }

    if (data.validity?.isPossible === false) {
      recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: 'rejected', reason: data.validity.reason });
      showRejectedAttempt(data, input);
      return;
    }

    const replySegments = data.segments ?? latestSegmentsRef.current;
    if (!Array.isArray(replySegments) || !replySegments.some(segment => typeof segment?.text === 'string' && segment.text.trim()) && !(typeof data.narrative === 'string' && data.narrative.trim())) {
      failPendingRecord('未收到有效回复，本次行动未执行。请重试。', input);
      return;
    }

    const acceptedState = observedActionState(useGameStore.getState(),options.scope);
    let actionNodeOptions: ActionNodeOptions | undefined;
    const suppliedSegments = data.segments;
    data = protectNarrativeResponse({ ...data, segments: suppliedSegments ?? latestSegmentsRef.current }, acceptedState.gameTime, data._gameplayResult ? { kind: 'result', result: data._gameplayResult } : undefined, acceptedState.createSnapshot());
    // SSE already delivered the final prose. Metadata must not restart its typewriter.
    data.segments = suppliedSegments ? data.segments : undefined;
    const cutaway = data.narrativeFrame?.kind === 'cutaway';
    const resultNarration = Boolean(data._gameplayResult);
    let actionId = options.scope ? getWorkspaceSession(options.scope.requestId)?.actionId ?? crypto.randomUUID() : crypto.randomUUID();
    const actionTimestamp = Date.now();
    let nextModState = acceptedState.gameplayModState;
    const chapterActive = !isIntrospection && !resultNarration && acceptedState.currentWorld && chapterNarrativeEnabled(acceptedState.currentWorld, acceptedState.createSnapshot());
    const responseScope = options.scope ?? createStreamRequestScope(acceptedState);
    const observation=getActionObservation(responseScope);
    let acceptanceController: AbortController | null = null;
    try {
      if (chapterActive && data.chapterPreparation) validateChapterPreparation(acceptedState.chapterState, data.chapterPreparation, acceptedState.currentWorld!.id);
      const toolReceipts = getWorkspaceSession(responseScope.requestId)?.receipts ?? [];
      setWorkspaceAttempt(toolReceipts.filter(receipt => receipt.status === 'denied' || receipt.status === 'failed'));
      assertFileOutcome(options.scope ? getWorkspaceSession(options.scope.requestId) : null, data);
      if ((isIntrospection || cutaway || resultNarration) && data._npcProfileUpdates?.length) throw new Error('内省、旁观或结果补写不能提交人设变更');
      assertNpcProfileChanges(acceptedState, data._npcProfileUpdates);
      evaluateGameplayEvents(acceptedState.currentWorld ?? {}, acceptedState.worldFlags, acceptedState.gameplayResources, isIntrospection ? undefined : data.pluginEvents);
      nextModState = prepareCardVariableTransition({ world: acceptedState.currentWorld ?? {}, state: acceptedState.gameplayModState,
        updates: data.cardVariableUpdates, mode: isIntrospection ? 'introspection' : cutaway ? 'cutaway' : 'action',
        activeAssetIds: acceptedState.currentWorld?.cardBindings?.filter(b => b.enabled && cardBindingActive(b, acceptedState.currentScene?.npcs ?? [], input)).map(b => b.assetId) });
      if (nextModState !== acceptedState.gameplayModState) {
        // Cached or resumed candidates need the same busy/ownership guard while local reads await.
        if (!options.scope || options.requireActive === false) {
          acceptanceController = new AbortController();
          setActiveStream(acceptanceController, responseScope);
        }
        await preflightCardVariableContext({ world: acceptedState.currentWorld, snapshot: { ...acceptedState.createSnapshot(), gameplayModState: nextModState }, playerInput: input, response: data, contextDiagnostics: diagnosticDetail.context });
        if (!isCurrentStreamContinuation(responseScope, useGameStore.getState())) {
          recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: 'discarded', reason: '校验期间分支已变化' }); return;
        }
        if (acceptanceController && !canApplyStreamResult(responseScope, useGameStore.getState())) return;
        if (!isMountedRef.current) {
          setPendingResult({ event: { ...data, _pendingKeyTokens: [] }, input, scope: responseScope, usageAlreadyRecorded: true });
          setStreamBusy(false);
          return;
        }
        if (options.scope && options.requireActive !== false && !canApplyStreamResult(options.scope, useGameStore.getState())) {
          recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: 'discarded', reason: '校验期间请求已取消或被替换' }); return;
        }
        // Re-evaluate every ledger after the local read: background changes must not be overwritten.
        const liveState = observedActionState(useGameStore.getState(),responseScope);
        evaluateGameplayEvents(liveState.currentWorld ?? {}, liveState.worldFlags, liveState.gameplayResources, isIntrospection ? undefined : data.pluginEvents);
        nextModState = prepareCardVariableTransition({ world: liveState.currentWorld ?? {}, state: liveState.gameplayModState, updates: data.cardVariableUpdates, mode: 'action',
          activeAssetIds: liveState.currentWorld?.cardBindings?.filter(b => b.enabled && cardBindingActive(b, liveState.currentScene?.npcs ?? [], input)).map(b => b.assetId) });
      }
    } catch (error) {
      if (isMountedRef.current && isCurrentStreamContinuation(responseScope, useGameStore.getState())) {
        recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: 'rejected', reason: error instanceof Error ? error.message : '玩法规则未能确认' });
        showRejectedAttempt({ validity: { isPossible: false, reason: error instanceof Error ? error.message : '玩法规则未能确认' } }, input);
      }
      return;
    } finally {
      if (acceptanceController) clearActiveStream(acceptanceController);
    }
    let artifacts: PreparedActionArtifacts | undefined;
    let prepared: PreparedRpgAction;
    const prepareAccepted = (state: GameStore) => {
      const action = prepareRpgAction({ world: state.currentWorld!, snapshot: state.createSnapshot(),
        response: data, segments: data.segments ?? latestSegmentsRef.current, input, actionId, timestamp: actionTimestamp,
        introspection: isIntrospection, inputSource: observation?.inputSource, history: state.history });
      if (artifacts?.metaEffects && !artifacts.branch) action.snapshot.gameplayModState = applyMetaWorkspaceEffects(action.snapshot.gameplayModState ?? {}, artifacts.metaEffects);
      return action;
    };
    const artifactController = !options.scope || options.requireActive === false ? new AbortController() : null;
    if (artifactController) setActiveStream(artifactController, responseScope);
    try {
      let session = getWorkspaceSession(responseScope.requestId);
      if (!session && data._workspaceSessionId) {
        session = getWorkspaceSession(data._workspaceSessionId);
        if (!session || session.closed || session.parentNodeId !== responseScope.nodeId) throw new ActionArtifactValidationError('预生成文件分支已失效，请重新发送行动');
        session.isCurrent = () => canApplyStreamResult(responseScope, useGameStore.getState());
        registerWorkspaceSession(responseScope.requestId, session);
      }
      if (!session) session = await createActionWorkspace(acceptedState, [], responseScope,
        () => canApplyStreamResult(responseScope, useGameStore.getState()), actionId, () => observedActionState(useGameStore.getState(),responseScope));
      actionId = session?.actionId ?? actionId;
      const documentScope = currentDocumentScope(acceptedState);
      let documents: ReturnType<typeof parseActionDocuments>;
      try {
        documents = parseActionDocuments(data.documents);
        for (const item of data.itemsGained ?? []) if (item.documentKey !== undefined && !documents.some(d => d.key === item.documentKey)) throw new Error('物品引用了本轮不存在的文档 key');
      } catch (error) { throw new ActionArtifactValidationError(error instanceof Error ? error.message : '文档产物格式无效'); }
      if (documentScope) artifacts = await prepareActionArtifacts({ scope: documentScope, actionId, session, inputs: session?.actionInputs ?? [], documents, effectIds: data.workspaceEffects, segments: data.segments ?? latestSegmentsRef.current });
      else if (documents.length || data.workspaceEffects?.length) throw new ActionArtifactValidationError('当前周目尚未建立，文档未保存');
      if (!canApplyStreamResult(responseScope, useGameStore.getState())) return;
      if (!isMountedRef.current) { setPendingResult({ event: { ...data, _pendingKeyTokens: [] }, input, scope: responseScope, usageAlreadyRecorded: true }); return; }
      // Local artifact I/O may yield to plugin writes; settle against the current ledgers.
      const liveState = observedActionState(useGameStore.getState(),responseScope);
      if (artifacts) data.itemsGained = resolveDocumentItems(data.itemsGained ?? [], artifacts);
      if (artifacts) {
        const source = data.segments ?? latestSegmentsRef.current;
        try {
          const resolved = source.map((segment: StorySegment, index: number) => ({ ...segment, text: resolveBranchInlineDocuments(segment.text, artifacts!, Object.values(session?.documentByPath ?? {}), index) }));
          data.availableActions = data.availableActions?.map((action: string) => resolveBranchInlineDocuments(action, artifacts!, Object.values(session?.documentByPath ?? {}), Math.max(0, source.length - 1)));
          if (data.segments || JSON.stringify(source) !== JSON.stringify(resolved)) data.segments = resolved;
        } catch (error) { throw new ActionArtifactValidationError(error instanceof Error ? error.message : '文档链接不可用'); }
      }
      // Recheck after every local await, before any branch or world mutation. The final
      // rendered text (including resolved documents) is the evidence KEI may cite later.
      prepared = prepareAccepted(liveState);
      setArtifactRetry(null);
      if(observation?.branch && !observation.accepted) {
        try {
          actionNodeOptions=acceptObserverBranch(useGameStore,observation.branch,
            ()=>canApplyStreamResult(responseScope,useGameStore.getState()));
          responseScope.sceneId=useGameStore.getState().currentSceneId;
          observation.accepted=true;
        } catch(error) {
          if(isActiveStreamScope(responseScope)) failPendingRecord(error instanceof Error ? error.message : '分支未能保存', input);
          return;
        }
      }
      if(attemptOrigin.current) attemptOrigin.current.accepted=true;
    } catch (error) {
      if (canApplyStreamResult(responseScope, useGameStore.getState())) {
        setArtifactRetry(error instanceof ActionArtifactValidationError ? null : { data: { ...data, _pendingKeyTokens: [] }, input, introspection: isIntrospection, scope: responseScope });
        failPendingRecord(error instanceof Error ? error.message : '文档保存失败，请重试本地保存', input);
      }
      return;
    } finally { if (artifactController) clearActiveStream(artifactController); }
    try {
      commitNpcProfileChanges(useGameStore, data._npcProfileUpdates);
      // Keep the approved internal profile in the accepted snapshot alongside public story knowledge.
      if (data._npcProfileUpdates?.length) prepared = prepareAccepted(useGameStore.getState());
    } catch (error) { failPendingRecord(error instanceof Error ? error.message : '行动结算失败', input); return; }
    const hasFreshSegments = Boolean(data.segments?.length || data.narrative);
    data = prepared.response;
    useGameStore.setState({ ...rpgActionStorePatch(prepared), ...(artifacts ? { workspaceState: artifacts.workspaceState } : {}) });
    recordActionDiagnostics(diagnosticScope, { ...diagnosticDetail, status: 'accepted', variableUpdates: cutaway || isIntrospection ? undefined : diagnosticDetail.variableUpdates, pluginEvents: isIntrospection ? undefined : diagnosticDetail.pluginEvents, reason: cutaway || isIntrospection ? '旁观或内省不结算原卡变量' : undefined });
    useGameStore.getState().acceptNpcSpeechProfiles({ ...data, segments: prepared.segments }, isIntrospection);
    const acceptedScope = createStreamContinuationScope(acceptedState);
    const reviewSnapshot = preActionSnapshot.current ?? acceptedState.createSnapshot();
    for (const effect of prepared.effects) {
      if (effect.type === 'scene.entered') useGameStore.getState().ensureSceneBehaviors(effect.sceneId);
      else if (effect.type === 'map.rejected') showToast('地图变化未能确认，已保留原地图。');
      else if (effect.type === 'encyclopedia.updated') markEncyclopediaUpdated();
      else if (effect.type === 'diary.requested') generateDiaryEntry(effect.day, effect.history);
    }
    const timeSpent = prepared.timeSpent;
    setLastTimeSpent(timeSpent);
    setVoiceStream(null);
    const displaySegments = prepared.segments, fullText = prepared.text;
    if (hasFreshSegments) {
      startRecordPage();
      if (!options.preserveStreamCursor) setSegmentIndex(0);
      else setSegmentIndex(index => Math.min(index, displaySegments.length - 1));
      setIsShowingSegments(true);
    }
    latestSegmentsRef.current = displaySegments;
    setSegments(displaySegments);
    const record = {
      ...prepared.record,
      inputIdentity: actionInputIdentity(input, artifacts?.inputDocuments ?? [], getWorkspaceSession(responseScope.requestId)?.inputRevision ?? workspaceInputRevision(acceptedState)),
      workspaceBranch: artifacts?.branch, inputDocuments: artifacts?.inputDocuments, outputDocuments: artifacts?.outputDocuments, workspaceEffects: artifacts?.validatedEffects,
      snapshot: preActionSnapshot.current,
    };
    addToHistory(record);
    if (artifacts?.inputDocuments.length) {
      const live = useGameStore.getState(), draft = live.documentDraft;
      if (draft && documentScopeKey(draft.scope) === documentScopeKey(artifacts.scope)) useGameStore.setState({ documentDraft: { ...draft, links: draft.links.filter(link => !artifacts!.inputDocuments.some(sent => sent.documentId === link.documentId && sent.revision === link.revision)) } });
    }
    if (!resultNarration) activateKeiAdvice(useGameStore, data.npcsReacted ?? []);

    // All accepted response paths meet here, including SSE metadata and adopted predictions.
    // Keep the pre-action knowledge for validation and the actual displayed prose for review.
    const reviewOrigin = {
      worldId: acceptedScope.worldId, playthroughId: acceptedScope.playthroughId,
      worldLineId: acceptedScope.worldLineId, archiveScope: acceptedScope.archiveScope,
      parentNodeId: acceptedScope.nodeId, expectedHeadId: actionNodeOptions?.expectedHeadId, actionId: record.id,
    };
    if (acceptedState.currentWorld && !resultNarration) {
      storePendingKeiApplication({
        origin: reviewOrigin,
        aliceResponse: { ...data, segments: displaySegments },
        world: acceptedState.currentWorld,
        snapshot: snapshotForModel({ ...reviewSnapshot, chapterState: useGameStore.getState().chapterState }),
        continuationSceneId: useGameStore.getState().currentSceneId,
        validationContext: buildKeiValidationContext(reviewSnapshot.inventory, reviewSnapshot.clues,
          reviewSnapshot.encyclopedia, reviewSnapshot.criticalFacts, reviewSnapshot.questLog),
        metaRealityContext: buildMetaRealityRuntimeContext(acceptedState),
        narrativeContext: {
          playerInput: input, responseText: fullText,
          recentHistory: acceptedState.history.slice(-5).map(h => ({
            playerInput: h.playerInput, aiResponse: h.aiResponse, summary: h.summary, sceneId: h.sceneId,
          })),
        },
      });
    }

    // 世界线：每次行动创建节点（fire-and-forget）
    if (!isIntrospection) void rememberIllustrationDrafts(useGameStore.getState(), data.illustrations, actionId).catch(error=>showToast(error instanceof Error ? error.message : '插图构想保存失败'));
    readingActionRef.current = record.id;
    const nodeSave = saveAcceptedActionNode(useGameStore, reviewOrigin, record, displaySegments, actionNodeOptions, artifacts).then((node) => {
      if (node?.outputDocuments?.length) recordActionDiagnostics(diagnosticScope, { input, status: 'accepted', publishedDocuments: node.outputDocuments.map(doc => doc.documentId) });
      if (isMountedRef.current && node && readingActionRef.current === record.id && useGameStore.getState().currentNode?.id === node.id) setReadingNodeId(node.id);
      return node;
    }).catch((error: unknown) => {
      console.warn("[GameScreen] 世界线节点创建失败", error);
      showToast("本次原文尚未保存到世界线，请先保留当前页面。", "red");
      return null;
    });
    // Reading time hides the background review latency; candidates alone never reach this boundary.
    submitPendingKeiIfAny();
    setCanUndo(!observation?.branch);
    if (justLoadedSave) clearLoadedSaveFlag();

    // 每次 AI 输出后自动检测当前场景图是否存在，不存在则触发生成 + 上报 KEI

    // Persist the triggering experience before changing branches; never run its NPC/tools in the restored past.
    let abilityRewound = false;
    if (!cutaway && !resultNarration && !isIntrospection && data.worldImpacts?.some((i: string) => i.startsWith('[BACKTRACK:'))) {
      try {
        abilityRewound = await applyGameRewindRequest(useGameStore, await nodeSave);
        if (abilityRewound) { speculativeEngine.cancel(); setCanUndo(false); setLastTimeSpent(null); showToast('已回到过去，主角保留了此前的经历。'); }
      } catch (error) { showToast(error instanceof Error ? error.message : '回溯未完成，当前进度已保留', 'red'); }
      const live = createStreamContinuationScope(useGameStore.getState());
      if (live.worldId !== acceptedScope.worldId || live.playthroughId !== acceptedScope.playthroughId || acceptedScope.worldLineId !== null && live.worldLineId !== acceptedScope.worldLineId || live.archiveScope !== acceptedScope.archiveScope) return;
    }

    // 背压解除：AI 管线空闲，允许自动推进
    setStreamBusy(false);
    setIsLoading(false);
    if (abilityRewound) return;

    // 人格推演：对 ALICE 回应中涉及的 NPC 执行人格推演（Phase 2）
    if (data.personalityObservations) {
      try {
        const store3 = useGameStore.getState();
        const wlSummary = store3.getWorldLineSummary?.();
        const summary = (store3 as any).runInference?.({
          playerInput: input,
          observations: data.personalityObservations,
          worldLineSummary: wlSummary || undefined,
          isWorldLineBacktrack: false,
        });
        if (summary && summary.length > 0) {
          const changed = summary.filter(
            (s: any) => s.memoriesAdded > 0 || s.pressureChanged || s.anomaliesDetected > 0,
          );
          if (changed.length > 0) {
            console.debug(
              "[Personality] 推演更新:",
              changed.map((s: any) => `${s.npcId}(+${s.memoriesAdded}记忆,${s.anomaliesDetected}异常,压力${s.pressureChanged ? "变" : "不变"})`).join(", "),
            );
          }
        }
      } catch (e) {
        console.warn("[Personality] 推演失败:", e);
      }
    }

    if (data.sandboxToolRequests?.length) {
      setSandboxApplying(true);
      void executeSandboxToolRequestsFromResponse(data.sandboxToolRequests)
        .finally(() => setSandboxApplying(false));
    }
  };

  // ============================================================
  // 推测性预计算
  // ============================================================
  // 在玩家阅读当前叙事时（~8s 窗口），并发请求 top-3 推荐行动的 AI 响应。
  // 当玩家选择推荐行动时，响应即时返回（0s TTFW）。

  const triggerSpeculation = () => {
    let s = useGameStore.getState();
    const settings = loadSettings();
    if (documentOverlayOpen || draftDocuments.length) return;
    if (!settings.enableSpeculation || !settings.aliceApiKey || !s.currentWorld || !s.currentNode || s.isLoading || isStreamBusy() || hasBlockingKeiReviews()) return;
    if (readingActionRef.current && readingNodeId !== s.currentNode.id) return;
    const children = s.currentNode.childIds.map(id => s.allNodes[id]).filter(Boolean);
    const predictionActions = missingSpeculationActions(s.availableActions.filter(action => !inlineDocumentTokens(action).length), children, settings.autoSelect ? 1 : 3);
    if (!predictionActions.length) return;
    activateKeiPromptAdvice(useGameStore);
    s = useGameStore.getState();
    if (!s.currentWorld || !s.currentNode) return;

    speculativeEngine.triggerSpeculation(
      predictionActions,
      {
        scope: speculationScope(s.currentWorld.id, s.currentPlaythroughId, s.currentNode.id, s),
        workspaceRevision: workspaceInputRevision(s), historySource: { allNodes: s.allNodes, currentNode: s.currentNode },
        createWorkspace: (actionId, isCurrent) => createActionWorkspace(s, [], createStreamRequestScope(s), isCurrent, actionId, () => useGameStore.getState()),
        snapshot: s.createSnapshot(),
        world: worldForModel(s.currentWorld), imageCatalog: imageCatalogForState(s),
        recentHistory: recentActionsForModel(s.history, true, s.historyEpochPlan),
        inventory: s.inventory,
        clues: s.clues,
        encyclopedia: s.encyclopedia,
        criticalFacts: s.criticalFacts,
        questLog: s.questLog,
        weather: s.weather,
        protagonistState: s.protagonistState,
        clientSettings: settings as any,
        creativeConfig: null,
        metaRealityContext: buildMetaRealityRuntimeContext(s),
        sandboxMode: Boolean(s.sandboxMode),
        sandboxToolAudit: (s.sandboxToolAudit ?? []).slice(-8).map((entry: any) => ({
          id: entry.id,
          npcId: entry.npcId,
          toolId: entry.toolId,
          result: entry.result,
          afterSummary: entry.afterSummary,
          createdAt: entry.createdAt,
        })),
      },
      (settings.autoSelect ? 1 : 3)
    );
  };

  // One entry path covers new responses, speculative hits and restored existing nodes.
  useEffect(() => {
    if (store.phase === 'playing' && !isLoading && !rejectedAttempt && !sandboxApplying) triggerSpeculation();
  }, [store.phase, currentNode?.id, currentWorld?.id, availableActions, isLoading, readingNodeId, rejectedAttempt, sandboxApplying, autoSelectOn, keiDoneTick, speculationEnabled, documentOverlayOpen, draftDocuments.length, store.documentHeads, store.workspaceState, store.midoriAssetRevision]);

  const handleSubmit = useCallback(
    async (text?: string, fromMap = false, narrativeRequest?: NarrativeRequest, options?: { inputSource?: import("@/lib/game/chapters/types").ChapterInputSource; documentRefs?: DocumentRef[]; branch?:ObserverBranchPlan; reference?:ReadingReference }) => {
      let input = (text ?? inputValue).trim();
      const source = useGameStore.getState();
      const pinnedSource = Boolean(options && 'reference' in options);
      const pendingSource = source.isLoading && !source.readingView && pendingRecordSource.current &&
        isCurrentStreamContinuation(pendingRecordSource.current.scope, source) ? pendingRecordSource.current : undefined;
      const reference = pinnedSource ? options?.reference : pendingSource?.reference ?? readingReference(source);
      let branch = options?.branch ?? (!pinnedSource ? pendingSource?.branch : undefined);
      if (!input || recordNavigationLock.current) return;
      // Capture the viewed node once for every manual entry point. Queued submissions
      // retain their original branch even if the player browses somewhere else later.
      if (!branch && !pinnedSource && source.readingView && !autoSubmitting.current && options?.inputSource !== 'automatic') {
        if (source.isLoading || isPipelineBusy()) {
          showToast('行动完成后可从历史选择继续；也可以停止当前生成。');
          return;
        }
        const scope = createStreamRequestScope(source);
        recordNavigationLock.current = true; setRecordNavigating(true);
        try {
          branch = await prepareObserverBranch(source, source.readingView.nodeId, readingOrigin(source) ?? source.readingView.originId);
          if (!isMountedRef.current || useGameStore.getState().phase !== 'playing' || !isCurrentStreamContinuation(scope, useGameStore.getState())) return;
        } catch (error) {
          showToast(error instanceof Error ? error.message : '无法从此处继续', 'red');
          return;
        } finally {
          recordNavigationLock.current = false;
          if (isMountedRef.current) setRecordNavigating(false);
        }
      }
      let documentRefs = structuredClone(options?.documentRefs ?? []);
      const documentScope = currentDocumentScope(useGameStore.getState());
      if (documentScope && inlineDocumentTokens(input).length) {
        try { documentRefs = await actionDocumentReferences(documentScope, input, documentRefs); }
        catch (cause) { setGenerationError(cause instanceof Error ? cause.message : '文档引用不可用'); return; }
      }
      setArtifactRetry(null);
      const turnState = useGameStore.getState();
      if (turnState.currentNode?.workspaceBranch?.mergeFailure) {
        setWorkspaceConflict({ nodeId: turnState.currentNode.id, segmentIndex: turnState.currentNode.workspaceBranch.mergeFailure.segmentIndex });
        return;
      }
      setWorkspaceAttempt([]);
      if (!fromMap && !narrativeRequest && nativeReadingPlugin(parseGameplayPlugins(turnState.currentWorld?.gameplayPlugins), turnState.worldFlags, turnState.currentSceneId)) {
        narrativeRequest = nativeReadingActions(segments).find(action => action.label === input)?.request;
        if (narrativeRequest) input = narrativeInput(narrativeRequest);
      }
      if (!rejectedAttempt && rewindPolicy(turnState.currentWorld) && isShowingSegments && isBeforeReadBoundary(
        segmentIndex, revealedCount - 1,
        getPresentedText(segments, segmentIndex, true, '', true),
        turnState.currentNode?.id === readingNodeId ? turnState.currentNode?.playerVisibleText : '',
      )) {
        showToast('这段之后还有已经访问的内容，请回到已读最远处再行动。', 'red');
        return;
      }
      const turnScope = `${turnState.currentWorld?.id}:${turnState.currentPlaythroughId}:${turnState.currentNode?.id}`;
      if (!narrativeRequest && narrativeAttempt.current?.input === input && narrativeAttempt.current.scope === turnScope) narrativeRequest = narrativeAttempt.current.request;
      narrativeAttempt.current = { input, request: narrativeRequest, scope: turnScope };
      claimInitialActionAttempt(turnState);
      setGenerationError(null);
      setGenerationPhase('waiting');
      if (mapJourneyRef.current) await mapJourneyRef.current.stop();

      const interruptingNarrative = !rejectedAttempt && shouldInterruptNarrative({
        isShowingSegments,
        segmentIndex,
        segmentsLength: segments.length,
      });

      const hadToolPreview = Boolean(toolPreviewRollback.current);
      if (isLoading) {
        toolPreviewRollback.current?.();
        // 流式生成中收到新输入 → 终止当前流，丢弃不完整的 KEI 申请
        abortActiveStream({ cancelKeiQueue: false });
        takePendingKeiApplication();
        // 不在这里设置 isLoading=false —— 保持加载态阻止自动翻页，
        // 新的请求（setIsLoading→true 再→false）统一管理加载态切换
        showToast("已中断当前生成，正在处理新的行动...");
      } else if (isStreamBusy()) {
        showToast("ALICE 正在处理当前行动，请稍候...");
        return;
      } else if (interruptingNarrative) {
        const metadata = buildInterruptMetadata({
          segmentIndex,
          segmentsLength: segments.length,
        });
        submitPendingKeiIfAny();
        showToast(
          `叙事早停：${metadata.interruptedAtSegment + 1}/${metadata.totalSegmentsGenerated}`,
          "#dc503c",
        );
      }

      const inputSource = options?.inputSource ?? (autoSubmitting.current ? 'automatic' : narrativeRequest ? 'continue' : text && turnState.availableActions.includes(text) ? 'choice' : 'player');
      // Manual choices need the same review boundary as autoplay, including interrupted reading.
      submitPendingKeiIfAny();
      if (narrativeRequest?.kind !== 'result') submitKeiStateVerificationIfNeeded(useGameStore);
      const boundaryState = useGameStore.getState();
      // The model may finish before its CAS node. Wait locally so the next node has the right parent.
      const savingNode = getPendingActionNodeSave(useGameStore) || (readingActionRef.current && boundaryState.history.at(-1)?.id === readingActionRef.current &&
        boundaryState.currentNode?.actionId !== readingActionRef.current);
      if (hasBlockingKeiReviews() || savingNode) {
        const s = useGameStore.getState();
        queuedKeiActionRef.current = { input, fromMap, inputSource, narrativeRequest, documentRefs, branch, reference, scope: createStreamRequestScope(s), actionId: s.history.at(-1)?.id ?? null };
        showToast(savingNode ? "正在保存上一行动，新行动已保留..." : "正在核对关键变化，新行动已保留...");
        return;
      }
      queuedKeiActionRef.current = null;
      const fileMerge = waitForWorkspaceBranchMerge(useGameStore.getState);
      if (fileMerge) { try { await fileMerge; } catch (error) { showToast(error instanceof Error ? error.message : '文件合并尚未完成', 'red'); return; } }
      if (!branch && !fromMap && !narrativeRequest && documentRefs.length === 0) {
        const local = nativeGameplayActions(useGameStore.getState()).find(action => action.displayLabel === input);
        if (local) {
          if (nativeActionLock.current || isLoading || isStreamBusy()) return;
          nativeActionLock.current = true;
          const operationId = crypto.randomUUID(), previousReadingAction = readingActionRef.current;
          readingActionRef.current = `gameplay:${local.pluginId}:${operationId}`;
          pendingRecordPage.current = true;
          try {
            await commitGameplayRule(useGameStore, local.pluginId, { id: operationId, ruleId: local.ruleId, narrate: false });
            setInputValue(''); setActiveCommand(null);
          } catch (error) {
            if (useGameStore.getState().history.at(-1)?.id !== readingActionRef.current) readingActionRef.current = previousReadingAction;
            showToast(error instanceof Error ? error.message : '行动未能确认，请重试', 'red');
          }
          finally { nativeActionLock.current = false; }
          return;
        }
      }
      // Keep the selected source before closing the reader. Transform only on send,
      // so reconnecting cannot apply a plugin's input transformation a second time.
      if (!isOnline) {
        setOfflineQueue((prev) => [...prev, { input, narrativeRequest, documentRefs, branch, reference, scope:createStreamRequestScope(useGameStore.getState()) }]);
        useGameStore.getState().closeReadingView();
        showToast("离线模式——行动已排队，恢复连接后自动发送");
        setInputValue("");
        return;
      }
      // Apply once after review/save queuing, so a deferred input is not transformed twice.
      try {
        const transformed = globalPluginRuntime.transformAction(input, fromMap);
        if (transformed === null || useGameStore.getState().phase !== 'playing') return;
        input = transformed;
      } catch (error) { showToast(error instanceof Error ? error.message : '全局插件处理行动失败', 'red'); return; }

      // 背压：立即标记管线忙碌，防止自动推进在 async 工作期间触发翻页
      setStreamBusy(true);

      if (!rejectedAttempt && !hadToolPreview && !isLoading) {
        const origin = useGameStore.getState(), nodeId = origin.currentNode?.id ?? null;
        attemptOrigin.current = { nodeId, segments, lastTimeSpent, index: segmentIndex, showing: isShowingSegments, draft: lastIsDraftRef.current,
          readingView: origin.readingView, readingSegments: origin.readingSegments, focused: segmentFocused, historyLength: origin.history.length, readingActionId: readingActionRef.current,
          scrollTop: mobileFrame.current?.querySelector<HTMLElement>('.eidos-record-page:not(.is-outgoing) .eidos-record-scroll')?.scrollTop ?? 0 };
        if (nodeId) readingViews.current.set(readingKey(nodeId), { index: segmentIndex, showing: isShowingSegments, reviewing: liveReviewing, revealed: revealedCount, text: displayedText, typing: isTyping, played: [...playedSegmentsRef.current] });
      } else if (rejectedAttempt) restoreAttemptOrigin();
      // 判断是否为思考/回忆
      const isIntrospection =
        !fromMap && (activeCommand === "思考" || /^思考[：:]/.test(input));
      // 保存行动前快照和输入（用于撤销）
      preActionSnapshot.current = branch?.snapshot ?? createSnapshot();
      const submission = beginPendingRecord(input, { branch, reference });
      const isCurrentSubmission = () => recordSubmission.current === submission;

      // ======== 世界线：检查已有子节点是否匹配当前输入 ========
      // 如果当前节点已有子节点且输入完全匹配 → 直接导航到已有节点
      // 跳过 AI 调用，零 token 消耗
      try {
        if(branch || reference) throw new Error('本次行动有独立引用来源');
        const identity = actionInputIdentity(input, documentRefs, workspaceInputRevision(useGameStore.getState()));
        const matchedNode = await tryMatchChildNode(input, identity === input.trim() ? undefined : identity, { isCurrent: isCurrentSubmission });
        if (!isCurrentSubmission()) return;
        if (matchedNode) {
          // 匹配成功 — 已通过 tryMatchChildNode 恢复快照、加载分段
          setStreamBusy(false);
          setIsLoading(false);
          setInputValue("");
          setActiveCommand(null);
          setCanUndo(false); // 回退到已有节点，不能撤销
          if (justLoadedSave) clearLoadedSaveFlag();
          return;
        }
      } catch {
        // 匹配失败不影响正常流程
      }
      if (!isCurrentSubmission()) return;

      // ======== 推测性预计算：检查缓存（流式 + 非流式通用） ========
      // 推测请求使用非流式端点，缓存的是完整 AIGameResponse。
      // 命中时直接调用 processActionResponse，跳过所有 API 调用。
      const predictionState = useGameStore.getState();
      const predictionScope = speculationScope(predictionState.currentWorld?.id, predictionState.currentPlaythroughId, predictionState.currentNode?.id, predictionState);
      const predictionEnabled = !branch && !reference && loadSettings().enableSpeculation && documentRefs.length === 0;
      const predictionKey = speculationStateKey(predictionState.currentWorld, predictionState.createSnapshot(), loadSettings() as unknown as Record<string, string>, recentActionsForModel(predictionState.history, true, predictionState.historyEpochPlan), workspaceInputRevision(predictionState), imageCatalogForState(predictionState));
      let speculativeHit = predictionEnabled ? speculativeEngine.checkCache(input, predictionScope, predictionKey) : null;
      let waitedForPrediction = false;
      let predictionWaitStartedAt: number | null = null;
      if (predictionEnabled && !speculativeHit && speculativeEngine.hasPendingAction(input, predictionScope)) {
        // Selecting a candidate adopts its original request, including its provider timeout.
        const scope = createStreamRequestScope(predictionState);
        const controller = new AbortController();
        bindActionObservation(scope, { inputSource });
        setActiveStream(controller, scope);
        predictionWaitStartedAt = Date.now();
        setIsLoading(true); setLoadingStartTime(predictionWaitStartedAt);
        speculativeHit = await speculativeEngine.waitForPending(input, predictionScope, { signal: controller.signal, stateKey: predictionKey });
        if (!loadSettings().enableSpeculation) speculativeEngine.cancel();
        if (!isCurrentSubmission() || !canApplyStreamResult(scope, useGameStore.getState())) { clearActiveStream(controller); return; }
        if (speculativeHit && !isMountedRef.current) {
          setPendingResult({ event: speculativeHit, input, scope, usageAlreadyRecorded: true });
          clearActiveStream(controller); return;
        }
        clearActiveStream(controller); setStreamBusy(true);
        waitedForPrediction = true;
      }

      if (speculativeHit) {
        // CACHE HIT — 跳过 API 调用，瞬间显示响应
        logGameRuntimeEvent({ engine: 'ALICE', mode: 'speculation', phase: 'cache_hit', timestamp: Date.now(),
          scope: predictionScope, durationMs: predictionWaitStartedAt === null ? 0 : Date.now() - predictionWaitStartedAt,
          reason: waitedForPrediction ? 'reused_pending' : 'ready_cache' });
        useGameStore.getState().recordSpeculationHit?.(predictionState.currentWorld?.id);
        playedSegmentsRef.current.clear();
        setInputValue("");
        setActiveCommand(null);

        // 标记为推测命中（用于 token 统计区分）
        if (!speculativeHit._elapsedMs) {
          speculativeHit._elapsedMs = predictionWaitStartedAt === null ? -1 : Date.now() - predictionWaitStartedAt;
        }
        const scope = createStreamRequestScope(useGameStore.getState());
        bindActionObservation(scope, { inputSource });
        await processActionResponse(speculativeHit, input, isIntrospection, { usageAlreadyRecorded: true, scope, requireActive: false });
        return;
      }

      // No usable candidate (or its provider failed): start the regular request.
      if (!branch && activateKeiPromptAdvice(useGameStore)) preActionSnapshot.current = useGameStore.getState().createSnapshot();
      if (predictionEnabled) useGameStore.getState().recordSpeculationMiss?.(predictionState.currentWorld?.id);
      speculativeEngine.cancel();
      const requestScope = createStreamRequestScope(useGameStore.getState());
      bindActionObservation(requestScope,{branch,reference,inputSource});

      // 新行动提交——重置已播放记录，让打字效果重新运行
      resumedTyping.current=null;
      playedSegmentsRef.current.clear();

      setIsLoading(true);
      const startTime = predictionWaitStartedAt ?? Date.now();
      setLoadingStartTime(startTime);
      setRejectedAttempt(null);
      setInputValue("");
      setActiveCommand(null);

      // 流式模式：非思考/整理时走 SSE 端点
      if (streamMode && !isIntrospection) {
        await handleSubmitStreaming(input, startTime, requestScope, narrativeRequest, documentRefs);
        return;
      }

      const abortController = new AbortController();
      const log = startGameRuntimeSpan({ engine: 'ALICE', mode: 'action', scope: predictionScope });
      setActiveStream(abortController, requestScope);
      const actionState=observedActionState(useGameStore.getState(),requestScope);
      const localSnapshot = actionState.createSnapshot();
      const snapshot = snapshotForModel(localSnapshot);
      const recentHistory = recentActionsForModel(actionState.history, !isIntrospection, actionState.historyEpochPlan);

      try {
        const workspace = await createActionWorkspace(actionState, documentRefs, requestScope,
          () => canApplyStreamResult(requestScope, useGameStore.getState()), undefined, () => observedActionState(useGameStore.getState(),requestScope));
        const imageInputs = await workspaceImageInputs(workspace, abortController.signal);
        if (abortController.signal.aborted || !canApplyStreamResult(requestScope, useGameStore.getState())) return;
        const requestBody = JSON.stringify({
            playerInput: input, narrativeRequest, imageInputs,
            workspaceContext: workspace ? workspacePromptContext(workspace) : undefined,
            cardContext: await buildCardActionContext({ world: actionState.currentWorld, snapshot: localSnapshot, playerInput: input, recentHistory, introspection: isIntrospection }),
            snapshot,
            recentHistory,
            world: actionState.currentWorld ? worldForModel(actionState.currentWorld) : null,
          imageCatalog: imageCatalogForState(actionState),
            inventory:actionState.inventory,
            clues: actionState.clues.filter((c) => c.sceneId === actionState.currentSceneId),
            encyclopedia:actionState.encyclopedia,
            criticalFacts:actionState.criticalFacts,
            questLog:actionState.questLog,
            introspection: isIntrospection,
            weather:actionState.weather,
            protagonistState:actionState.protagonistState,
            _settings: loadSettings(),
            _creativeConfig: null,
            ...buildMetaRealityActionRequestContext(),
            ...buildLongMemoryActionRequestContext(input,requestScope),
            _bias: generationBias,
            _worldLineSummary: actionState.getWorldLineSummary(),
            ...buildSandboxActionRequestContext(),
            forceFull: justLoadedSave ? true : undefined,
          });
        capturedActionRequests.set(requestScope, requestBody);
        const res = await fetch("/api/game/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          signal: abortController.signal,
        });

        const data = await res.json();
        if (!res.ok && !data.error) data.error = `请求失败（HTTP ${res.status}）`;
        delete data._workspaceSessionId;
        if (!data.error) log('first_text');
        log(data.error ? 'failed' : 'succeeded', data.error ? 'provider_error' : undefined);
        if (!canApplyStreamResult(requestScope, useGameStore.getState())) {
          if (data._tokenUsage) useGameStore.getState().addTokenUsage(data._tokenUsage, requestScope.worldId);
          return;
        }
        if (!isMountedRef.current) {
          setPendingResult({ event: data, input, scope: requestScope, introspection: isIntrospection });
          setStreamBusy(false);
          clearActiveStream(abortController);
          return;
        }

        if (data.error) {
          await processActionResponse(data, input, isIntrospection, { scope: requestScope, requireActive: true });
          return;
        }

        await processActionResponse(data, input, isIntrospection, {
          scope: requestScope,
          requireActive: true,
        });
      } catch (err: any) {
        log(err?.name === 'AbortError' ? 'discarded' : 'failed', err?.name === 'AbortError' ? 'cancelled' : 'provider_error');
        if (err?.name === "AbortError") return;
        const elapsed = Date.now() - startTime;
        console.error("Action error:", err);
        if (isMountedRef.current && canApplyStreamResult(requestScope, useGameStore.getState())) {
          recordActionDiagnostics(requestScope, { input, status: 'failed', reason: err instanceof Error ? err.message : '请求未能完成' });
          failPendingRecord(err instanceof Error ? err.message : `生成失败（等待了 ${(elapsed / 1000).toFixed(1)} 秒）。请重试。`, input);
        }
      } finally {
        const applies = canApplyStreamResult(requestScope, useGameStore.getState());
        clearActiveStream(abortController);
        if (isMountedRef.current && applies) setIsLoading(false);
      }
    },
    [rejectedAttempt, revealedCount, readingNodeId, reviewing, liveReviewing, displayedText, isTyping, lastTimeSpent, segmentFocused, mobileFrame,
      beginPendingRecord, failPendingRecord, restoreAttemptOrigin, readingKey,
      inputValue, isLoading, setIsLoading, createSnapshot, history,
      currentSceneId, currentScene, setSceneNarrative,
      setAvailableActions, addToHistory, addActionNode,
      playerName, currentWorld,
      inventory,
      clues, autoSave,
      streamMode, isOnline, activeCommand,
      isShowingSegments, segmentIndex, segments, submitPendingKeiIfAny,
      // sceneNarrative 和 store.gameTime 不在此列出——用 ref 打破过度重新创建
    ]
  );

  // 保持 autoSubmitRef 与最新 handleSubmit 同步
  autoSubmitRef.current = handleSubmit;
  useNativeReadingContinuation({ segments,
    ready: !documentOverlayOpen && !draftDocuments.length && autoAdvanceOn && allSegmentsShown && !isLoading && !isTyping && !isVoicePlaying && !isVoiceGenerating && !generationError && !reviewing && !inputValue.trim() && !recordFocused && !recordNavigating && !quickToolsOpen && !showConsole && !showMomoiPanel && !excerptActive && !focusMode && !modOwnsReading && store.phase === 'playing',
    onContinue: request => autoSubmitRef.current(narrativeInput(request), false, request, { inputSource: 'automatic' }),
  });

  useEffect(() => {
    const queued = queuedKeiActionRef.current;
    if (!queued || isPipelineBusy() || store.phase !== "playing") return;
    const s = useGameStore.getState();
    if (getPendingActionNodeSave(useGameStore) || (readingActionRef.current && s.history.at(-1)?.id === readingActionRef.current && s.currentNode?.actionId !== readingActionRef.current)) return;
    const current = queued.actionId ? isCurrentKeiReview({
      worldId: queued.scope.worldId, playthroughId: queued.scope.playthroughId, worldLineId: queued.scope.worldLineId,
      archiveScope: queued.scope.archiveScope, parentNodeId: queued.scope.nodeId, actionId: queued.actionId,
    }, s) : isCurrentStreamContinuation(queued.scope, s);
    queuedKeiActionRef.current = null;
    if (current) autoSubmitRef.current(queued.input, queued.fromMap, queued.narrativeRequest, { inputSource: queued.inputSource, documentRefs: queued.documentRefs,branch:queued.branch,reference:queued.reference });
  }, [keiDoneTick, store.phase, currentNode?.id, nodeSaveTick]);

  useEffect(() => {
    const consume = () => {
      const state = useGameStore.getState();
      if (!state.mapTravelRequest || state.phase !== "playing") return;
      const request = state.takeMapTravelRequest();
      if (!request) return;
      const place = buildPlayerMap(state.currentWorld, state.currentSceneId, state.visitedScenes).places.find(place => place.id === request.to);
      // Validate again at consumption: loading a save or world can invalidate a queued route.
      let validPath = false;
      try { if (state.currentWorld) { validateTravelPath(state.currentWorld, state.createSnapshot(), request.path); validPath = true; } } catch { /* Show the same stale-route message below. */ }
      if (state.currentWorld?.id !== request.worldId || state.currentSceneId !== request.from || !validPath || state.isLoading || isPipelineBusy()) {
        showToast("路线已变化，请重新打开地图选择。", "red");
        return;
      }
      setShowConsole(false);
      if (request.path.length > 2) {
        setCanUndo(false); setRegionTransition(null);
        const journey = new MapJourneyController(request, {
          ready: next => { setRevealedCount(1); setReviewing(false); setRecordDirection("down"); advanceRecordPage(); setSegments(next); latestSegmentsRef.current = next; setSegmentIndex(0); setIsShowingSegments(true); playedSegmentsRef.current.clear(); },
          present: index => { setSegmentIndex(index); setReadingNodeId(null); },
          loading: busy => { setIsLoading(busy); },
          error: message => showToast(message, 'red'),
          stopped: () => {
            if (mapJourneyRef.current !== journey) return;
            mapJourneyRef.current = null;
            const live = useGameStore.getState();
            setSegments(live.savedSegments); latestSegmentsRef.current = live.savedSegments;
            setSegmentIndex(0); setIsShowingSegments(live.savedSegments.length > 0);
            setReadingNodeId(live.currentNode?.id ?? null);
          },
        });
        mapJourneyRef.current = journey;
        void journey.start();
      } else if (place) void handleSubmit(`我尝试前往${place.name}。`, true);
    };
    const unsubscribe = useGameStore.subscribe(consume);
    const timer = setTimeout(consume, 0);
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [handleSubmit, showToast, advanceRecordPage]);

  const discoveredCount = clues.filter((c) => c.discovered).length;
  const worldLineNodeCount = Object.keys(store.allNodes).length;
  const activeQuestCount = 0;
  const causalRipples = causalProjections.flatMap((projection) => projection.rippleEffects);
  const latestProjection = causalProjections[causalProjections.length - 1] ?? null;
  const presentNpcNames = useMemo(() => currentScene?.npcs ?? [], [currentScene]);
  const presentNpcModels = useMemo(
    () => buildNpcViewModels(presentNpcNames, {
      encyclopedia,
      npcStates,
      npcBehaviors,
      relationships,
    }),
    [presentNpcNames, encyclopedia, npcStates, npcBehaviors, relationships],
  );
  const archiveModel = buildArchiveConsoleModel({
    activeQuestCount,
    branchCount: worldLine?.branchCount ?? 0,
    causalProjections,
    criticalFactCount: criticalFacts.length,
    discoveredClueCount: discoveredCount,
    encyclopediaCount: encyclopedia.filter((entry) => entry.type !== "npc").length,
    inventoryCount: inventory.length,
    npcCount: currentScene?.npcs?.length ?? 0,
    totalClueCount: clues.length,
    worldLineNodeCount,
  });
  const consoleTabs = archiveModel.modules.filter(module => ["status", "worldline", "gallery"].includes(module.id)).map((module) => ({
    ...module,
    label: ui.consoleTabs[module.id],
    hint: ui.consoleHints[module.id],
  }));
  const openConsole = useCallback((tab: ArchiveConsoleTab) => {
    setConsoleTab(tab);
    setShowConsole(true);
  }, []);
  const savingBookmark = useRef(false);
  const handleManualBookmark = useCallback(async (name?: string, overwriteSaveId?: string) => {
    if (savingBookmark.current || isLoading) return "";
    savingBookmark.current = true;
    try {
      // Capture the visible paragraph and input draft, not the last screen-navigation checkpoint.
      preserveReadingDraft();
      const saveId = await saveGame(name, overwriteSaveId);
      showToast(saveId ? ui.labels.saveOk : ui.labels.saveFailed, saveId ? undefined : "red");
      return saveId;
    } catch { showToast(ui.labels.saveFailed, "red"); return ""; }
    finally { savingBookmark.current = false; }
  }, [isLoading, preserveReadingDraft, saveGame, ui.labels.saveFailed, ui.labels.saveOk]);
  const handleOpenGallery = useCallback(() => {
    if (currentWorld) setGalleryWorld(currentWorld);
    navigateTo("gallery");
  }, [currentWorld, navigateTo, setGalleryWorld]);
  const handleOpenDocuments = useCallback(() => {
    const state = useGameStore.getState();
    const scope = currentDocumentScope(state);
    // Preserve unsaved output when returning through the resource directory.
    if (!scope || !state.documentSelection?.initial || documentScopeKey(scope) !== documentScopeKey(state.documentSelection.scope)) {
      useGameStore.setState({ documentSelection: null });
    }
    void navigateTo('documents');
  }, [navigateTo]);
  const toggleStoryDisplayMode = useCallback(() => {
    setStoryDisplayMode((value) => {
      const next = value === "visual" ? "classic" : "visual";
      try {
        localStorage.setItem("eidos_story_display_mode", next);
      } catch {}
      return next;
    });
    setLayoutMenuOpen(false);
  }, []);
  const toggleRecordPanel = useCallback(() => {
    setRecordCollapsed((value) => {
      const next = !value;
      try { localStorage.setItem("eidos_record_collapsed", String(next)); } catch { /* The current view remains usable. */ }
      return next;
    });
    setLayoutMenuOpen(false);
  }, []);
  const toggleFocusMode = useCallback(() => {
    setFocusMode((value) => {
      const next = !value;
      if (next) {
        setShowConsole(false);
        setShowTokenDetail(false);
      }
      return next;
    });
    setLayoutMenuOpen(false);
  }, []);

  const navigateRecord = async (nodeId: string, direction: "up" | "down") => {
    if (recordNavigationLock.current) return;
    if (isLoading && mapJourneyRef.current) { showToast('地图行进完成后可切换行动记录，其他回看界面仍可打开。'); return; }
    const live = useGameStore.getState();
    if (rewindPolicy(live.currentWorld)) {
      const scope = JSON.stringify([live.worldLine?.id ?? live.currentPlaythroughId ?? live.currentWorld?.id ?? 'local', live.currentNode?.id ?? null]);
      saveReadingView(scope, { query: '', location: '', expanded: nodeId, onlyExcerpts: false, scrollTop: 0 });
      navigateTo('reading'); return;
    }
    recordNavigationLock.current = true;setRecordNavigating(true);
    try {
      await mapJourneyRef.current?.stop();
      // The accepted head is history while its next action is still provisional.
      await useGameStore.getState().openReadingNode(nodeId, isLoading ? pendingRecordSource.current?.originId ?? live.currentNode?.id : undefined);
      const pageKey = advanceRecordPage();
      setRecordDirection(direction);setRecordLanding({pageKey,edge:direction==='up'?'top':'bottom'});
      setRecordSelection({ pageKey, focused: false });
    } catch(error) {showToast(error instanceof Error ? error.message : '读取记录失败','red');}
    finally {recordNavigationLock.current=false;setRecordNavigating(false);}
  };

  // ========== 键盘快捷键 ==========
  // 放在 handleNextSegment / navigateTo / handleUndo 声明之后
  const kbRef = useRef({ fn: handleNextSegment, nav: navigateTo, undo: handleUndo });
  kbRef.current = { fn: handleNextSegment, nav: navigateTo, undo: handleUndo };

  useEffect(() => {
    const run = (action: ShortcutAction): boolean => {
      if (excerptActive || useGameStore.getState().phase !== 'playing') return false;
      if (action === 'status' || action === 'worldline' || action === 'gallery') { openConsole(action); return true; }
      if (action === 'focusInput') { inputRef.current?.focus(); return true; }
      if (documentOverlayOpen || quickToolsOpen || layoutMenuOpen || showConsole || showTokenDetail || showMomoiPanel || !canAdvanceReading) return false;
      if (action === 'advance') { kbRef.current.fn(); return true; }
      if (action === 'previous' && viewIndex > 0) {
        const reader = useGameStore.getState();
        if (reader.readingView) reader.setReadingSegment(viewIndex - 1);
        else setSegmentIndex(i => i - 1);
        return true;
      }
      return false;
    };
    const h = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || e.isComposing || excerptActive || useGameStore.getState().phase !== "playing") return;
      const target = document.activeElement;
      if (isKeyboardInput(e.target) || isKeyboardInput(target) || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (canUndo && !isLoading) { e.preventDefault(); kbRef.current.undo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      // Configured reading keys work after clicking a record; native activation still belongs to controls.
      // Both paragraph and record focus keep horizontal arrows assigned to playback.
      if (target?.closest('[data-action-record]') && !target.closest('[role="separator"], [role="slider"]') && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const action = e.key === 'ArrowLeft' ? 'previous' : 'advance';
        if (run(action)) e.preventDefault();
        return;
      }
      const nativeControl = target?.closest('button,a,[role="button"],[role="separator"]');
      if ((nativeControl || target?.closest('[data-action-record]')) && ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      if (tag === "input" || tag === "textarea" || document.activeElement?.getAttribute("contenteditable") === "true") return;
      if (e.key === "Escape") {
        if (layoutMenuOpen) { e.preventDefault(); setLayoutMenuOpen(false); return; }
        if (focusMode) { e.preventDefault(); setFocusMode(false); return; }
        if (showConsole) { e.preventDefault(); setShowConsole(false); return; }
        if (showTokenDetail) { e.preventDefault(); setShowTokenDetail(false); return; }
        return;
      }
      const action = shortcutAction(e, keyboardShortcuts);
      if (action && run(action)) e.preventDefault();
    };
    const fromMod = (event: Event) => {
      const action = (event as CustomEvent<unknown>).detail;
      if (isShortcutAction(action) && !isKeyboardInput(document.activeElement)) run(action);
    };
    window.addEventListener("keydown", h);
    window.addEventListener(HOST_SHORTCUT_EVENT, fromMod);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener(HOST_SHORTCUT_EVENT, fromMod); };
  }, [canUndo, focusMode, isLoading, layoutMenuOpen, openConsole, showConsole, showTokenDetail, canAdvanceReading, viewIndex, excerptActive, keyboardShortcuts, documentOverlayOpen, quickToolsOpen, showMomoiPanel]);

  const sceneLabel = currentScene?.name
    ? currentScene.region && currentScene.region !== currentScene.name
      ? `${currentScene.region} / ${currentScene.name}`
      : currentScene.name
    : currentSceneId || currentWorld?.name || "WORLD ACTIVE";
  const { tokensUsed, estimatedCost, tokenDetail } = worldTokenUsage?.[currentWorld?.id ?? ''] ?? EMPTY_TOKEN_TOTALS;
  const tokenLabel = formatUsage(tokensUsed, estimatedCost, showTokenDetail);
  const playSegment = async (index: number) => {
    setRecordSelection({ pageKey: recordPage, focused: true });
    if(useGameStore.getState().readingView) {useGameStore.getState().setReadingSegment(index);return;}
    const journey = mapJourneyRef.current;
    if (journey && index > journey.index) { if (index === journey.index + 1 && !isLoading) void journey.advance(); return; }
    const provisional = toolPreviewVisible.current || isLoading && voiceStream?.segments === latestSegmentsRef.current;
    if (index < 0 || index >= segments.length || isLoading && index > segmentIndex && !provisional) return;
    const node = useGameStore.getState().currentNode;
    try { if (node?.workspaceBranch && node.id === readingNodeId && !provisional) await mergeWorkspaceBranchAt(useGameStore, node.id, index); }
    catch (error) { setGenerationError(error instanceof Error ? error.message : '文件合并失败，请重试播放'); return; }
    setSegmentIndex(index); setIsShowingSegments(true);
  };
  const focusRecordSegment = async (index: number) => {
    if (historyView) {
      if (index === historyView.segmentIndex && segmentFocused) setRecordSelection({ pageKey: recordPage, focused: false });
      else await playSegment(index);
      return;
    }
    if (isShowingSegments && index === segmentIndex && segmentFocused) {
      // Focus is presentation state; leaving it must not mark unread prose as read.
      if (Math.max(revealedCount, segmentIndex + 1) < segments.length || isLoading) {
        setRecordSelection({ pageKey: recordPage, focused: false });
        setRecordFocused(false);
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (mapJourneyRef.current) await mapJourneyRef.current.stop();
      setIsShowingSegments(false); setSegmentIndex(0);
      submitPendingKeiIfAny();
    } else playSegment(index);
  };
  const visualStoryMode = storyDisplayMode === "visual";
  const clearConsolePreview = () => {
    if (consolePreviewTimer.current) clearTimeout(consolePreviewTimer.current);
    setConsolePreview(false); setCollectionPreview(false); mobileFrame.current?.style.removeProperty('--archive-offset');
  };
  useMobileSwipe(mobileFrame, { direction: isLoading ? 'left' : 'both', onSwipe: direction => {
      clearConsolePreview();
      if (direction === 'right') void navigateTo('world_select');
      else openConsole('status');
    },
    onProgress: distance => {
      if (distance > 0) {
        if (consolePreviewTimer.current) clearTimeout(consolePreviewTimer.current);
        setCollectionPreview(true);
        mobileFrame.current?.style.setProperty('--swipe-x', `${distance}px`); return;
      }
      if (consolePreviewTimer.current) clearTimeout(consolePreviewTimer.current);
      mobileFrame.current?.style.setProperty('--archive-offset', `${Math.max(0, (mobileFrame.current?.clientWidth ?? 0) + distance)}px`);
      setConsolePreview(true);
    }, onCancel: () => {
      mobileFrame.current?.style.setProperty('--archive-offset', `${mobileFrame.current.clientWidth}px`);
      consolePreviewTimer.current = setTimeout(clearConsolePreview, 180);
    },
    enabled: mobile && store.phase === 'playing' && !showConsole && !showTokenDetail && !quickToolsOpen && !showMomoiPanel && !excerptActive && !layoutMenuOpen && !modOwnsReading });

  const recordDocumentSource = historyView?.node ?? (rejectedAttempt || isLoading ? null : store.history.at(-1) ?? store.currentNode);

  // Stage and readout clicks share playback guards, including overlays and text selection.
  const advanceReading = () => {
    if (!canAdvanceReading || quickToolsOpen || showConsole || showMomoiPanel || layoutMenuOpen || showTokenDetail || excerptActive || recordNavigating || documentOverlayOpen || window.getSelection()?.toString()) return;
    void handleNextSegment();
  };

  return (
    <ExcerptSelection nodeId={viewNodeId} originId={viewOrigin} disabled={isLoading && !historyView} onActiveChange={setExcerptActive}>
    {collectionPreview && <div data-collection-preview className="eidos-collection-preview" inert aria-hidden="true"><WorldSelectScreen preview /></div>}
    <div ref={mobileFrame} className="eidos-game-frame h-full overflow-hidden"
      data-archive-preview={consolePreview || undefined}
      data-record-open={!recordHidden && (!modOwnsReading || sceneMapActive)}
      data-mod-reading={modOwnsReading && !sceneMapActive} data-scene-map={sceneMapActive}
      data-scene-image={Boolean(sceneImageUrl)}
      onPointerDownCapture={() => { editingAtPointerDown.current = hasTextInputFocus(); }}
      style={{ '--eidos-scene-overlay-opacity': displaySettings.sceneOverlayOpacity / 100, '--stage-record-width': !recordHidden && (!modOwnsReading || sceneMapActive) ? sceneMapActive && !mobile ? `min(${recordWidth.width}px, max(260px, calc(100vw - var(--scene-map-left, 106px) - 318px)))` : `min(${recordWidth.width}px, calc(100vw - 2rem))` : '0px' } as React.CSSProperties}
      onClick={event => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, textarea, select, a, [contenteditable], [role="button"], [role="slider"], [role="dialog"], [role="separator"], [data-stage-lower-bound], .eidos-nativebar') || window.getSelection()?.toString()) return;
        if (!mobile && !sceneMapActive && target.closest('[data-action-record]')) return;
        advanceReading();
      }}
      onClickCapture={event => {
      const target = event.target as HTMLElement;
      const editing = editingAtPointerDown.current || hasTextInputFocus();
      editingAtPointerDown.current = false;
      // Pointer-down precedes the record's focus change: dismissing the keyboard is one action.
      if (editing && !target.closest('button:not([data-reading-text]), input, textarea, select, a, [contenteditable], [role="textbox"], [role="dialog"]')) {
        inputRef.current?.blur(); event.stopPropagation(); return;
      }
      if (showTokenDetail && !target.closest('[data-token-usage]')) { setShowTokenDetail(false); event.stopPropagation(); }
      if (quickToolsOpen && !target.closest('[data-quick-tools]')) { setQuickToolsOpen(false); event.stopPropagation(); }
      if (layoutMenuOpen && !target.closest('.eidos-page-organizer')) { setLayoutMenuOpen(false); event.stopPropagation(); }
    }}>
      {savedNavigation.dialog}
      {getPendingActionNodeSave(useGameStore)?.phase === 'failed' && (
        <div role="alert" className="fixed top-14 right-4 z-10 bg-black/90 p-3 text-xs text-amber-300">
          上一行动保存失败。重试后可继续。
          <button className="eidos-focus ml-3 underline" onClick={async () => {
            const origin = createStreamContinuationScope(useGameStore.getState());
            setIsLoading(true);
            try {
              const node = await retryAcceptedActionNode(useGameStore);
              if (await applyGameRewindRequest(useGameStore, node)) { speculativeEngine.cancel(); setCanUndo(false); setLastTimeSpent(null); showToast('已回到过去，主角保留了此前的经历。'); }
            } catch (error) { showToast(error instanceof Error ? error.message : '保存仍未成功，请重试', 'red'); }
            finally { const live = createStreamContinuationScope(useGameStore.getState()); if (live.worldId === origin.worldId && live.playthroughId === origin.playthroughId && (origin.worldLineId === null || live.worldLineId === origin.worldLineId) && live.archiveScope === origin.archiveScope) setIsLoading(false); }
          }}>重试保存</button>
        </div>
      )}
      {savedNavigation.busy && <p role="status" className="fixed top-14 right-4 z-10 bg-black/90 p-3 text-sm text-white">正在保存…</p>}
      {/* 区域过渡画面 */}
      {regionTransition && (
        <RegionTransition
          regionName={regionTransition.regionName}
          regionDescription={regionTransition.regionDescription}
          onContinue={() => setRegionTransition(null)}
        />
      )}

      {/* 离线提示 */}
      {!isOnline && (
        <div className="px-4 py-1.5 bg-amber-950/40 border-b border-amber-800/30 text-xs text-amber-400/80 text-center">
          离线模式 — 你的输入将在重新连接时发送
          {offlineQueue.length > 0 && `（${offlineQueue.length} 条排队中）`}
        </div>
      )}
      <div className="eidos-nativebar absolute left-0 right-0 top-0 z-30 flex h-[50px] items-center gap-4 px-5 py-2 text-white">
        <button
          disabled={isLoading || savedNavigation.busy}
          onClick={() => navigateTo("world_select")}
          className="eidos-focus text-lg font-black tracking-[-.08em] text-white"
          title="返回世界书库"
        >
          EIDOS
        </button>
        <button
          onClick={() => openConsole("status")}
          className="eidos-focus max-w-[38vw] truncate border-l-2 border-[color:var(--eidos-accent)] pl-3 text-left font-mono text-[10px] uppercase tracking-[.16em] text-white/70 hover:text-white"
          title={ui.consoleTabs.status}
        >
          {currentWorld?.name || "WORLD"} / {sceneLabel}
        </button>
        <span className="eidos-game-clock ml-auto font-mono text-[10px] uppercase tracking-[.14em] text-white/64">
          DAY {String(gameTime.day).padStart(2, "0")} · {String(gameTime.hour).padStart(2, "0")}:{String(gameTime.minute).padStart(2, "0")} · {weather}
        </span>
        {!mobile && <button
          data-token-usage onClick={() => setShowTokenDetail((v) => !v)}
          className="eidos-focus eidos-micro-action eidos-micro-action--dark whitespace-nowrap px-2 py-1 font-mono text-[9px] normal-case tabular-nums tracking-[.08em]"
          aria-label="当前世界 AI 用量" aria-expanded={showTokenDetail} title="当前世界累计用量，点击展开或收起"
        >
          <span className="eidos-desktop-telemetry">Total {tokenLabel}</span>
        </button>}
        {mobile && <span className="eidos-mobile-node-depth" aria-label="节点深度" title="当前节点深度">{viewDepth}</span>}
        <span role="status" className="eidos-game-activity border-l-2 border-[color:var(--eidos-accent)] pl-2 font-mono text-[9px] uppercase tracking-[.16em] text-white/72">
          {isLoading ? `${loadingElapsed}s` : keiReviewing ? "REVIEWING" : ui.active}
        </span>
        <div className="eidos-display-stack absolute right-5 top-[58px] z-50 flex flex-col items-end gap-2">
        {showTokenDetail && (
          <div data-token-usage role="region" aria-label="当前世界用量明细" className="eidos-glass eidos-diagonal-cut w-72 space-y-2 p-4 text-[10px] text-zinc-400 shadow-2xl shadow-black/50">
            <div className="font-mono uppercase tracking-[.24em] text-[color:var(--eidos-accent)]">System Telemetry</div>
            <div className="flex justify-between"><span>ALICE</span><span>{((tokenDetail.alicePrompt + tokenDetail.aliceCompletion) / 1000).toFixed(1)}k token</span></div>
            <div className="flex justify-between"><span>KEI</span><span>{((tokenDetail.keiPrompt + tokenDetail.keiCompletion) / 1000).toFixed(1)}k token</span></div>
            <div className="flex justify-between"><span>UZQ</span><span>{((tokenDetail.uzqPrompt + tokenDetail.uzqCompletion) / 1000).toFixed(1)}k token</span></div>
            <div className="flex justify-between border-t border-white/10 pt-2 text-zinc-300"><span>Total</span><span>{tokenLabel}</span></div>
            <AliceContextMeter />
          </div>
        )}
        {!showConsole && (
          <div className="eidos-page-organizer">
            <button
              type="button"
              className="eidos-page-organizer__trigger"
              aria-label="页面整理"
              aria-expanded={layoutMenuOpen}
              onClick={() => setLayoutMenuOpen((value) => !value)}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="16" height="14" rx="1"/><path d="M12 3v14M2 7h16"/></svg>
            </button>
            {layoutMenuOpen && (
              <div className="eidos-page-organizer__panel" role="menu" aria-label="页面整理选项">
                <button
                  type="button"
                  role="menuitem"
                  className="eidos-page-organizer__item"
                  data-active={storyDisplayMode === "classic"}
                  aria-label={storyDisplayMode === "visual" ? "切换为经典纯文本布局" : "切换为图像对话布局"}
                  title={storyDisplayMode === "visual" ? "经典纯文本布局" : "图像对话布局"}
                  onClick={toggleStoryDisplayMode}
                >
                  <ActionIcon name={storyDisplayMode === "visual" ? "layoutText" : "layoutImage"} width={20} height={20} />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="eidos-page-organizer__item"
                  aria-label={recordCollapsed ? "展开场景记录" : "收起场景记录"}
                  title={recordCollapsed ? "展开场景记录" : "收起场景记录"}
                  onClick={toggleRecordPanel}
                >
                  <ActionIcon name={recordCollapsed ? "panelExpand" : "panelCollapse"} width={20} height={20} />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="eidos-page-organizer__item"
                  aria-label={focusMode ? "退出欣赏模式" : "收起全部界面"}
                  title={focusMode ? "退出欣赏模式" : "收起全部界面"}
                  onClick={toggleFocusMode}
                >
                  <ActionIcon name={focusMode ? "minimize" : "maximize"} width={20} height={20} />
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>


      {/* ======== 主体 ======== */}
      <div data-story-stage className="absolute inset-0 overflow-clip">
          <div className="eidos-scene-layer pointer-events-auto absolute inset-0 z-0 opacity-78">
          <div className="eidos-scene-canvas-host absolute inset-[-5%] flex items-center justify-center">
            <VisualNovelCanvas
              currentSegment={viewSegment}
              showToast={showToast}
              imagesEnabled={visualStoryMode}
            />
          </div>
          <div className="eidos-scene-shade absolute inset-0" />
        </div>
        {!focusMode && !modOwnsReading && !sceneMapActive && (
          <SegmentGlyphField
            passageKey={segmentFocusKey}
            originId={viewOrigin} nodeId={viewNodeId ?? undefined} segmentIndex={viewIndex} playbackKey={viewPlaybackKey} animate={!reviewing}
            sourceComplete={!segmentIsStreaming}
            currentSegment={viewSegment}
            displayedText={viewText}
            sceneName={currentScene?.name || currentScene?.region || currentWorld?.name || "EIDOS"}
            dialogueTextMode={visualStoryMode ? "index" : "full"}
          />
        )}
        {!focusMode && (
        <div className="eidos-day-marker pointer-events-none absolute left-[22px] top-[58px] z-[3] hidden md:block">
          <span className="eidos-day-marker__label">{locale === 'en' ? 'CURRENT NODE' : '当前节点'}</span>
          <strong className="block text-7xl font-black font-mono leading-[.76] tracking-[0.01em]" style={sceneMapActive ? { fontSize: `min(3rem, calc((var(--scene-map-left) - 38px) / ${Math.max(2, String(viewDepth).length) * .65}))` } : undefined}>
            <RollingNumber value={viewDepth} />
          </strong>
          <span className="eidos-day-marker__sub mt-4 block font-mono text-[9px] uppercase leading-5 tracking-[.18em]">
            DAY {String(gameTime.day).padStart(2, "0")} / {String(gameTime.hour).padStart(2, "0")}:{String(gameTime.minute).padStart(2, "0")}
          </span>
        </div>
        )}
        {!focusMode && !showConsole && (
          <div className="eidos-gameplay-hud-stage" style={{ '--hud-record-width': recordCollapsed ? '0px' : `${recordWidth.width}px` } as React.CSSProperties}>
            <GameplayHud />
          </div>
        )}
        {!focusMode && !showConsole && (
          <ConsoleRail
            tabs={[
              { id: "status", label: ui.consoleTabs.status, shortcut: keyboardShortcuts.status.toUpperCase() || '—', count: inventory.length },
              { id: "worldline", label: ui.consoleTabs.worldline, shortcut: keyboardShortcuts.worldline.toUpperCase() || '—', count: worldLineNodeCount },
              { id: "gallery", label: ui.consoleTabs.gallery, shortcut: keyboardShortcuts.gallery.toUpperCase() || '—' },
            ]}
            onOpenTab={openConsole}
          >
            <SegmentNav focused={segmentFocused} isShowingSegments={historyView ? true : isShowingSegments} segmentIndex={viewIndex} segmentsLength={viewSegments.length} onSelect={playSegment} />
          </ConsoleRail>
        )}
        <div className="relative z-10 h-full">
          <ConsoleBackdrop open={showConsole} onClose={() => setShowConsole(false)} />
          {(showConsole || consolePreview) && (
            <div role={mobile ? 'dialog' : undefined} aria-label={mobile ? '游戏档案' : undefined} aria-modal={mobile ? true : undefined} className="eidos-console-drawer absolute bottom-0 left-0 top-[50px] z-30 grid w-[min(1040px,84vw)] grid-cols-[188px_1fr] overflow-hidden border-r border-white/15 bg-[color:var(--eidos-paper)] text-[color:var(--eidos-ink)] shadow-2xl shadow-black/40">
            {mobile ? <MobileArchive onClose={() => setShowConsole(false)} onNavigate={phase => { void navigateTo(phase); }} onSave={handleManualBookmark}
              onGallery={handleOpenGallery} onDocuments={handleOpenDocuments} onVoices={() => void navigateTo('audio')} busy={isLoading || savedNavigation.busy} usage={tokenLabel} /> : <>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-[color:var(--eidos-accent)]" />
            <aside className="eidos-console-sidebar relative flex flex-col border-r border-black/15 py-7 pl-8 pr-5">
              <button type="button" className="eidos-console-mobile-close eidos-focus" aria-label="关闭游戏档案" onClick={() => setShowConsole(false)}>×</button>
              <div className="text-[40px] font-black leading-[.8] tracking-[-.09em]">
                W/{String(gameTime.day).padStart(2, "0")}
              </div>
              <div className="mt-4 font-mono text-[8px] uppercase leading-4 tracking-[.16em] text-black/55">
                {ui.archiveSub}<br />{ui.archive}
              </div>
              <nav className="mt-7 grid gap-1">
                {consoleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    data-active={consoleTab === tab.id}
                    onClick={() => setConsoleTab(tab.id)}
                    className="eidos-focus eidos-console-tab px-2 py-2 text-left font-mono text-[9px] uppercase tracking-[.12em]"
                  >
                    <span>{tab.label} →</span>
                    {typeof tab.count === "number" && <span className="float-right tabular-nums opacity-65">{String(tab.count).padStart(2, "0")}</span>}
                  </button>
                ))}
              </nav>
              <div className="mt-6 border-l-2 border-[color:var(--eidos-accent)] pl-3 font-mono text-[8px] uppercase leading-4 tracking-[.14em] text-black/42">
                {ui.consoleHints[consoleTab]}
              </div>
              <button onClick={() => setShowConsole(false)} className="eidos-focus eidos-micro-action mt-auto px-3 py-2 text-left font-mono text-[8px] uppercase tracking-[.16em]">
                {ui.closeConsole}
              </button>
            </aside>
            <main className="eidos-console-content"><div className="eidos-console-content__body px-7 py-7">
              <div className="mb-5 flex items-start border-b border-black/20 pb-4">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[.2em] text-black/42">
                    {currentWorld?.name || "WORLD"} / {sceneLabel}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold leading-none tracking-[-.05em]">
                    {ui.consoleTabs[consoleTab]}
                  </h2>
                </div>
                <button
                  onClick={() => { void handleManualBookmark(); }}
                  className="eidos-focus ml-auto bg-[color:var(--eidos-accent)] px-3 py-2 font-mono text-[8px] uppercase tracking-[.14em] text-white [clip-path:polygon(8px_0,100%_0,100%_100%,0_100%,0_8px)]"
                >
                  {ui.actions.manualSave}
                </button>
              </div>
              {consoleTab === "status" && (
                <div className="space-y-5">
                  <div className="eidos-archive-actions eidos-archive-actions--status" aria-label="世界状态快捷操作">
                    <ArchiveStatButton

                      value={inventory.length}
                      label={ui.labels.inventory}
                      hint={ui.actions.openInventory}
                      onClick={() => navigateTo("inventory")}
                    />
                    <ArchiveStatButton  value="NPC" label="人物档案" hint="查阅已知人物与证词" accessibleName="人物档案" onClick={() => navigateTo("npc_dossiers")} />
                    <ArchiveStatButton  value="SET" label={ui.actions.openSettings} hint="调整游戏偏好" accessibleName={ui.actions.openSettings} onClick={() => navigateTo("settings")} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.14fr)_minmax(0,.86fr)]">
                    <div className="min-h-[300px] min-w-0 overflow-hidden border border-black/15 bg-white/35">
                      <RegionMap onOpen={() => navigateTo("map")} />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="border-l-4 border-[color:var(--eidos-accent)] bg-white/45 p-4 text-sm leading-7 text-black/62">
                        {playerName || "主角"} · {protagonistState.health} · {protagonistState.mood}
                        {protagonistState.notes ? <span className="block pt-1 text-xs text-black/45">{protagonistState.notes}</span> : null}
                      </div>
                      <GameplayPluginDetails />
                    </div>
                  </div>
                </div>
              )}
              {consoleTab === "worldline" && (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-2">
                    <ArchiveStatButton value={worldLineNodeCount} label={ui.labels.nodes} hint={ui.actions.openFullWorldline} onClick={() => { navigateTo("world_line_view"); }} />
                    <ArchiveStatButton value={worldLine?.branchCount ?? 0} label={ui.labels.branches} hint={ui.actions.openFullWorldline} tone="accent" onClick={() => { navigateTo("world_line_view"); }} />
                    <ArchiveStatButton value={store.currentNode?.stepNumber ?? 0} label="CURRENT" hint={ui.actions.openFullWorldline} onClick={() => { navigateTo("world_line_view"); }} />
                  </div>
                  <div className="border-l-4 border-[color:var(--eidos-accent)] bg-white/45 p-5">
                    <div className="font-mono text-[8px] uppercase tracking-[.16em] text-black/45">CURRENT NODE</div>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-.04em]">{plainDocumentText(currentNode?.playerInput || "故事开始")}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-black/58">{currentNode ? <PresentedRecordText nodeId={currentNode.id} /> : "此处尚无可回看的已读正文。"}</p>
                  </div>
                  <button
                    onClick={() => { navigateTo("world_line_view"); }}
                    data-text-surface="dark" className="bg-[#202328] px-4 py-3 font-mono text-[9px] font-extrabold uppercase tracking-[.14em] text-white [clip-path:polygon(0_0,100%_0,96%_100%,0_100%)]"
                  >
                    {ui.actions.openFullWorldline} →
                  </button>
                </div>
              )}
              {consoleTab === "gallery" && (
                <div className="space-y-5">
                  <div className="eidos-archive-cover relative min-h-[280px] overflow-hidden p-6 text-white">
                    <div className="relative z-[2] font-mono text-[9px] uppercase tracking-[.16em] text-white/72">IMAGES / AUDIO / DOCUMENTS</div>
                    <h3 className="relative z-[2] mt-20 text-4xl font-semibold leading-none tracking-[-.07em]">{currentWorld?.name || "EIDOS"}</h3>
                    <p className="relative z-[2] mt-4 font-mono text-[10px] leading-5 text-zinc-300">
                      {sceneLabel}<br />{sceneImageUrl ? "已绑定场景图" : "可上传场景图"}
                    </p>
                  </div>
                  <ArchiveResourceActions onGallery={handleOpenGallery} onDocuments={handleOpenDocuments} onMomoi={() => void navigateTo('audio')} />
                </div>
              )}
            </div></main>
            </>}
          </div>
        )}

        <PresentationDim playbackKey={historyView ? undefined : presentationKey} />
        {!focusMode && (!modOwnsReading || sceneMapActive) && (
          <div className={`eidos-story-slot eidos-record-shell absolute bottom-[80px] right-4 top-[67px] z-[5] ${recordHidden ? "eidos-story-slot--collapsed" : ""}`}
            style={recordWidth.style} aria-hidden={recordHidden || mobile && showConsole} inert={recordHidden || mobile && showConsole}>
            <PanelResizeHandle label="行动记录宽度" panel={recordWidth} />
            <ActionRecordPanel visualLayout={visualStoryMode} originId={viewOrigin} playbackKey={viewPlaybackKey} displayNodeId={viewNodeId} workspaceAttempt={workspaceAttempt} onResolveWorkspace={segment => { const live = useGameStore.getState(); if (live.isLoading || isPipelineBusy()) { showToast('行动完成后可处理文件合并冲突。'); return; } const node = live.currentNode; if (node) setWorkspaceConflict({ nodeId: node.id, segmentIndex: segment }); }} inputDocuments={recordDocumentSource?.inputDocuments} outputDocuments={recordDocumentSource?.outputDocuments} onDocumentPreviewChange={setDocumentPreviewOpen} focused={segmentFocused} direction={recordDirection} landing={recordLanding} pageKey={recordPage} segments={viewSegments} segmentIndex={viewIndex}
              draftIndex={!historyView && lastIsDraftRef.current ? segments.length - 1 : undefined}
              reviewing={reviewing} revealedCount={revealedCount} onPlay={index => { if (mobile && canAdvanceReading && index === viewIndex) handleNextSegment(); else void focusRecordSegment(index); }} playerInput={historyView?.node.playerInput ?? rejectedAttempt ?? (isLoading ? preActionInput.current : store.currentNode?.playerInput)}
              allowNavigationWhileLoading
              pendingPreviousId={isLoading && !historyView && pendingSourceNode && getPlayerVisibleText(pendingSourceNode) ? pendingSourceNode.id : undefined}
              onPendingNext={isLoading && historyView?.nodeId === pendingRecordSource.current?.nodeId ? () => { store.closeReadingView(); const pageKey = advanceRecordPage(); setRecordDirection('down'); setRecordSelection({ pageKey, focused: false }); } : undefined}
              transient={rejectedAttempt ? { onReturn: restoreAttemptOrigin } : undefined}
              notice={!rejectedAttempt && !isLoading && store.currentNode?.rewindFailure ? `回溯未执行：${store.currentNode.rewindFailure.reason} 当前仍停留在第${store.currentNode?.stepNumber ?? 0}步。` : undefined}
              showing={historyView ? segmentFocused : isShowingSegments} loading={isLoading && !historyView || recordNavigating} replyPhase={generationPhase}
              fallback={currentNode?.aiResponse || (history.length ? sceneNarrative : '')}
              actions={rejectedAttempt ? [] : historyView ? (historyView.node.playerVisibleText ?? historyView.node.aiResponse).length>=historyView.node.aiResponse.length ? historyView.node.availableActions ?? [] : [] : reviewing ? store.currentNode?.availableActions ?? availableActions : effectiveAvailableActions} onAction={action => { setActiveCommand(null); void handleSubmit(action); }}
              onReplay={replayVoice} onNavigate={navigateRecord} onFocusChange={setRecordFocused} />
          </div>
        )}

        {!focusMode && (!modOwnsReading || sceneMapActive) && visualStoryMode && (
          <div className="eidos-dialogue-stage pointer-events-none absolute bottom-[6.15rem] left-[10rem] right-[5.6rem] z-[9]">
            <DialogueReadout
              passageKey={segmentFocusKey}
            originId={viewOrigin} nodeId={viewNodeId ?? undefined} segmentIndex={viewIndex} playbackKey={viewPlaybackKey} animate={!reviewing}
              sourceComplete={!segmentIsStreaming}
              currentSegment={viewSegment}
              displayedText={viewText}
              sceneName={sceneLabel}
              hasSceneImage={Boolean(sceneImageUrl)}
              hideNarration={displaySettings.hideNarrationInDialogue}
              onAdvance={advanceReading}
              onReplay={() => replayVoice()}
            />
          </div>
        )}

        {currentWorld?.gameplayPlugins?.some(plugin => plugin.ui) && <GameplayModStages
          reading={{ segments: isShowingSegments ? segments.slice(0, segmentIndex + 1) : segments, index: segmentIndex, displayedText, complete: allSegmentsShown, loading: isLoading, error: generationError, typing: isTyping, inputBlocked: quickToolsOpen || layoutMenuOpen || showTokenDetail || excerptActive, paused: documentOverlayOpen || focusMode || showConsole || showMomoiPanel || store.phase !== 'playing' }}
          onAdvance={handleNextSegment}
          onSubmit={(action, request) => handleSubmit(action, false, request)}
          onActiveChange={setModReadingActive}
          onPresentationChange={setModPresentation}
          onNotice={showToast}
        />}

        <CardModPanels
          reading={{ segments: isShowingSegments ? segments.slice(0, segmentIndex + 1) : segments, index: segmentIndex, displayedText, complete: allSegmentsShown, loading: isLoading, error: generationError, typing: isTyping, inputBlocked: quickToolsOpen || layoutMenuOpen || showTokenDetail || excerptActive, paused: documentOverlayOpen || focusMode || showConsole || showMomoiPanel || store.phase !== 'playing' }}
          onAdvance={handleNextSegment} onSubmit={(action, request) => handleSubmit(action, false, request)}
        />

        {!focusMode && (
        <div data-stage-lower-bound inert={mobile && showConsole} className="pointer-events-auto absolute bottom-[18px] left-[82px] right-[22px] z-[12]">
        <ActionInput
          toolsMenu={quickToolsOpen && <QuickTools autoAdvance={autoAdvanceOn} autoSelect={autoSelectOn} voiceAuto={momoiSettings.autoPlay} stream={streamMode} delay={autoSpeed}
          loading={isLoading} canUndo={canUndo} allowUndo={!rewindPolicy(currentWorld)}
          onAutoAdvance={() => persistSettingsPatch({ autoAdvance: !autoAdvanceOn })}
          onAutoSelect={() => { setReviewing(false); persistSettingsPatch({ autoSelect: !autoSelectOn, ...(!autoSelectOn ? { autoAdvance: true } : {}) }); }}
          onVoiceAuto={() => store.setMomoiSettings({ autoPlay: !momoiSettings.autoPlay })}
          onStream={() => { setStreamMode(!streamMode); localStorage.setItem('eidos_stream_mode', JSON.stringify(!streamMode)); }}
          onVoice={() => { setQuickToolsOpen(false); void navigateTo('audio'); }}
          onSave={() => { void handleManualBookmark(); setQuickToolsOpen(false); }}
          onUndo={() => { handleUndo(); setQuickToolsOpen(false); }}
          onSettings={() => { setQuickToolsOpen(false); void navigateTo('settings'); }}
          onDelay={delay => persistSettingsPatch({ autoAdvanceDelay: delay })} onClose={() => setQuickToolsOpen(false)} />}
          divider={mobile && <MobilePlayBar focused={segmentFocused} index={viewIndex} count={viewSegments.length} showing={historyView ? true : isShowingSegments}
          loading={isLoading} busy={recordNavigating} modActive={modOwnsReading} onSelect={playSegment} />}
          tools={<button data-quick-tools aria-label="播放与快捷设置" aria-expanded={quickToolsOpen} className="eidos-focus min-h-12 shrink-0 px-4 text-lg" onClick={() => setQuickToolsOpen(v => !v)}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 17h16M8 4v6m8 4v6" /></svg></button>}
          inputElementRef={inputRef}
          onStop={() => { toolPreviewRollback.current?.(); if (mapJourneyRef.current) { void mapJourneyRef.current.stop(); return; } recordSubmission.current++; if (speculativeEngine.hasSelectedWait) speculativeEngine.cancel(); abortActiveStream({ cancelKeiQueue: false }); restoreAttemptOrigin(); setInputValue(draft => draft.trim() ? draft : preActionInput.current); setIsLoading(false); setStreamBusy(false); showToast("已停止生成，可以编辑新的行动"); }}
          allSegmentsShown={allSegmentsShown}
          isLoading={isLoading}
          generationPhase={generationPhase}
          generationError={generationError}
          onRetry={artifactRetry && isCurrentStreamContinuation(artifactRetry.scope, useGameStore.getState()) ? () => {
            setGenerationError(null); beginPendingRecord(artifactRetry.input, getActionObservation(artifactRetry.scope)); setStreamBusy(true);
            void processActionResponse(artifactRetry.data, artifactRetry.input, artifactRetry.introspection, { scope: artifactRetry.scope, requireActive: false, usageAlreadyRecorded: true });
          } : undefined}
          inputValue={inputValue}
          preActionInput={preActionInput.current}
          onInputChange={text => {
            setInputValue(text);
            if (activeDocumentScope && draftDocuments.length) {
              const tokens = inlineDocumentTokens(text);
              useGameStore.setState({ documentDraft: { scope: activeDocumentScope, links: draftDocuments.filter(link => tokens.some(token => token.ref?.documentId === link.documentId && token.ref.revision === link.revision)) } });
            }
          }}
          onRecallAction={record => { if (activeDocumentScope) useGameStore.setState({ documentDraft: { scope: activeDocumentScope, links: record.inputDocuments ?? [] } }); }}
          onRestoreDocuments={links => { if (activeDocumentScope) useGameStore.setState({ documentDraft: { scope: activeDocumentScope, links } }); }}
          documentLinks={draftDocuments}
          onPickDocuments={() => setDocumentPickerOpen(open => !open)}
          documentPicker={documentPickerOpen && activeDocumentScope ? <DocumentPicker key={activeDocumentKey} scope={activeDocumentScope} selected={draftDocuments}
            defaultAllowWrite={store.sandboxMode && getSandboxDossierId(store.sandboxDossierId) === '002'}
            onChange={links => useGameStore.setState({ documentDraft: { scope: activeDocumentScope, links } })} onClose={() => setDocumentPickerOpen(false)} /> : null}
          onFilesDrop={async files => {
            const scope = currentDocumentScope(useGameStore.getState());
            if (!scope) { showToast('请先进入一个周目', 'red'); return; }
            setDocumentPickerOpen(true);
            const results = await Promise.allSettled(files.map(file => importDocument(scope, file)));
            const live = currentDocumentScope(useGameStore.getState());
            if (!isMountedRef.current || !live || documentScopeKey(live) !== documentScopeKey(scope)) return;
            const errors = results.flatMap((result, i) => result.status === 'rejected' ? [`${files[i].name}：${result.reason instanceof Error ? result.reason.message : '导入失败'}`] : []);
            if (errors.length) showToast(errors.join('；'), 'red');
          }}
          onSubmit={() => handleSubmit(undefined, false, undefined, { documentRefs: draftDocuments.map(link => ({ ...link })) })}
        />
        </div>
        )}
        </div>
      </div>

      {workspaceConflict && store.currentNode?.id === workspaceConflict.nodeId && <WorkspaceConflictDialog nodeId={workspaceConflict.nodeId} segmentIndex={workspaceConflict.segmentIndex}
        onClose={() => setWorkspaceConflict(null)} onRetry={async () => {
          const { nodeId, segmentIndex: target } = workspaceConflict;
          await mergeWorkspaceBranchAt(useGameStore, nodeId, target);
          if (getPendingActionNodeSave(useGameStore)?.phase === 'failed') await retryAcceptedActionNode(useGameStore);
          const node = useGameStore.getState().currentNode;
          if (node?.id !== nodeId) throw new Error('播放节点已变化');
          const restored = await loadBlob(node.segmentHash) as StorySegment[] | null;
          if (!restored || useGameStore.getState().currentNode?.id !== nodeId) throw new Error('原文载入失败或节点已变化');
          setSegments(restored); latestSegmentsRef.current = restored; setAvailableActions(node.availableActions ?? []);
          setReadingNodeId(nodeId); readingActionRef.current = node.actionId ?? null;
          setSegmentIndex(target); setIsShowingSegments(true); setGenerationError(null); setWorkspaceConflict(null);
        }} />}
      <ToastContainer toasts={toasts} />
      <PermissionEscalationPanel />


      {/* 人格追踪面板（开发期，Phase 3） */}
      <PersonalityTracePanel
        open={useGameStore((s) => (s as any).showTracePanel ?? false)}
        onClose={() => (useGameStore.getState() as any).toggleTracePanel?.()}
      />
    </div>
    </ExcerptSelection>
  );
}
