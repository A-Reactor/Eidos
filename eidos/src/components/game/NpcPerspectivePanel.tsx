"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGameStore } from "@/store/game-store";
import { loadSettings } from "@/lib/game/settings";
import { buildNpcViewModels } from "@/lib/game/npc-view-model";
import type { StorySegment } from "@/lib/ai/types";
import type { NpcBehavior } from "@/lib/game/types";

/** NPC 视角切换响应 */
interface NpcPerspectiveResponse {
  error?: string;
  npcName?: string;
  segments?: StorySegment[];
  availableActions?: string[];
  summary?: string;
  npcBehaviorUpdate?: Partial<NpcBehavior> & { currentScene: string; source: "pov_generated" };
  _tokenUsage?: any;
  _elapsedMs?: number;
}

export function NpcPerspectivePanel({
  onClose,
  initialNpcName,
}: {
  onClose?: () => void;
  initialNpcName?: string | null;
}) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const {
    currentScene,
    currentWorld,
    npcBehaviors,
    npcStates,
    relationships,
    encyclopedia,
    gameTime,
    isLoading: storeLoading,
    setNpcBehavior,
  } = store;

  const [isOpen, setIsOpen] = useState(false);
  const [selectedNpc, setSelectedNpc] = useState<string | null>(initialNpcName ?? null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [npcActions, setNpcActions] = useState<string[]>([]);
  const [isNpcLoading, setIsNpcLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当前场景的 NPC 列表
  const sceneNpcs: string[] = useMemo(() => currentScene?.npcs ?? [], [currentScene]);
  const sceneNpcModels = useMemo(
    () => buildNpcViewModels(sceneNpcs, {
      encyclopedia,
      npcBehaviors,
      npcStates,
      relationships,
    }),
    [sceneNpcs, encyclopedia, npcBehaviors, npcStates, relationships],
  );

  // 关闭面板
  const closePanel = useCallback(() => {
    setIsOpen(false);
    setSelectedNpc(null);
    setSegments([]);
    setNpcActions([]);
    setError(null);
    onClose?.();
  }, [onClose]);

  // 自动触发 POV 切换（当外部传入 initialNpcName 时）
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (initialNpcName && !hasAutoTriggered.current) {
      hasAutoTriggered.current = true;
      switchToNpc(initialNpcName);
    }
    // 重置标记（当 initialNpcName 变化时允许再次触发）
    if (!initialNpcName) {
      hasAutoTriggered.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNpcName]);

  // 切换到 NPC 视角（AI 处理中时禁止切换）
  const switchToNpc = useCallback(async (npcName: string) => {
    if (storeLoading) return;
    setIsOpen(true);          // 立即展开面板，显示加载状态
    setIsNpcLoading(true);
    setError(null);
    setSegments([]);
    setNpcActions([]);
    setSelectedNpc(npcName);

    try {
      const s = useGameStore.getState();
      const snap = s.createSnapshot();

      const res = await fetch("/api/game/npc-perspective", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          npcName,
          snapshot: snap,
          inventory: s.inventory,
          clues: s.clues,
          encyclopedia: s.encyclopedia,
          criticalFacts: s.criticalFacts,
          questLog: s.questLog,
          weather: s.weather,
          recentHistory: s.history.slice(-10).map((h: any) => ({
            playerInput: h.playerInput,
            summary: h.summary,
          })),
          world: s.currentWorld?.isPlayerCreated ? s.currentWorld : null,
          _settings: loadSettings(),
        }),
      });

      const data: NpcPerspectiveResponse = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setSegments(data.segments ?? []);
      setNpcActions(data.availableActions ?? []);

      // 更新 NPC 行为快照
      if (data.npcBehaviorUpdate) {
        setNpcBehavior(npcName, data.npcBehaviorUpdate);
      }
    } catch (err: any) {
      setError(err?.message || "视角切换失败");
    } finally {
      setIsNpcLoading(false);
    }
  }, [storeLoading, setNpcBehavior]);

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏：标题 + 关闭按钮 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-sm text-zinc-400">{ui("NPC 视角")}</span>
        <button
          onClick={closePanel}
          className="text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-0.5 text-xs transition-colors"
        >
          {ui("关闭")}</button>
      </div>
      {/* NPC 列表 */}
      <div className="border-b border-zinc-700 p-3">
        <div className="text-xs text-zinc-500 mb-2">
          {ui("场景 NPC · 点击切换视角")}</div>
        <div className="flex flex-wrap gap-2">
          {sceneNpcModels.map((npc) => {
            const isActive = selectedNpc === npc.name;
            return (
              <button
                key={npc.name}
                onClick={() => switchToNpc(npc.name)}
                disabled={isNpcLoading || storeLoading}
                className={`
                  px-3 py-1.5 rounded text-sm transition-colors text-left
                  ${isActive
                    ? "bg-amber-700 text-amber-100"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }
                  ${(isNpcLoading || storeLoading) && !isActive ? "opacity-50 cursor-not-allowed" : ""}
                `}
              >
                <div className="font-medium">{npc.name}</div>
                {npc.statusLine && (
                  <div className="text-xs opacity-70 mt-0.5 max-w-[200px] truncate">
                    {npc.statusLine}
                  </div>
                )}
                {npc.knownDescription && (
                  <div className="text-[10px] opacity-50 mt-0.5 max-w-[200px] truncate">
                    {npc.knownDescription}
                  </div>
                )}
              </button>
            );
          })}
          {sceneNpcs.length === 0 && (
            <span className="text-zinc-500 text-sm">{ui("此场景没有 NPC")}</span>
          )}
        </div>
      </div>

      {/* NPC 视角叙事 */}
      {isOpen && selectedNpc && (
        <div className="flex-1 overflow-y-auto p-3">
          {/* NPC 头部 */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-amber-400 font-bold text-lg">{selectedNpc}</span>
              <span className="text-zinc-500 text-sm ml-2">{ui("视角")}</span>
            </div>
            <button
              onClick={closePanel}
              className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300"
            >
              {ui("← 回到主角")}</button>
          </div>

          {/* 叙事段落 */}
          <div className="space-y-3">
            {segments.map((seg, i) => (
              <div
                key={i}
                className={`
                  p-3 rounded
                  ${seg.type === "dialogue"
                    ? "bg-zinc-800/50 border-l-2 border-amber-700"
                    : "bg-zinc-900/50"
                  }
                `}
              >
                {seg.type === "dialogue" && seg.speaker && (
                  <div className="text-amber-400 text-xs font-medium mb-1">
                    {seg.speaker}
                  </div>
                )}
                <p className="text-zinc-300 text-sm leading-relaxed">
                  {seg.text}
                </p>
              </div>
            ))}

            {isNpcLoading && !segments.length && (
              <div className="text-zinc-500 text-sm animate-pulse">
                {ui("正在进入")}{selectedNpc}{ui("的视角...")}</div>
            )}

            {error && (
              <div className="text-red-400 text-sm p-2 bg-red-900/20 rounded">
                {error}
              </div>
            )}
          </div>

          {/* NPC 可用行动 */}
          {npcActions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-zinc-700">
              <div className="text-xs text-zinc-500 mb-2">
                {selectedNpc}{ui("可以...")}</div>
              <div className="flex flex-wrap gap-1.5">
                {npcActions.map((action, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 text-xs bg-zinc-800 text-zinc-400 rounded"
                  >
                    {action}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!isOpen && (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
          {ui("选择一个 NPC 以查看其视角")}</div>
      )}
    </div>
  );
}
