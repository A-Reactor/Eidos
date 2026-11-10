"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { buildEntryContext } from '@/lib/game/world-entry';
import { createStreamRequestScope, isCurrentStreamContinuation } from '@/lib/game/stream-lifecycle';
import { archiveScopeSessionValue } from '@/lib/game/archive-scope';
import { worldIdentityOptions } from '@/lib/game/world-identities';
import { BackButton } from "@/components/ui/BackButton";

import { ArchiveScreen } from "@/components/ui/ArchiveScreen";
import { ResponsiveSidebar } from "@/components/ui/ResponsiveSidebar";
import { useState, useEffect, useCallback, useRef } from "react";
import { useGameStore } from "@/store/game-store";
import {
  loadIdentityOptions,
} from "@/store/game-store";
import type { IdentityOption, WorldDefinition } from "@/lib/game/types";

export function IdentitySelect() {
  const ui = useInterfaceText();
  const [options, setOptions] = useState<IdentityOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const confirming = useRef(false);
  const [entering, setEntering] = useState(false);
  const [step, setStep] = useState<"select" | "name">("select");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 自定义身份
  const [customMode, setCustomMode] = useState(false);
  const [customIdentity, setCustomIdentity] = useState("");

  const {
    setPlayerName: savePlayerName,
    setEntryContext,
    setSceneNarrative,
    navigateToScene,
    setPhase,
    addToHistory,
    currentWorld,
    updatePlaythroughMeta,
    setIdentityOptions,
    identityOptions,
    sandboxMode,
    sandboxDossierId,
  } = useGameStore();

  const identityLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentWorld) return;
    const archiveScope = { sandboxMode, sandboxDossierId };
    const key = `${archiveScopeSessionValue(archiveScope)}:${currentWorld.id}`;
    const changedScope = identityLoadedRef.current !== null && identityLoadedRef.current !== key;
    if (changedScope) {
      setSelectedId(null); setPlayerName(''); setStep('select'); setCustomMode(false); setCustomIdentity('');
    }
    identityLoadedRef.current = key;
    // Authored [] is intentional. Neither a cache nor local NPC fallbacks may expand it.
    const local = currentWorld.sourceMode === 'external_cards' || Array.isArray(currentWorld.identityOptions)
      ? worldIdentityOptions(currentWorld)
      : !changedScope && identityOptions.length ? identityOptions
        : loadIdentityOptions(currentWorld.id, archiveScope) ?? worldIdentityOptions(currentWorld);
    setOptions(local);
    if (local !== identityOptions) setIdentityOptions(local);
  }, [currentWorld, identityOptions.length, sandboxDossierId, sandboxMode, setIdentityOptions]);

  const selected = options.find((o) => o.id === selectedId);

  const handleConfirm = useCallback(async () => {
    if (!playerName.trim() || !currentWorld || confirming.current) return;
    if (!(customMode && customIdentity.trim()) && !selected) return;
    confirming.current = true; setEntering(true);
    const chosenName = playerName.trim();
    const startingScene = customMode ? getDefaultStartingScene(currentWorld) : getValidStartingScene(currentWorld, selected!.startingScene);
    const entry = buildEntryContext({ world: currentWorld, playerName: chosenName, startingSceneId: startingScene, option: selected, customIdentity: customMode ? customIdentity : undefined });
    savePlayerName(chosenName); setEntryContext(entry);
    navigateToScene(startingScene); setSceneNarrative(entry.openingNarrative);
    const scope = createStreamRequestScope(useGameStore.getState());
    const sceneName = getSceneNameFromWorld(currentWorld, startingScene);
    addToHistory({
      id: crypto.randomUUID(), timestamp: Date.now(), gameTime: { day: 0, hour: 8, minute: 0 },
      sceneId: startingScene, sceneName, playerInput: ui("成为：{0}", {"0": chosenName}), aiResponse: entry.openingNarrative,
      summary: `${chosenName} 选择身份：${entry.identityDescription}。起点：${sceneName}。${entry.openingNarrative ? ui("该身份开场：{0}", {"0": entry.openingNarrative}) : '尚无预写开场，等待首次观察。'}`,
      timeSpent: { day: 0, hour: 0, minute: 0 }, worldImpacts: [], snapshot: null,
    });
    try {
      try { await updatePlaythroughMeta({ playerName: chosenName, currentSceneName: sceneName, gameTime: { day: 0, hour: 8, minute: 0 }, actionCount: 0 }); }
      catch { /* The identity is established locally; an index failure must not block entry. */ }
      if (mountedRef.current && useGameStore.getState().phase === 'identity' && isCurrentStreamContinuation(scope, useGameStore.getState())) setPhase('playing');
    } finally { confirming.current = false; if (mountedRef.current) setEntering(false); }
  }, [ui, customMode, customIdentity, selected, playerName, currentWorld, savePlayerName, setEntryContext, navigateToScene, setSceneNarrative, addToHistory, updatePlaythroughMeta, setPhase]);

  const stepTitle = step === "name"
      ? "输入你的名字"
      : "选择你的身份";
  const back = () => {
    if (confirming.current) return;
    if (step === 'name') setStep('select');
    else if (customMode) setCustomMode(false);
    else setPhase('world_select');
  };
  const backLabel = step === 'name' ? '返回身份选择' : customMode ? ui("回到预设选项") : ui("返回世界书库");
  const stepCopy = customMode && step === "select"
      ? "描述你想成为什么样的人。身份可以离经叛道，但要给世界一个能回应你的切入点。"
      : step === "select"
        ? "选择一份身份档案，或创建一个不在预设名单里的角色。"
        : "身份已经确定。现在给这个角色一个会被世界记住的名字。";

  return (
    <ArchiveScreen title={stepTitle} subtitle={currentWorld?.name ?? ui("身份选择")} label={ui("身份档案选择")} className="eidos-identity-screen" onBack={back} backLabel={backLabel}
      action={<BackButton onClick={back} label={backLabel} />}>
      <div className="eidos-identity-layout">
        <ResponsiveSidebar className="eidos-identity-index" label={ui("进入世界的步骤")} current={stepTitle}>
          <h2>{ui("以你的视角，进入故事")}</h2><p>{stepCopy}</p>
          <ol aria-label={ui("进入世界的步骤")}>
            <li aria-current={step === 'select' ? 'step' : undefined}><span>1</span>{ui("选择身份")}</li>
            <li aria-current={step === 'name' ? 'step' : undefined}><span>2</span>{ui("角色名字")}</li>
            <li><span>3</span>{ui("开始旅途")}</li>
          </ol>
        </ResponsiveSidebar>
        <main className="eidos-identity-content" aria-label={ui("身份卡片与角色信息")}>

          {customMode && step === "select" && (
            <div className="eidos-identity-form space-y-4 p-5">
              <textarea
                aria-label={ui("自定义身份描述")}
                value={customIdentity}
                onChange={(e) => setCustomIdentity(e.target.value)}
                placeholder={`描述你想成为的身份...

例如：
「我是一个在上城区和下城区之间走私情报的双面间谍」
「我是一只能看到裂隙蓝光的流浪猫，想找到自己的主人」
「我是一个失去了所有记忆的深处归来者」
「我是一个在边缘地带种葡萄的农夫，从不关心裂隙」`}
                className="eidos-identity-field h-44 w-full resize-none p-4 text-sm leading-relaxed text-[color:var(--eidos-archive-ink)] outline-none placeholder:text-[color:var(--eidos-archive-muted)]"
                autoFocus
              />

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => {
                    setCustomMode(false);
                    setCustomIdentity("");
                  }}
                  className="eidos-focus eidos-identity-action"
                >
                  {ui("回到预设选项")}</button>
                <button
                  onClick={() => {
                    if (customIdentity.trim()) setStep("name");
                  }}
                  disabled={!customIdentity.trim()}
                  className="eidos-focus eidos-identity-action is-primary"
                >
                  {ui("确认身份，继续")}</button>
              </div>
            </div>
          )}

          {!customMode && step === "select" && (
            <>
              {options.length === 0 ? (
                <div className="eidos-identity-form border-l-2 border-l-[color:var(--eidos-accent)] p-6">
                  <p className="text-sm text-[color:var(--eidos-archive-muted)]">{ui("这个世界未预设身份")}</p>
                  <p className="mt-2 text-xs text-[color:var(--eidos-archive-muted)]">{ui("请使用下方的“自定义身份”创建你的角色。")}</p>
                  <button
                    onClick={() => { setPlayerName(""); setCustomMode(true); }}
                    className="eidos-focus eidos-identity-action is-primary mt-5"
                  >
                    {ui("创建自定义身份")}</button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {options.map(opt => (
                    <button
                      key={opt.id}
                      aria-label={ui("选择身份：{0}", {"0": opt.name})}
                      onClick={() => {
                        setSelectedId(opt.id);
                        setPlayerName(opt.name);
                        setStep("name");
                      }}
                      className={`eidos-focus eidos-identity-card ${selectedId === opt.id ? "is-selected" : ""}`}
                    >
                      <h3 className="mt-7 text-xl font-black tracking-[.05em] text-[color:var(--eidos-archive-ink)]">
                        {opt.name}
                      </h3>
                      <p className="mt-4 text-sm leading-7 text-[color:var(--eidos-archive-muted)]">
                        {opt.description}
                      </p>
                    </button>
                  ))}

                  <button
                    aria-label={ui("自定义身份")}
                    onClick={() => { setPlayerName(""); setCustomMode(true); }}
                    className="eidos-focus eidos-identity-card eidos-identity-card--custom"
                  >
                    <span className="eidos-identity-card__plus">+</span>
                    <span className="mt-5 block font-mono text-[10px] uppercase tracking-[.24em] text-[color:var(--eidos-accent)]">
                      {ui("由你定义的身份")}</span>
                    <span className="mt-3 block text-lg font-black text-[color:var(--eidos-archive-ink)]">
                      {ui("自定义身份")}</span>
                    <span className="mt-3 block text-sm leading-6 text-[color:var(--eidos-archive-muted)]">
                      {ui("写下你想成为的人，让世界现场回应。")}</span>
                  </button>
                </div>
              )}
            </>
          )}

          {step === "name" && (selected || customIdentity) && (
            <div className="eidos-identity-name-layout grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <div className="eidos-identity-description px-8 py-7">
                <div className="font-mono text-[9px] uppercase tracking-[.26em] text-[color:var(--eidos-accent)]">
                  {ui("已选身份")}</div>
                <h3 className="mt-5 text-2xl font-black tracking-[.04em] text-[color:var(--eidos-ink)]">
                  {customMode
                    ? ui("自定义身份：{0}", {"0": customIdentity})
                    : selected?.name}
                </h3>
                <p className="mt-4 text-sm leading-7 text-[color:var(--eidos-archive-muted)]">
                  {customMode
                    ? ui("在{0}中，以独特的方式开始故事。", {"0": currentWorld?.name ?? ui("这个世界")})
                    : selected?.description}
                </p>
                <div className="mt-5 border-l-4 border-[color:var(--eidos-accent)] bg-black/[.04] p-4 text-sm italic leading-7 text-[color:var(--eidos-archive-muted)]">
                  {customMode
                    ? ui("你将以自己选择的身份进入这个世界。故事的起点取决于你如何定义自己，世界会在你踏出第一步时回应你。")
                    : selected?.openingNarrative ? selected.openingNarrative : ui("开场将从进入世界后的首次观察开始。")}
                </div>
              </div>

              <div className="eidos-identity-form space-y-5 p-5">
                <label className="block font-mono text-[10px] uppercase tracking-[.22em] text-[color:var(--eidos-archive-muted)]">
                  {ui("角色名字")}<input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                    placeholder={ui("输入角色名字...")}
                    className="eidos-identity-field eidos-identity-field--callsign mt-3 h-12 w-full px-4 text-base outline-none"
                    autoFocus
                  />
                </label>

                <div className="grid gap-3">
                  <button
                    onClick={() => {
                      setStep("select");
                      if (customMode) setCustomMode(false);
                    }}
                    className="eidos-focus eidos-identity-action eidos-identity-action--paper"
                  >
                    {ui("重新选择")}</button>
                  <button
                    onClick={handleConfirm}
                    disabled={!playerName.trim() || entering}
                    className="eidos-focus eidos-identity-action is-primary eidos-identity-action--enter"
                  >
                    {ui("进入")}{currentWorld?.name ?? ui("世界")}
                  </button>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </ArchiveScreen>
  );
}

/** 从世界定义中查找场景名称 */
function getSceneNameFromWorld(
  world: WorldDefinition,
  sceneId: string
): string {
  for (const region of Object.values(world.regions ?? {})) {
    const scenes = (region as { scenes?: Record<string, { name: string }> })
      .scenes;
    if (scenes?.[sceneId]) return scenes[sceneId].name;
  }
  return "未知";
}

/** 获取默认起始场景（玩家自定义身份时使用） */
export function getDefaultStartingScene(world?: WorldDefinition | null): string {
  for (const region of Object.values(world?.regions ?? {})) {
    const sceneId = Object.keys(region.scenes ?? {})[0];
    if (sceneId) return sceneId;
  }
  return "lower_entrance";
}

function getValidStartingScene(world: WorldDefinition | null | undefined, sceneId: string): string {
  if (!world) return sceneId || "lower_entrance";
  for (const region of Object.values(world.regions ?? {})) {
    if ((region.scenes ?? {})[sceneId]) return sceneId;
  }
  return getDefaultStartingScene(world);
}
