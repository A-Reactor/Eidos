"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { restoreSourceBriefChoices } from '@/lib/game/source-reconstruction/brief-choices';
import { eligibleSourceStyleSamples } from '@/lib/game/source-reconstruction/style';
import { assertReconstructionArchive } from '@/lib/game/source-reconstruction/compatibility';
import { assertWorldBrief } from '@/lib/game/world-creation-brief';
import { InteractionDialog } from "@/components/ui/InteractionDialog";
import { BackButton } from "@/components/ui/BackButton";
import { normalizeGenerationProfile, type WorldGenerationProfile } from "@/lib/ai/world-generation-profile";
import { creationInputsFromPreset, type WorldForm, type CreationMode, type SourceDocumentDraft, type CreationDraft } from "@/lib/game/creation-materials";
import { InfoChoice } from '@/components/ui/InfoChoice';
import { FieldPin } from './creation/FieldPin';
import { WorldBriefEditor } from './creation/WorldBriefEditor';
import { SourceReconstructionPanel } from './creation/SourceReconstructionPanel';
import { SourceStylePicker } from './creation/SourceStylePicker';
import { applyBriefEdit, briefFromConcept, type BriefEdit, type WorldCreationBrief } from '@/lib/game/world-creation-brief';
import { resumeSourceReconstruction } from '@/lib/game/source-reconstruction/controller';
import { createWorldCreationSession, readWorldCreationSession } from '@/lib/game/world-creation-session';
import { createWorldFillTracker } from '@/lib/game/world-fill-progress';
import { loadSourceCheckpoint, restoreSourceCheckpoint } from '@/lib/game/source-reconstruction/checkpoint-store';
import { executeSourceTask, sourceModelConfigHash } from '@/lib/game/source-reconstruction/client';
import { indexSources, sourceRevision, stableHash } from '@/lib/game/source-reconstruction/source-index';
import { createReconstructionArchive } from '@/lib/game/source-reconstruction/archive';
import type { SourceReconstructionArchive } from '@/lib/game/source-reconstruction/types';
import { loadSettings } from '@/lib/game/settings';
import { buildSourceNarrativeStyle } from '@/lib/game/narrative-style';
import { saveFile } from '@/lib/game/save-file';


import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import { ResponsiveSidebar } from "@/components/ui/ResponsiveSidebar";
import { CreationDock } from './creation/CreationDock';
import { useState, useEffect, useRef, useCallback } from "react";
import { saveToDB, loadFromDB } from "@/lib/game/storage";
import { CreationCards } from "./creation/CreationCards";
import { readCreationCards, creationCardDocument, attachCreationCards, type CreationCard } from "@/lib/game/cards/creation";
import { exportWorldCardFiles, restoreWorldCardFiles } from "@/lib/game/cards/transfer";
import { CreationResult } from "./creation/CreationResult";
import { CreationPresets } from "./creation/CreationPresets";
import { GameplayPluginPicker } from "./creation/GameplayPluginPicker";
import { pluginContentKey } from "@/lib/game/plugins/library";
import gameplayCatalog from "@/lib/game/plugins/catalog.json";
import { parseGameplayPlugins } from "@/lib/game/plugins/manifest";
import type { GameplayPlugin } from "@/lib/game/plugins/types";
import { CreationProgress, FIELD_MESSAGES } from "./creation/CreationProgress";
import { readCreationEvents } from "@/lib/ai/creation-stream";
import { useGameStore } from "@/store/game-store";
import type { WorldDefinition } from "@/lib/game/types";
import {
  DEFAULT_NARRATIVE_STYLE_ID,
  NARRATIVE_STYLE_PRESETS,
  buildNarrativeStyleProfile,
  formatNarrativeStyleForKei,
  type NarrativeStylePresetId,
} from "@/lib/game/narrative-style";
import {
  createSourceCorpus,
  type CanonLedger,
  type EvidenceAtom,
  type SourceCorpus,
} from "@/lib/ai/source-archive";

// ============================================================
// Skill 注册表 — 可用游戏模式
// ============================================================

const CREATION_SECTION_LABELS: Record<string, string> = { world: '世界信息', source: '资料档案', style: '文风写法', skills: '玩法与模组', cards: '酒馆卡', presets: '生成预设' };
type SourceArchiveStatus = "idle" | "extracting" | "synthesizing" | "ready" | "error";

function copyPresetWorld(world: WorldDefinition): WorldDefinition {
  // Materials can be reused, but their playthroughs and saves must belong to a new world.
  return { ...world, id: `player_${crypto.randomUUID()}`, createdAt: Date.now(), isPlayerCreated: true };
}

const structuralHash = (draft: CreationDraft) => stableHash({
    form: { ...draft.form, narrativeStyle: '', narrativeStyleCustom: '' },
    brief: draft.brief ? { ...draft.brief, styleChoice: undefined, sourceStyle: undefined, revision: '' } : undefined,
    sourceRevision: draft.reconstruction?.sourceRevision, generationProfile: normalizeGenerationProfile(draft.generationProfile),
    selectedSkills: draft.selectedSkills ?? [], gameplayPlugins: draft.gameplayPlugins ?? [], cards: draft.cards ?? [],
    modelConfigHash: sourceModelConfigHash({ ...loadSettings() }),
  });

const WORLD_SECTIONS: { key: keyof WorldForm; label: string; hint: string; placeholder: string }[] = [
  { key: "name", label: "世界名称", hint: "给你的世界起个名字", placeholder: "如：裂隙之城、浮空群岛、赛博长安..." },
  { key: "overview", label: "世界概述", hint: "核心设定、历史背景、社会结构", placeholder: "描述这个世界的核心设定...\n\n例如：\n一座建在巨大裂隙两侧的城市。裂隙会向凝视它的人展示「可能的未来」——但看到未来的人会逐渐失去改变未来的意愿..." },
  { key: "culture", label: "文化与基调", hint: "风俗、信仰、艺术风格、科技水平、叙事基调", placeholder: "描述这个世界的文化特色..." },
  { key: "regions", label: "区域与场景", hint: "主要区域和标志性地点", placeholder: "列出主要区域和场景...\n\n例如：\n- 上城区：白色大理石建筑，空中廊桥\n- 下城区：铁皮屋、棚户区\n- 裂隙深处：蓝色结晶覆盖一切" },
  { key: "npcs", label: "重要人物", hint: "主要NPC的性格、动机、秘密", placeholder: "描述这个世界的重要人物...\n\n例如：\n- 观测局局长卡兰德：57岁，从未看过裂隙。他知道代价。" },
  { key: "contradictions", label: "核心矛盾", hint: "推动故事的深层冲突", placeholder: "描述核心矛盾...\n\n例如：\n1. 自由意志 vs 宿命认知\n2. 信息正义 vs 公共安全" },
  { key: "history", label: "世界历史", hint: "关键时间节点和重大事件", placeholder: "列出关键历史事件...\n\n例如：\n- 未知：裂隙出现\n- 约500年前：裂隙观测局成立\n- 现在：裂隙开始关闭" },
  { key: "clues", label: "可发现的线索", hint: "散布在世界各处的秘密信息", placeholder: "列出玩家可能发现的线索...\n\n例如：\n- 日晷的偏差：中央广场的日晷影子每天偏转几度" },
  { key: "opening", label: "开场背景", hint: "玩家作为主角的初始情境——你是谁，你在哪，发生了什么", placeholder: "描述游戏的开场情境...\n\n例如：\n我重生了，重生到了高考的前一天。我发现只要我没考上大学，我就会回到这里。这不是科幻——这是我的诅咒。\n\n又例如：\n你是一个被召唤到庄园调查谋杀案的侦探。铁门在你身后关上。你注意到——门没有把手。" },
];

// ============================================================
// 主组件
// ============================================================

export function WorldCreateScreen() {
  const ui = useInterfaceText();
  const addTokenUsage = useGameStore(s => s.addTokenUsage);
  const {
    setPhase, setCurrentWorld, addPlayerWorld, addSandboxWorld,
    createPlaythrough, setCurrentPlaythrough, initWorldLine,
    sandboxMode, sandboxDossierId,
  } = useGameStore();
  const [entering, setEntering] = useState(false);
  const enteringRef = useRef(false);
  const pendingPlaythrough = useRef<{ worldId: string; id: string } | null>(null);
  const enteredWorldRef = useRef<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedWorld, setGeneratedWorld] = useState<WorldDefinition | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("world");
  const [generationProfile, setGenerationProfile] = useState<WorldGenerationProfile>("full");
  const [creationMode, setCreationMode] = useState<CreationMode>("concept");
  const [styleDetailsId, setStyleDetailsId] = useState<NarrativeStylePresetId | null>(null);
  const styleDetails = NARRATIVE_STYLE_PRESETS.find(style => style.id === styleDetailsId);

  // 进度状态
  const [creationComplete, setCreationComplete] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const worldRef = useRef<WorldDefinition | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  // Token 计数、取消控制与计时
  const [estimatedTokens, setEstimatedTokens] = useState<{ prompt: number; completion: number; total: number } | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);

  // 组件卸载时自动发送停止信号，避免浪费 token
  const generationIdRef = useRef<string | null>(null);
  const pipelineAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      const id = generationIdRef.current;
      if (id) {
        fetch("/api/world/create/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generationId: id }),
        }).catch(err => console.warn('[WorldCreateScreen] background task failed:', err?.message || err));
      }
    };
  }, []);

  const [form, setForm] = useState<WorldForm>({
    name: "", overview: "", culture: "", regions: "", npcs: "", contradictions: "", history: "", clues: "", opening: "", narrativeStyle: DEFAULT_NARRATIVE_STYLE_ID, narrativeStyleCustom: "",
  });
  const [creationCards, setCreationCards] = useState<CreationCard[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [gameplayPlugins, setGameplayPlugins] = useState<GameplayPlugin[]>([]);
  const [presetPlugins, setPresetPlugins] = useState<GameplayPlugin[]>([]);
  const availableSkills = [...gameplayCatalog, ...gameplayPlugins];
  const [sourceDraft, setSourceDraft] = useState<SourceDocumentDraft>({
    title: "资料 1",
    content: "",
  });
  const [sourceDocuments, setSourceDocuments] = useState<SourceDocumentDraft[]>([]);
  const [sourceArchiveStatus, setSourceArchiveStatus] = useState<SourceArchiveStatus>("idle");
  const [sourceArchiveError, setSourceArchiveError] = useState<string | null>(null);
  const [sourceCorpus, setSourceCorpus] = useState<SourceCorpus | null>(null);
  const [sourceEvidence, setSourceEvidence] = useState<EvidenceAtom[]>([]);
  const [sourceLedger, setSourceLedger] = useState<CanonLedger | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [brief, setBrief] = useState<WorldCreationBrief>();
  const modeBriefsRef = useRef<Partial<Record<CreationMode, WorldCreationBrief>>>({});
  const [reconstruction, setReconstruction] = useState<SourceReconstructionArchive>();
  const [sourceProgress, setSourceProgress] = useState({ completed: 0, total: 0, message: '' });
  const checkpointIdRef = useRef<string | undefined>(undefined);
  const editBrief = (edit: BriefEdit) => {
    if (formReadOnly || !brief) return;
    const next = applyBriefEdit(brief, edit).brief;
    setBrief(next);
    if (reconstruction) setReconstruction({ ...reconstruction, brief: next });
  };

  const draftKey = `world-creation-draft:${sandboxMode ? sandboxDossierId ?? "sandbox" : "main"}`;
  const presetsRef = useRef<CreationDraft[]>([]);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presets, setPresets] = useState<CreationDraft[]>([]);
  const draftRef = useRef<CreationDraft | null>(null);
  const runningRef = useRef(false);
  const writeQueue = useRef(Promise.resolve());
  const pendingDraftWrite = useRef(false);
  const [materialPreview, setMaterialPreview] = useState<Record<string, string>>({});
  const [hasDraft, setHasDraft] = useState(false);
  const [editingConditions, setEditingConditions] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const formReadOnly = !draftReady || isGenerating || (hasDraft && !editingConditions);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [receivedChars, setReceivedChars] = useState(0);
  const [completedFields, setCompletedFields] = useState<string[]>([]);
  const [currentField, setCurrentField] = useState<string>();
  const [eventCount, setEventCount] = useState(0);
  const persistDraft = useCallback(() => {
    if (!draftRef.current) return Promise.resolve();
    draftRef.current.updatedAt = Date.now();
    const snapshot = structuredClone(draftRef.current);
    pendingDraftWrite.current = false;
    // Serialize writes so a slow earlier chunk cannot overwrite a newer checkpoint.
    writeQueue.current = writeQueue.current.then(async () => {
      await saveToDB(draftKey, snapshot);
      const next = [snapshot, ...presetsRef.current.filter((item) => item.startedAt !== snapshot.startedAt)];
      await saveToDB(`${draftKey}:presets`, next);
      presetsRef.current = next; setPresets(next);
    }).then(() => setStorageError(null)).catch(() => setStorageError("草稿写入失败，请立即导出生成材料，避免关闭页面后丢失。"));
    return writeQueue.current;
  }, [draftKey]);
  useEffect(() => {
    const draft = draftRef.current;
    if (!draft || !draftReady || isGenerating || runningRef.current) return;
    const nextBrief = brief?.origin === (creationMode === 'concept' ? 'concept' : 'source') ? brief : creationMode === 'concept' ? briefFromConcept({ form }) : undefined;
    const inputs = { form, generationProfile, creationMode, selectedSkills, gameplayPlugins, cards: creationCards, sourceDraft, sourceDocuments, brief: nextBrief };
    const previous = Object.fromEntries(Object.keys(inputs).map(key => [key, draft[key as keyof CreationDraft]]));
    if (stableHash(previous) === stableHash(inputs)) return;
    const before = structuralHash(draft);
    Object.assign(draft, structuredClone(inputs), { reconstruction: reconstruction ? { ...reconstruction, entityMap: draft.reconstruction?.entityMap ?? reconstruction.entityMap } : undefined, sourceCorpus, sourceEvidence, sourceLedger });
    draft.status = 'paused';
    if (before !== structuralHash(draft)) {
      draft.world = null; draft.completed = []; draft.conversation = undefined;
      for (const stage of ['world', 'timeline', 'seeds']) {
        if (draft.raw[stage]) draft.raw[ui("{0}（条件修改前 {1}）", {"0": stage, "1": Date.now()})] = draft.raw[stage];
        delete draft.raw[stage];
      }
      worldRef.current = null; setGeneratedWorld(null); setWorldReady(false);
    }
    setCreationComplete(false);
    void persistDraft();
  }, [ui, brief, form, generationProfile, creationMode, selectedSkills, gameplayPlugins, creationCards, sourceDraft, sourceDocuments, reconstruction, sourceCorpus, sourceEvidence, sourceLedger, draftReady, isGenerating, persistDraft]);
  useEffect(() => {
    if (!isGenerating) return;
    const timer = setInterval(() => { if (pendingDraftWrite.current) void persistDraft(); }, 500);
    return () => { clearInterval(timer); if (pendingDraftWrite.current) void persistDraft(); };
  }, [isGenerating, persistDraft]);
  useEffect(() => {
    let active = true;
    Promise.all([loadFromDB(`${draftKey}:presets`), loadFromDB(draftKey)]).then(([list, saved]) => {
      if (!active) return;
      const all = Array.isArray(list) ? list as CreationDraft[] : [];
      const last = saved as CreationDraft | null;
      if (!Array.isArray(list) && last?.form && last.raw) all.unshift(last);
      presetsRef.current = all; setPresets(all);
    }).catch(() => { if (active) setStorageError("无法读取生成预设，请检查浏览器存储是否可用。"); }).finally(() => { if (active) setDraftReady(true); });
    return () => { active = false; pipelineAbortRef.current?.abort(); };
  }, [draftKey]);
  const clearCreationCheckpoint = () => {
    draftRef.current = null; pendingDraftWrite.current = false;
    worldRef.current = null; setGeneratedWorld(null);
    setHasDraft(false); setCreationComplete(false); setWorldReady(false); setMaterialPreview({});
    setSourceCorpus(null); setSourceEvidence([]); setSourceLedger(null); setSourceWarnings([]);
    setBrief(undefined); setReconstruction(undefined); checkpointIdRef.current = undefined;
    setSourceArchiveStatus("idle"); setSourceArchiveError(null);
    setReceivedChars(0); setCompletedFields([]); setCurrentField(undefined); setEventCount(0);
    setLiveMessage(null); setIsThinking(false); setEstimatedTokens(null); setStartTime(null);
  };
  const selectPreset = (saved: CreationDraft) => {
    if (runningRef.current || presetBusy) return;
    const draft = structuredClone(saved);
    try { draft.gameplayPlugins = parseGameplayPlugins(draft.gameplayPlugins); }
    catch (err) { setError(err instanceof Error ? err.message : "玩法插件无效"); return; }
    const inputs = creationInputsFromPreset(draft);
    Object.assign(draft, structuredClone(inputs));
    if (draft.creationMode === 'concept' && !draft.brief) draft.brief = briefFromConcept({ form: inputs.form });
    setCreationCards(inputs.cards ?? []);
    setGenerationProfile(normalizeGenerationProfile(inputs.generationProfile));
    setForm(inputs.form); setCreationMode(inputs.creationMode);
    setExpandedSection(inputs.creationMode === "concept" ? "world" : "source");
    setSelectedSkills(inputs.selectedSkills);
    setGameplayPlugins(inputs.gameplayPlugins ?? []);
    setPresetPlugins(inputs.gameplayPlugins ?? []);
    setSourceDraft(inputs.sourceDraft); setSourceDocuments(inputs.sourceDocuments);
    setError(null);
    if (draft.status === "complete") {
      // Filling conditions starts a new attempt; only resuming a draft may reuse AI output.
      clearCreationCheckpoint(); setBrief(inputs.brief); setEditingConditions(true);
      return;
    }
    if (draft.creationMode === 'source_archive' && !draft.reconstruction) {
      draft.raw = {}; draft.completed = []; draft.world = null; draft.conversation = undefined;
    }
    setBrief(draft.brief); setReconstruction(draft.reconstruction); checkpointIdRef.current = draft.sourceCheckpointId;
    draftRef.current = draft;
    setSourceCorpus(draft.sourceCorpus); setSourceEvidence(draft.sourceEvidence); setSourceLedger(draft.sourceLedger);
    setSourceArchiveStatus(draft.sourceLedger ? "ready" : "idle");
    setSourceArchiveError(null); setError(null); setCreationComplete(false); setWorldReady(false);
    setHasDraft(true); setEditingConditions(false);
    worldRef.current = draft.world; setGeneratedWorld(draft.world);
    setMaterialPreview(draft.raw);
    setReceivedChars(Object.values(draft.raw).reduce((sum, value) => sum + value.length, 0));
  };
  const importDraft = async (file?: File) => {
    if (!file || runningRef.current || presetBusy) return;
    setPresetBusy(true);
    try {
      const data = JSON.parse(await file.text());
      const draft = data.draft as CreationDraft;
      if (data.format !== "eidos_creation_preset_v1" || !draft?.form || !draft.raw || !Array.isArray(draft.completed) || !Array.isArray(draft.sourceDocuments) || !draft.sourceDraft || !["paused", "complete"].includes(draft.status)) throw new Error("不是有效的生成材料文件");
      const requiredText = ["name", "overview", "culture", "regions", "npcs", "contradictions", "history", "clues", "opening", "narrativeStyle"] as const;
      if ((draft.label !== undefined && typeof draft.label !== "string") || requiredText.some((key) => typeof draft.form[key] !== "string") ||
          typeof draft.concept !== "string" || !["concept", "source_archive"].includes(draft.creationMode) ||
          !Array.isArray(draft.selectedSkills) || !draft.selectedSkills.every((skill) => typeof skill === "string") ||
          !Array.isArray(draft.sourceEvidence) || typeof draft.sourceDraft.content !== "string" ||
          draft.sourceDocuments.some((doc) => typeof doc.content !== "string" || typeof doc.title !== "string") ||
          Object.values(draft.raw).some((value) => typeof value !== "string") ||
          draft.completed.some((stage) => ![0, 1, 2, 3].includes(stage)) ||
          (draft.status === "complete" && (!draft.world?.name || !draft.world.regions || !draft.world.npcs || !Array.isArray(draft.world.clues)))) throw new Error("生成材料的内容不完整");
      if (draft.brief) assertWorldBrief(draft.brief);
      if (draft.reconstruction) assertReconstructionArchive(draft.reconstruction);
      draft.conversation = readWorldCreationSession(draft.conversation);
      await restoreWorldCardFiles(data.cardFiles ?? [], { cardBindings: draft.cards });
      await readCreationCards(draft.cards);
      draft.gameplayPlugins = parseGameplayPlugins(draft.gameplayPlugins);
      const availableIds = new Set([...gameplayCatalog, ...draft.gameplayPlugins].map(p => p.id));
      if (draft.selectedSkills.some(id => !availableIds.has(id)) || draft.gameplayPlugins.some(p => gameplayCatalog.some(b => b.id === p.id))) throw new Error("生成材料包含未知或冲突的玩法插件");
      if (data.sourceCheckpoint) {
        const checkpoint = await restoreSourceCheckpoint(data.sourceCheckpoint);
        draft.sourceCheckpointId = checkpoint.id;
      }
      // Imported checkpoints are copies too, including worlds with an unfinished timeline.
      if (draft.world) draft.world = copyPresetWorld(draft.world);
      if (draft.conversation) {
        draft.conversation.worldId = draft.world?.id ?? `player_${crypto.randomUUID()}`;
        // Imported completion markers must pass through the current server checks again.
        if (draft.status === 'paused') { draft.conversation.complete = false; draft.completed = []; }
      }
      draft.startedAt = Date.now();
      while (presetsRef.current.some((preset) => preset.startedAt === draft.startedAt)) draft.startedAt += 1;
      draft.updatedAt = draft.startedAt;
      writeQueue.current = writeQueue.current.then(async () => {
        const next = [draft, ...presetsRef.current];
        await saveToDB(`${draftKey}:presets`, next);
        presetsRef.current = next; setPresets(next);
      });
      await writeQueue.current;
      setError(null);
    } catch (err) { writeQueue.current = Promise.resolve(); setError(err instanceof Error ? err.message : "导入失败"); }
    finally { setPresetBusy(false); }
  };
  const exportPreset = async (draft: CreationDraft | null) => {
    try {
    await saveFile(async () => {
      const cardFiles = await exportWorldCardFiles({ cardBindings: draft?.cards });
      const sourceCheckpoint = draft?.sourceCheckpointId ? await loadSourceCheckpoint(draft.sourceCheckpointId) : null;
      return new Blob([JSON.stringify({ format: "eidos_creation_preset_v1", draft, cardFiles, sourceCheckpoint }, null, 2)], { type: "application/json" });
    }, 'eidos-creation-preset.json');
    } catch (error) { setError(error instanceof Error ? error.message : "生成素材导出失败"); }
  };
  const exportDraft = () => exportPreset(draftRef.current);
  const managePreset = async (id: number, name?: string): Promise<boolean> => {
    if (runningRef.current || presetBusy) return false;
    setPresetBusy(true);
    try {
      writeQueue.current = writeQueue.current.then(async () => {
        const next = name
          ? presetsRef.current.map((preset) => preset.startedAt === id ? { ...preset, label: name } : preset)
          : presetsRef.current.filter((preset) => preset.startedAt !== id);
        // The collection is authoritative; the last-draft checkpoint must not resurrect a deleted preset.
        await saveToDB(`${draftKey}:presets`, next);
        presetsRef.current = next; setPresets(next);
        const last = await loadFromDB(draftKey) as CreationDraft | null;
        if (last?.startedAt === id) await saveToDB(draftKey, name ? { ...last, label: name } : null);
        if (draftRef.current?.startedAt === id) {
          if (name) draftRef.current.label = name;
          else {
            draftRef.current = null; setHasDraft(false); setEditingConditions(true);
            setGeneratedWorld(null); worldRef.current = null;
            setCreationComplete(false); setWorldReady(false); setMaterialPreview({});
          }
        }
      });
      await writeQueue.current;
      setError(null);
      return true;
    } catch (err) {
      writeQueue.current = Promise.resolve();
      setError(err instanceof Error ? err.message : "预设保存失败，请重试");
      return false;
    } finally { setPresetBusy(false); }
  };
  const runCreationStage = async (url: string, payload: Record<string, unknown>, stage: string, signal: AbortSignal) => {
    const draft = draftRef.current!;
    const prefix = draft.raw[stage] ?? "";
    setLiveMessage(null);
    const conversation = stage === 'world' ? draft.conversation ??= createWorldCreationSession({ world: draft.world as unknown as Record<string, unknown> | null, raw: draft.raw }) : undefined;
    let fillTracker = createWorldFillTracker();
    const reflectFill = (fields = Object.keys(draft.conversation?.fields ?? {}), count = Array.isArray(draft.conversation?.fields.timeline) ? draft.conversation.fields.timeline.length : 0) => {
      const observed = fillTracker.snapshot();
      setCompletedFields(previous => {
        const next = [...new Set([...fields, ...observed.completedFields])];
        return next.join('|') === previous.join('|') ? previous : next;
      });
      setCurrentField(observed.currentField);
      setEventCount(observed.hasTimeline ? observed.eventCount : count);
    };
    if (conversation?.pendingText) fillTracker.push(conversation.pendingText);
    if (conversation) { setReceivedChars(prefix.length); setCompletedFields(Object.keys(conversation.fields)); setEventCount(Array.isArray(conversation.fields.timeline) ? conversation.fields.timeline.length : 0); }
    setCurrentField(undefined);
    setIsThinking(false);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, _settings: { ...loadSettings() }, ...(conversation ? { conversation } : { resumeText: prefix }) }), signal });
    if (!response.body && response.ok) return await response.json();
    let result: Record<string, any> | null = null;
    await readCreationEvents(response, async (event) => {
      switch (event.type) {
        case "started": generationIdRef.current = event.generationId; break;
        case "thinking": setIsThinking(true); break;
        case 'checkpoint': {
          const session = readWorldCreationSession(event.conversation);
          if (!session) throw new Error('生成服务未返回有效对话草稿');
          draft.conversation = session;
          draft.raw[stage] = [...session.messages.map(message => `${message.role === 'assistant' ? 'KEI' : '回执'}：\n${message.content}`), session.pendingText].filter(Boolean).join('\n\n');
          if (session.pendingText) { fillTracker = createWorldFillTracker(); fillTracker.push(session.pendingText); }
          reflectFill();
          await persistDraft();
          break;
        }
        case 'reset':
          if (draft.raw[stage]) draft.raw[ui("{0}（修正前 {1}）", {"0": stage, "1": Date.now()})] = draft.raw[stage];
          draft.raw[stage] = typeof event.text === 'string' ? event.text : '';
          fillTracker = createWorldFillTracker();
          setReceivedChars(draft.raw[stage].length); setCompletedFields([]); setCurrentField(undefined); setEventCount(0);
          setLiveMessage(event.reason ?? '正在修正生成材料…'); setIsThinking(false);
          await persistDraft();
          break;
        case "delta":
          draft.raw[stage] = (draft.raw[stage] ?? "") + event.delta;
          if (stage === 'world' && draft.conversation) {
            if (!draft.conversation.pendingText) fillTracker = createWorldFillTracker();
            draft.conversation.pendingText += event.delta;
            fillTracker.push(event.delta); reflectFill(); setLiveMessage(null);
          }
          setReceivedChars(draft.raw[stage].length); setIsThinking(false);
          pendingDraftWrite.current = true;
          break;
        case "progress":
          setIsThinking(false);
          if (Array.isArray(event.fields)) reflectFill(event.fields, event.eventCount);
          if (typeof event.message === 'string') setLiveMessage(event.message);
          if (event.field) {
            setCompletedFields((fields) => fields.includes(event.field) ? fields : [...fields, event.field]);
            if (FIELD_MESSAGES[event.field]) setLiveMessage(FIELD_MESSAGES[event.field]);
          }
          if (typeof event.eventCount === "number" && !Array.isArray(event.fields)) setEventCount(event.eventCount);
          if (Array.isArray(event.fields) && !event.message) setLiveMessage(null);
          break;
        case "usage": addTokenUsage(event.usage, event.usage.worldId ?? null); break;
        case "tokens": setEstimatedTokens({ prompt: event.estimatedPrompt, completion: event.estimatedCompletion, total: event.estimatedTotal }); break;
        case "done": result = event; break;
        case "error": throw new Error(event.message);
      }
    }, { signal });
    await persistDraft();
    if (!result) throw new Error("连接已中断，尚未收到完整结果");
    return result as Record<string, any>;
  };

  const updateForm = <K extends keyof WorldForm>(key: K, value: WorldForm[K]) => {
    if (formReadOnly) return;
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'narrativeStyle' || key === 'narrativeStyleCustom') {
      if (brief) setBrief(applyBriefEdit(brief, { styleChoice: 'preset' }).brief);
    } else if (brief?.origin === 'concept') setBrief(applyBriefEdit(brief, { field: key, text: value as string }).brief);
  };

  const clearSourceArchiveData = () => {
    setReconstruction(undefined); setBrief(current => current?.origin === 'source' ? undefined : current);
    setSourceCorpus(null);
    setSourceEvidence([]);
    setSourceLedger(null);
    setSourceWarnings([]);
  };

  const changeCreationMode = (mode: CreationMode) => {
    if (brief) modeBriefsRef.current[creationMode] = brief;
    setBrief(modeBriefsRef.current[mode] ?? (mode === 'source_archive' ? reconstruction?.brief : undefined));
    setCreationMode(mode);
    setExpandedSection(mode === "source_archive" ? "source" : "world");
    setError(null);
  };

  const sourceInputDocuments = () => {
    const docs = [...sourceDocuments];
    if (sourceDraft.content.trim()) {
      docs.push({
        title: sourceDraft.title.trim() || ui("资料 {0}", {"0": docs.length + 1}),
        content: sourceDraft.content,
      });
    }
    return docs;
  };

  const sourceMaterialLength = sourceInputDocuments()
    .reduce((sum, doc) => sum + doc.content.trim().length, 0);

  const isSourceArchiveBusy =
    sourceArchiveStatus === "extracting" || sourceArchiveStatus === "synthesizing";
  const canGenerateCurrentMode =
    creationMode === "concept" || sourceMaterialLength >= 20 || creationCards.length > 0;

  const currentNarrativeStyle = () =>
    creationMode === "source_archive" && brief?.styleChoice === "source" && brief.sourceStyle ? buildSourceNarrativeStyle(brief.sourceStyle) : buildNarrativeStyleProfile(form.narrativeStyle, form.narrativeStyleCustom ?? "");

  const buildConcept = (): string => {
    const parts: string[] = [];
    if (form.name.trim()) parts.push(`## 世界名称\n${form.name.trim()}`);
    if (form.overview.trim()) parts.push(`## 世界概述\n${form.overview.trim()}`);
    if (form.culture.trim()) parts.push(`## 文化与基调\n${form.culture.trim()}`);
    if (form.regions.trim()) parts.push(`## 区域与场景\n${form.regions.trim()}`);
    if (form.npcs.trim()) parts.push(`## 重要人物\n${form.npcs.trim()}`);
    if (form.contradictions.trim()) parts.push(`## 核心矛盾\n${form.contradictions.trim()}`);
    if (form.history.trim()) parts.push(`## 世界历史\n${form.history.trim()}`);
    if (form.clues.trim()) parts.push(`## 可发现的线索\n${form.clues.trim()}`);
    const narrativeStyle = currentNarrativeStyle();
    parts.push(`## 文风与写法档案\n${formatNarrativeStyleForKei(narrativeStyle)}`);
    if (form.opening.trim()) parts.push(`## 开场背景（玩家初始情境）\n${form.opening.trim()}`);
    // Skill 指南
    const selectedNames = selectedSkills.map(id => availableSkills.find(s => s.id === id)?.name).filter(Boolean);
    if (selectedNames.length > 0) {
      parts.push(`\n## 玩家选择的游戏机制\n玩家已明确选择以下游戏能力：${selectedNames.join(ui("、"))}。请在 gameModeConfig 中实现对应的机制设计。`);
    } else {
      parts.push(`\n## 自动判断游戏机制\n玩家未选择特定游戏能力。请根据玩家的世界概念，自动判断这个世界可能需要哪些游戏机制（循环重生/记忆物品/时间线事件/WorldLine分支），在 gameModeConfig 中主动设计。如果玩家的概念中暗示了循环、侦探、生存、关系等玩法，即使没有明说，也请自动启用对应的机制。不要等玩家来告诉你——你是游戏设计师，你知道一个循环侦探故事需要循环重生和记忆物品。`);
    }
    if (parts.length === 0) return "创造一个独特而有趣的架空世界。";
    return parts.join("\n\n") + "\n\n保留玩家明确条件。如果条件冲突，请明确指出冲突；玩家可以通过行动改变未来。";
  };

  const handleBuildSourceArchive = async () => {
    const saved = draftRef.current;
    const documents = saved ? [...saved.sourceDocuments, ...(saved.sourceDraft.content.trim() ? [saved.sourceDraft] : [])] : sourceInputDocuments();
    const cards = await readCreationCards(saved?.cards ?? creationCards);
    documents.push(...cards.map(({ card, asset }) => creationCardDocument(card, asset)));
    if (documents.reduce((n, d) => n + d.content.trim().length, 0) < 20) throw new Error('资料太短了');
    const corpus = createSourceCorpus(documents);
    const settings = { ...loadSettings() }, modelConfigHash = sourceModelConfigHash(settings);
    const id = saved?.sourceCheckpointId ?? checkpointIdRef.current ?? crypto.randomUUID();
    checkpointIdRef.current = id;
    if (saved) { saved.sourceCheckpointId = id; await persistDraft(); }
    const checkpoint = await loadSourceCheckpoint(id);
    let index = { blocks: indexSources(corpus, { targetTokens: checkpoint?.targetTokens }), revision: sourceRevision(corpus) };
    const signal = pipelineAbortRef.current!.signal;
    setSourceArchiveStatus('extracting'); setSourceArchiveError(null);
    const result = await resumeSourceReconstruction({ id, corpus, modelConfigHash, checkpoint: checkpoint ?? undefined, signal,
      execute: task => executeSourceTask(task, { index, settings, signal, onUsage: usage => addTokenUsage(usage, usage.worldId ?? null) }),
      onProgress: progress => { index = { ...index, blocks: indexSources(corpus, { targetTokens: progress.checkpoint.targetTokens }) }; setSourceProgress(progress); setLiveMessage(progress.message); },
    });
    if (saved?.brief?.origin === 'source') result.brief = restoreSourceBriefChoices(result.brief, saved.brief, result.dossier);
    const reconstruction: SourceReconstructionArchive = { schemaVersion: 2, blockTargetTokens: result.checkpoint.targetTokens, sourceRevision: index.revision, dossier: result.dossier, digests: result.digests, brief: result.brief, entityMap: {}, scope: '全部已选资料' };
    const archive = createReconstructionArchive(corpus, reconstruction);
    setBrief(result.brief); setReconstruction(reconstruction); setSourceCorpus(corpus); setSourceEvidence(archive.evidence); setSourceLedger(archive.ledger);
    setSourceWarnings(result.dossier.issues.map(i => i.message)); setSourceArchiveStatus('ready');
    if (saved) Object.assign(saved, { brief: result.brief, reconstruction, sourceCorpus: corpus, sourceEvidence: archive.evidence, sourceLedger: archive.ledger });
    return archive;
  };

  const handleBuildSourceArchiveClick = async () => {
    if (runningRef.current || presetBusy) return;

    setEditingConditions(false);
    runningRef.current = true; setIsGenerating(true); setError(null);
    setStartTime(Date.now()); pipelineAbortRef.current = new AbortController();
    draftRef.current = { concept: buildConcept(), cards: creationCards, form, generationProfile, creationMode, selectedSkills, gameplayPlugins, sourceDraft, sourceDocuments, sourceCorpus, sourceEvidence, sourceLedger, brief, reconstruction, sourceCheckpointId: checkpointIdRef.current, raw: {}, completed: [], world: null, startedAt: Date.now(), updatedAt: Date.now(), status: "paused" };
    setHasDraft(true);
    try {
      await persistDraft();
      const archive = await handleBuildSourceArchive();
      if (archive) Object.assign(draftRef.current, { sourceCorpus: archive.corpus, sourceEvidence: archive.evidence, sourceLedger: archive.ledger });
      setEditingConditions(true); setExpandedSection("world");
    } catch (err) {
      const message = pipelineAbortRef.current?.signal.aborted ? "资料建档已暂停，可继续生成" : err instanceof Error ? err.message : "资料建档失败";
      setSourceArchiveStatus("error"); setSourceArchiveError(message); setError(message);
    } finally { await persistDraft(); setMaterialPreview({ ...draftRef.current!.raw }); setIsGenerating(false); setIsThinking(false); runningRef.current = false; }
  };



  const handleGenerate = async (resume = false) => {
    if (runningRef.current || presetBusy) return;
    runningRef.current = true;
    const previous = draftRef.current;
    const draft = resume && previous ? previous : {
      concept: buildConcept(), cards: creationCards, form, generationProfile, creationMode, selectedSkills, gameplayPlugins, sourceDraft, sourceDocuments,
      sourceCorpus, sourceEvidence, sourceLedger, brief, reconstruction, sourceCheckpointId: checkpointIdRef.current, raw: {}, completed: [], world: null,
      startedAt: Date.now(), updatedAt: Date.now(), status: "paused",
    } as CreationDraft;
    if (!resume) {
      if (draft.creationMode === 'concept') draft.brief = brief?.origin === 'concept' ? brief : briefFromConcept({ form });
      const structure = structuralHash(draft);
      if (previous?.structuralInputHash === structure && previous.world) {
        draft.world = structuredClone(previous.world); draft.completed = [...previous.completed]; draft.raw = { ...previous.raw };
        draft.conversation = previous.conversation ? structuredClone(previous.conversation) : undefined;
      }
      draft.structuralInputHash = structure;
    }
    draftRef.current = draft;
    setEditingConditions(false);
    setGenerationProfile(normalizeGenerationProfile(draft.generationProfile));
    setForm(draft.form); setSelectedSkills(draft.selectedSkills);
    setGameplayPlugins(draft.gameplayPlugins ?? []);
    setSourceDraft(draft.sourceDraft); setSourceDocuments(draft.sourceDocuments);
    setCreationMode(draft.creationMode);
    setHasDraft(true);
    setIsGenerating(true); setCreationComplete(false); setWorldReady(false); setError(null);
    setStartTime(draft.startedAt);
    setEstimatedTokens(null);
    const ctrl = new AbortController(); pipelineAbortRef.current = ctrl;
    let narrativeStyle = draft.brief?.styleChoice === "source" && draft.brief.sourceStyle ? buildSourceNarrativeStyle(draft.brief.sourceStyle) : buildNarrativeStyleProfile(draft.form.narrativeStyle, draft.form.narrativeStyleCustom);
    try {
      await persistDraft();
      const cardSources = await readCreationCards(draft.cards);
      if (!draft.world || !(draft.conversation?.complete || draft.completed.includes(1))) {
        let result;
        if (draft.creationMode === "source_archive") {
          const archive = draft.sourceCorpus && draft.reconstruction
            ? createReconstructionArchive(draft.sourceCorpus, { ...draft.reconstruction, brief: draft.brief ?? draft.reconstruction.brief })
            : await handleBuildSourceArchive();
          if (!archive) throw new Error('文本梳理尚未完成');
          Object.assign(draft, { sourceCorpus: archive.corpus, sourceEvidence: archive.evidence, sourceLedger: archive.ledger });
          const sourceBrief = draft.brief!;
          narrativeStyle = sourceBrief.styleChoice === 'source' && sourceBrief.sourceStyle ? buildSourceNarrativeStyle(sourceBrief.sourceStyle) : narrativeStyle;
          result = await runCreationStage('/api/world/create/stream', { brief: sourceBrief, sourceDossier: archive.reconstruction!.dossier, skillIds: draft.selectedSkills, gameplayPlugins: draft.gameplayPlugins, narrativeStyle, generationProfile: draft.generationProfile }, 'world', ctrl.signal);
          if (result.world) {
            const mappedArchive = createReconstructionArchive(archive.corpus, archive.reconstruction!, result.world.npcs);
            draft.reconstruction = mappedArchive.reconstruction;
            result.world = { ...result.world, sourceMode: 'source_archive', sourceArchive: mappedArchive };
          }

        } else {
          const concept = [draft.concept, ...cardSources.map(({ card, asset }) => creationCardDocument(card, asset).content)].join("\n\n");
          if (concept.length > 50_000) throw new Error("概念与原卡素材合计超过 50,000 字符，请减少素材或使用资料建档方式");
          result = await runCreationStage("/api/world/create/stream", { concept, brief: draft.brief ?? briefFromConcept({ form: draft.form }), skillIds: draft.selectedSkills, gameplayPlugins: draft.gameplayPlugins, narrativeStyle, generationProfile: draft.generationProfile }, "world", ctrl.signal);
        }
        if (!result.world || !Array.isArray(result.world.timeline) || result.truncated) throw new Error("世界内容尚未完整，已保留对话与草稿，请继续生成");
        draft.world = attachCreationCards({ ...result.world, narrativeStyle, generationProfile: normalizeGenerationProfile(draft.generationProfile) }, cardSources);
        if (draft.conversation) draft.conversation.complete = true;
        if (draft.reconstruction && draft.brief && draft.sourceCorpus) {
          const settings = { ...loadSettings() };
          setLiveMessage('整理原文人物的性格与动机…');
          try {
            const seedResult = await runCreationStage('/api/world/source/seeds', { npcs: draft.world!.npcs, source: { ...draft.reconstruction, digests: [] }, _settings: settings }, 'seeds', ctrl.signal);
            draft.world!.sourceArchive!.uzqSeeds = seedResult.seeds;
          } catch (error) {
            ctrl.signal.throwIfAborted();
            const warning = ui("人物预设初始化暂未完成，游玩时将按世界人物资料建立：{0}", {"0": error instanceof Error ? error.message : '服务不可用'});
            draft.world!.creationWarnings = [...(draft.world!.creationWarnings ?? []), warning];
            setSourceWarnings(warnings => [...warnings, warning]);
          }
        }
        draft.completed = [0];
        await persistDraft();
      }
      ctrl.signal.throwIfAborted();
      const world = draft.world!;
      world.narrativeStyle = narrativeStyle;
      if (world.sourceArchive?.reconstruction && draft.brief) world.sourceArchive.reconstruction.brief = draft.brief;
      worldRef.current = world; setGeneratedWorld(world);
      ctrl.signal.throwIfAborted();
      draft.structuralInputHash = structuralHash(draft);
      draft.status = "complete";
      setGeneratedWorld({ ...world }); setWorldReady(true); setCreationComplete(true);
    } catch (cause) {
      draft.status = "paused";
      if (draft.creationMode === "source_archive") setSourceArchiveStatus(draft.sourceLedger ? "ready" : "error");
      setError(ctrl.signal.aborted ? "已停止。已收到的材料保存在生成草稿中，可继续生成。" : ui("{0}。已收到的材料可继续生成。", {"0": cause instanceof Error ? cause.message : "生成中断"}));
    } finally {
      await persistDraft();
      setMaterialPreview({ ...draft.raw });
      setIsGenerating(false); setIsThinking(false); runningRef.current = false;
      generationIdRef.current = null;
    }
  };

  const restartIncompleteStage = () => {
    const draft = draftRef.current;
    if (!draft || runningRef.current) return;
    const stage = draft.creationMode === "source_archive" && !draft.sourceCorpus ? "evidence"
      : draft.creationMode === "source_archive" && !draft.sourceLedger ? "archive" : "world";
    if (draft.raw[stage]) draft.raw[ui("{0}（重做前 {1}）", {"0": stage, "1": new Date().toISOString()})] = draft.raw[stage];
    if (draft.conversation?.pendingText) {
      draft.conversation.messages.push({ role: 'assistant', content: draft.conversation.pendingText }, { role: 'user', content: '重试上次未完成的操作。片段未执行，保留已提交字段，重新输出完整本轮操作。' });
      draft.conversation.pendingText = '';
    }
    void handleGenerate(true);
  };

  const handleStop = async () => {
    pipelineAbortRef.current?.abort();
    const id = generationIdRef.current;
    if (id) void fetch("/api/world/create/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId: id }) }).catch(() => {});
    await persistDraft();
  };

  const editCreationConditions = () => {
    setEditingConditions(true);
    setCreationComplete(false); setHasDraft(false);
    setError(null);
  };

  const handleEnter = async () => {
    if (!generatedWorld || enteringRef.current) return;
    enteringRef.current = true; setEntering(true); setError(null);
    try {
      if (enteredWorldRef.current !== generatedWorld.id) {
        if (sandboxMode) await addSandboxWorld(generatedWorld, sandboxDossierId);
        else addPlayerWorld(generatedWorld);
        enteredWorldRef.current = generatedWorld.id;
      }
      setCurrentWorld(generatedWorld);
      // 初始化失败时重用已建周目，避免重试留下多个空周目。
      const ptId = pendingPlaythrough.current?.worldId === generatedWorld.id
        ? pendingPlaythrough.current.id
        : await createPlaythrough(generatedWorld.id);
      pendingPlaythrough.current = { worldId: generatedWorld.id, id: ptId };
      setCurrentPlaythrough(ptId);
      await initWorldLine(ptId, generatedWorld.id);
      setPhase("identity");
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建周目失败，请重试");
    } finally { enteringRef.current = false; setEntering(false); }
  };

  if (creationComplete && generatedWorld && !isGenerating) {
    return <CreationResult world={generatedWorld} entering={entering} sandboxMode={sandboxMode}
      storageError={storageError} error={error} onExport={exportDraft}
      onBack={() => setPhase("world_select")} onEdit={editCreationConditions} onEnter={handleEnter} />;
  }

  return (
    <ArchiveScreen className="eidos-world-create" title={ui("创造世界")} navigationPlacement="end" menuSide="right" onBack={() => setPhase('world_select')}
      subtitle={creationMode === "source_archive" ? ui("整理资料，建立可追溯的世界档案") : ui("填写你的想法，KEI 会重新整理成一个自洽的世界")}
      action={
        <div className="flex items-center gap-3">
          {(error || sourceArchiveError) && <span className="text-xs text-[color:var(--eidos-accent)]">{error ?? sourceArchiveError}</span>}
          {generatedWorld && !isGenerating && worldReady && <button className="eidos-world-create__ghost text-xs" onClick={() => setCreationComplete(true)}>{ui("查看已生成世界")}</button>}
          <BackButton onClick={() => setPhase("world_select")} label={ui("返回世界集合")} />
          <button type="button" disabled={formReadOnly} className="eidos-focus eidos-generation-toggle" aria-label={ui("生成规模：{0}", {"0": generationProfile === 'full' ? ui("全量，点击切换为轻量") : ui("轻量，点击切换为全量")})} onClick={() => setGenerationProfile(value => value === 'full' ? 'quick' : 'full')}>
            {generationProfile === 'full' ? ui("全量") : ui("轻量")}
          </button>
          <button onClick={() => void handleGenerate()} disabled={!draftReady || isGenerating || presetBusy || isSourceArchiveBusy || !canGenerateCurrentMode}
            className="eidos-world-create__primary text-xs text-[color:var(--eidos-archive-ink)] bg-emerald-900/40 border border-emerald-500/30 hover:bg-emerald-800/50 px-4 py-1.5 cursor-pointer disabled:opacity-30">
            {isGenerating ? ui("生成中...") : ui("生成")}
          </button>
        </div>
      }>
      <div className="eidos-world-create__layout">
        {/* 左边栏 — 模式切换与当前模式下的分类导航 */}
        <ResponsiveSidebar side="right" label={ui("创建分类")} current={`${creationMode === 'concept' ? ui("概念创建") : ui("资料建档")} · ${CREATION_SECTION_LABELS[expandedSection ?? 'world']}`} className="eidos-world-create__sidebar">
          <div className="eidos-world-create__mode-tabs">
            {([
              ["concept", ui("概念创建"), ui("从一个想法开始")],
              ["source_archive", ui("资料建档"), ui("从文本资料开始")],
            ] as const).map(([mode, label, detail]) => (
              <button
                key={mode}
                disabled={formReadOnly}
                type="button"
                data-sidebar-keep-open
                aria-label={label}
                aria-current={creationMode === mode ? "page" : undefined}
                onClick={() => changeCreationMode(mode)}
                className={`eidos-world-create__mode-tab ${
                  creationMode === mode ? "is-active" : ""
                }`}
              >
                <span>{label}</span>
                <small>{detail}</small>
              </button>
            ))}
          </div>
          <div className="eidos-world-create__sidebar-rule" aria-hidden="true" />
          <nav className="eidos-world-create__sections" aria-label={ui("创建分类")}>
          {(creationMode === "source_archive"
            ? [
                { id: "source", label: ui("资料档案"), filled: sourceInputDocuments().length + (sourceLedger ? 1 : 0), total: Math.max(1, sourceInputDocuments().length + 1) },
                { id: "world", label: ui("世界生成稿"), filled: brief ? 9 : 0, total: 9 },
                { id: "style", label: ui("文风写法"), filled: form.narrativeStyleCustom?.trim() || form.narrativeStyle !== DEFAULT_NARRATIVE_STYLE_ID ? 1 : 0, total: 1 },
                { id: "skills", label: ui("玩法与模组"), filled: selectedSkills.length, total: availableSkills.length },
              ]
            : [
                { id: "world", label: ui("世界信息"), filled: WORLD_SECTIONS.filter(s => (form[s.key] as string)?.trim()).length, total: WORLD_SECTIONS.length },
                { id: "style", label: ui("文风写法"), filled: form.narrativeStyleCustom?.trim() || form.narrativeStyle !== DEFAULT_NARRATIVE_STYLE_ID ? 1 : 0, total: 1 },
                { id: "skills", label: ui("玩法与模组"), filled: selectedSkills.length, total: availableSkills.length },
              ]).concat([{ id: "cards", label: ui("酒馆卡"), filled: creationCards.length, total: creationCards.length }, { id: "presets", label: ui("生成预设"), filled: 0, total: 0 }]).map(cat => (
            <button key={cat.id} aria-current={expandedSection === cat.id ? "page" : undefined} onClick={() => setExpandedSection(cat.id)}
              className={`eidos-world-create__tab w-full text-left text-xs px-2 py-2 transition-colors cursor-pointer flex justify-between ${
                expandedSection === cat.id ? "text-[color:var(--eidos-archive-ink)] bg-[color:var(--eidos-archive-surface)] border-l-2 border-emerald-500/60" : "text-[color:var(--eidos-archive-muted)] hover:text-[color:var(--eidos-archive-ink)]"
              }`}>
              <span>{ui(cat.label)}</span>
              {cat.filled > 0 && <span className="text-[10px] text-[color:var(--eidos-archive-muted)]">{cat.filled}/{cat.total}</span>}
            </button>
          ))}
          </nav>
        </ResponsiveSidebar>

        {/* 中间内容区 */}
        <div className="eidos-world-create__content">
          <div className="max-w-2xl mx-auto space-y-6">


            {expandedSection === "cards" && <CreationCards cards={creationCards} disabled={formReadOnly} onChange={cards => { setCreationCards(cards); clearSourceArchiveData(); setSourceArchiveStatus("idle"); }} />}
            {expandedSection === "presets" && <CreationPresets
              presets={presets.map((preset) => ({ id: preset.startedAt, name: preset.label || preset.form.name || preset.world?.name || "未命名预设", status: preset.status, mode: preset.creationMode }))}
              busy={!draftReady || isGenerating || presetBusy}
              onImport={importDraft}
              onSelect={(id) => { const preset = presets.find((item) => item.startedAt === id); if (preset) selectPreset(preset); }}
              onExport={(id) => exportPreset(presets.find((item) => item.startedAt === id) ?? null)}
              onRename={managePreset}
              onDelete={(id) => managePreset(id)}
            />}

            {creationMode === 'source_archive' && expandedSection === 'source' && <>
              <SourceReconstructionPanel draft={sourceDraft} documents={sourceDocuments} disabled={formReadOnly} busy={isSourceArchiveBusy} progress={sourceProgress}
                onDraft={value => { setSourceDraft(value); clearSourceArchiveData(); }} onDocuments={value => { setSourceDocuments(value); clearSourceArchiveData(); }} onBuild={handleBuildSourceArchiveClick} />
              {sourceArchiveError && <p role="alert">{sourceArchiveError}</p>}
              {sourceWarnings.map((warning, i) => <p key={i}>{warning}</p>)}
            </>}
            {creationMode === 'source_archive' && expandedSection === 'world' && (brief ? <>
              {reconstruction && <label className="block space-y-2 text-sm"><span>{ui("开场位置")}</span><select className="eidos-world-create__input w-full px-3 py-2" aria-label={ui("开场位置")} disabled={formReadOnly} value={brief.startAnchor?.id ?? ''} onChange={event => { const anchor = reconstruction.dossier.starts.find(a => a.id === event.target.value); if (anchor) editBrief({ startAnchor: anchor }); }}>
                {reconstruction.dossier.starts.map(a => <option key={a.id} value={a.id}>{ui(a.label)}</option>)}
              </select></label>}
              <WorldBriefEditor brief={brief} disabled={formReadOnly} onEdit={editBrief} />
            </> : <p>{ui("先梳理文本，即可在这里逐项编辑世界生成稿。")}</p>)}

            {/* 世界信息 — 所有字段纵向排列 */}
            {creationMode === "concept" && expandedSection === "world" && WORLD_SECTIONS.map(s => (
              <div key={s.key} className="space-y-2">
                <div className="eidos-world-create__field-heading flex items-baseline gap-2">
                  <span className="inline-flex items-center gap-1">
                    <label htmlFor={`world-create-${s.key}`} className="text-sm text-[color:var(--eidos-archive-ink)]">{ui(s.label)}</label>
                    <FieldPin label={ui(s.label)} disabled={formReadOnly} pinned={brief?.origin === 'concept' && brief.fields[s.key as keyof typeof brief.fields]?.required || false}
                      onChange={required => { const current = brief?.origin === 'concept' ? brief : briefFromConcept({ form }); setBrief(applyBriefEdit(current, { field: s.key as keyof typeof current.fields, required }).brief); }} />
                  </span>
                  <span className="text-[10px] text-[color:var(--eidos-archive-muted)]">{ui(s.hint)}</span>
                </div>
                {s.key === "name" ? <input id={`world-create-${s.key}`} readOnly={formReadOnly} type="text" value={form.name} onChange={event => updateForm("name", event.target.value)} placeholder={s.placeholder} className="eidos-world-create__input w-full px-4 py-3" /> : <textarea id={`world-create-${s.key}`} readOnly={formReadOnly}
                  value={form[s.key]} onChange={(e) => updateForm(s.key, e.target.value)} placeholder={s.placeholder}
                  rows={s.key === "overview" || s.key === "culture" || s.key === "opening" ? 8 : 4}
                  className="eidos-world-create__input w-full p-4 resize-y" />}


              </div>
            ))}

            {expandedSection === 'style' && brief && <SourceStylePicker brief={brief} candidates={eligibleSourceStyleSamples({ candidates: reconstruction?.dossier.styleCandidates ?? [], styleAnchorId: brief.sourceStyleAnchorId, currentAnchorId: brief.startAnchor?.id })} disabled={formReadOnly} onEdit={editBrief} />}
            {/* 文风写法 */}
            {expandedSection === "style" && (
              <div className="space-y-5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-[color:var(--eidos-archive-ink)]">{ui("文风预设")}</span>
                  <span className="text-[10px] text-[color:var(--eidos-archive-muted)]">{ui("示例只用于理解，不会作为正文模板")}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {NARRATIVE_STYLE_PRESETS.map((style) => {
                    const active = form.narrativeStyle === style.id && !(creationMode === 'source_archive' && brief?.styleChoice === 'source');
                    return <InfoChoice key={style.id} label={ui(style.label)} active={active} disabled={formReadOnly}
                      infoLabel={ui("查看{0}详情", {"0": style.label})} onInfo={() => setStyleDetailsId(style.id)}
                      onSelect={() => updateForm('narrativeStyle', style.id)}>{style.tagline}</InfoChoice>;
                  })}
                </div>
                <div className="space-y-2">
                  <label htmlFor="narrative-style-custom" className="block text-sm text-[color:var(--eidos-archive-ink)]">{ui("自定义文风描述")}</label>
                  <textarea readOnly={formReadOnly}
                    id="narrative-style-custom"
                    value={form.narrativeStyleCustom ?? ""}
                    onChange={(e) => updateForm("narrativeStyleCustom", e.target.value)}
                    placeholder={ui("补充你想要的写法：更口语、更冷峻、更像群像剧、少打斗、多日常...")}
                    rows={5}
                    className="eidos-world-create__input w-full bg-[color:var(--eidos-archive-surface)] border border-[color:var(--eidos-archive-line)] focus:border-emerald-500/40 p-4 text-sm text-[color:var(--eidos-archive-ink)] leading-relaxed resize-y outline-none transition-colors placeholder:text-[color:var(--eidos-archive-muted)]"
                  />
                </div>
              </div>
            )}

            {/* 架构选择 */}
            {expandedSection === "skills" && (
              <div className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-[color:var(--eidos-archive-ink)]">{ui("游戏模式")}</span>
                  <span className="text-[10px] text-[color:var(--eidos-archive-muted)]">{ui("选择后 KEI 会自动设计对应游戏机制，ALICE 按规则运行")}</span>
                </div>
                <GameplayPluginPicker selected={selectedSkills} custom={gameplayPlugins} preset={presetPlugins} disabled={formReadOnly}
                  onSelect={setSelectedSkills} onCustom={setGameplayPlugins}
                  onRemovePreset={content => setPresetPlugins(plugins => plugins.filter(plugin => pluginContentKey(plugin) !== content))} />
              </div>
            )}

            {/* 默认提示 */}
            {!expandedSection && (
              <div className="text-center py-16 text-[color:var(--eidos-archive-muted)]">
                <p className="text-sm">{ui("选择一个分类开始填写")}</p>
                <p className="text-xs mt-1">{ui("或直接点击&ldquo;生成世界&rdquo;，全部交给 KEI")}</p>
              </div>
            )}


          </div>
        </div>
      </div>
      {styleDetails && <InteractionDialog title={ui(styleDetails.label)} onClose={() => setStyleDetailsId(null)} footer={
        <div className="flex justify-end gap-4">
          <button type="button" className="eidos-focus min-h-11 px-2 text-sm" onClick={() => setStyleDetailsId(null)}>{ui("关闭")}</button>
          <button type="button" disabled={formReadOnly} aria-label={ui("选择{0}文风", {"0": styleDetails.label})} className="eidos-focus min-h-11 px-2 text-sm text-[color:var(--eidos-accent)] disabled:opacity-40" onClick={() => { updateForm("narrativeStyle", styleDetails.id); setStyleDetailsId(null); }}>{ui("使用此文风")}</button>
        </div>
      }>
        <p className="text-sm leading-relaxed text-[color:var(--eidos-archive-muted)]">{styleDetails.summary}</p>
        <section className="space-y-2 border-t border-[color:var(--eidos-line)] pt-3">
          <h3 className="text-sm font-medium">{ui("写法特点")}</h3>
          <p className="text-sm leading-relaxed">{styleDetails.aliceGuidance}</p>
        </section>
        <section className="space-y-2 border-t border-[color:var(--eidos-line)] pt-3">
          <h3 className="text-sm font-medium">{ui("示例")}</h3>
          <p className="text-sm leading-7">{styleDetails.example}</p>
          <p className="text-xs text-[color:var(--eidos-archive-muted)]">{ui("示例只用于理解，不会作为正文模板。")}</p>
        </section>

      </InteractionDialog>}
      {(!editingConditions && (isGenerating || hasDraft || storageError)) && <CreationDock>
        {isGenerating && <CreationProgress error={error} liveMessage={liveMessage} isThinking={isThinking} estimatedTokens={estimatedTokens} onStop={handleStop} startTime={startTime} receivedChars={receivedChars} completedFields={completedFields} currentField={currentField} hasGameplay={selectedSkills.length > 0} eventCount={eventCount} />}
        {!isGenerating && <p className="text-sm" role={error ? 'alert' : 'status'}>{error ?? ui("草稿已恢复")}</p>}
        {storageError && <p role="alert" className="mt-2 text-xs text-[color:var(--eidos-accent)]">{storageError}</p>}
        <div className="eidos-creation-actions">
          {!isGenerating && hasDraft && <button aria-label={ui("继续上次生成")} className="eidos-world-create__primary border px-3 py-1.5 text-xs" onClick={() => void handleGenerate(true)}>{ui("继续生成")}</button>}
          {!isGenerating && <button aria-label={ui("修改生成条件")} className="eidos-world-create__ghost px-2 py-1.5 text-xs" onClick={editCreationConditions}>{ui("修改条件")}</button>}
          {!isGenerating && error && <button aria-label={ui("重新尝试（保留已有内容）")} className="eidos-world-create__ghost px-2 py-1.5 text-xs" onClick={restartIncompleteStage}>{ui("重试")}</button>}
          <button aria-label={ui("导出生成材料")} className="eidos-world-create__ghost ml-auto px-2 py-1.5 text-xs" onClick={exportDraft}>{ui("导出")}</button>
          {!isGenerating && <details className="eidos-creation-materials text-xs"><summary className="cursor-pointer py-1.5">{ui("查看材料")}</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all border border-current/20 p-3">{Object.entries(materialPreview).map(([stage, text]) => `【${({ evidence: "资料证据", archive: "世界档案", world: "世界生成对话", timeline: "旧版时间线材料" } as Record<string, string>)[stage] ?? stage}】\n${text}`).join("\n\n") || ui("尚无生成内容")}</pre></details>}
        </div>
      </CreationDock>}
    </ArchiveScreen>
  );
}
