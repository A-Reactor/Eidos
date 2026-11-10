"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState, useCallback } from "react";
import { FileImportCard } from '@/components/ui/FileImportCard';
import { useGameStore } from "@/store/game-store";
import type {
  WorldLineExport,
  ReplayMode,
} from "@/lib/game/types";
import { validateExport } from "@/lib/game/worldline-export";

// ============================================================
// ReplayLoadScreen — 加载世界线导出文件并选择重放模式
// ============================================================

export function ReplayLoadScreen() {
  const ui = useInterfaceText();
  const setPhase = useGameStore((s) => s.setPhase);
  const startReplayMode = useGameStore((s) => s.startReplayMode);
  const currentWorld = useGameStore((s) => s.currentWorld);

  const [importData, setImportData] = useState<WorldLineExport | null>(null);
  const [selectedMode, setSelectedMode] = useState<ReplayMode>("no_branch");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ===== File Handling =====

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setLoading(true);

      if (!file.name.endsWith(".json") && !file.name.endsWith(".eidos-worldline")) {
        setError(ui("请选择 .json 或 .eidos-worldline 文件"));
        setLoading(false);
        return;
      }

      try {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(ui("文件读取失败")));
          reader.readAsText(file);
        });
        const data = JSON.parse(text);
        if (!validateExport(data)) {
          setError(ui("文件格式无效：不是有效的世界线导出文件"));
          return;
        }

        // Keep the source world's identity visible when replaying a different archive.
        if (currentWorld && data.world.id !== currentWorld.id) {
          console.warn(
            "[Replay] Importing world line from different world:",
            data.world.name,
            "vs current:",
            currentWorld.name
          );
        }

        setImportData(data);
      } catch (cause) {
        setError(cause instanceof SyntaxError ? ui("文件解析失败：请确保是有效的 JSON 文件") : cause instanceof Error ? cause.message : ui("文件读取失败"));
      } finally { setLoading(false); }
    },
    [ui, currentWorld]
  );

  // ===== Start Replay =====
  const handleStartReplay = () => {
    if (!importData) return;
    startReplayMode(importData, selectedMode);
    setPhase("playing");
  };

  return (
    <div className="eidos-dossier-screen h-full flex flex-col">
      {/* Header */}
      <div className="eidos-dossier-header flex items-center justify-between px-6 py-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[.24em] text-[color:var(--eidos-blue)]">
            E/08 / REPLAY
          </div>
          <h2 className="mt-1 text-2xl font-semibold leading-none tracking-[-.06em] text-[color:var(--eidos-ink)]">
            {ui("重放模式")}</h2>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[.16em] text-black/46">
            {ui("加载世界线导出文件，重温或分叉故事")}</p>
        </div>
        <button
          onClick={() => setPhase("playing")}
          className="eidos-focus eidos-dossier-action px-4 py-2 text-sm"
        >
          {ui("返回游戏")}</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto space-y-6">
          {/* File drop zone */}
          {!importData && (
            <>
              <FileImportCard label={ui("导入世界线重放")} inputLabel={ui("选择世界线文件")} accept=".json,.eidos-worldline" disabled={loading}
                heading={ui("导入世界线")} description={ui("拖入 JSON / EIDOS-WORLDLINE，或点击选择文件")} hint={ui("选择已导出的世界线，重放原文或从中分叉。")}
                onFiles={async files => { await processFile(files[0]); }} />

              {loading && (
                <div className="text-center text-xs text-zinc-500">
                  {ui("正在解析文件...")}</div>
              )}

              {error && (
                <div className="p-4 border border-red-800/40 bg-red-950/10 text-sm text-red-400/80">
                  {error}
                </div>
              )}
            </>
          )}

          {/* Import preview */}
          {importData && (
            <div className="space-y-6">
              {/* File info */}
              <div className="border border-zinc-800 bg-zinc-900/30 p-6 space-y-3">
                <h3 className="text-sm text-white font-medium">
                  {importData.world.name}
                </h3>
                {importData.world.subtitle && (
                  <p className="text-xs text-zinc-500">
                    {importData.world.subtitle}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-zinc-600">{ui("玩家")}</span>
                    <p className="text-zinc-300">
                      {importData.player.name}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-600">{ui("总步数")}</span>
                    <p className="text-zinc-300">
                      {importData.metadata.nodeCount} {ui("步")}</p>
                  </div>
                  <div>
                    <span className="text-zinc-600">{ui("分支数")}</span>
                    <p className="text-zinc-300">
                      {importData.metadata.branchCount} {ui("分支")}</p>
                  </div>
                  <div>
                    <span className="text-zinc-600">{ui("最后游戏时间")}</span>
                    <p className="text-zinc-300">
                      {ui("第")}{importData.metadata.lastGameTime.day} {ui("天")}</p>
                  </div>
                </div>

                <div className="text-xs text-zinc-500">
                  {ui("导出时间:")}{" "}
                  {new Date(importData.exportedAt).toLocaleString("zh-CN")}
                </div>
              </div>

              {/* Mode selection */}
              <div className="space-y-3">
                <h3 className="text-sm text-white font-medium">{ui("选择重放模式")}</h3>

                <label
                  className={`block p-4 border cursor-pointer transition-colors ${
                    selectedMode === "no_branch"
                      ? "border-blue-500/40 bg-blue-950/20"
                      : "border-zinc-800 hover:border-zinc-600 bg-zinc-900/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="replayMode"
                    value="no_branch"
                    checked={selectedMode === "no_branch"}
                    onChange={() => setSelectedMode("no_branch")}
                    className="sr-only"
                  />
                  <div className="text-sm text-white mb-1">
                    {ui("无分支模式 · 纯阅读")}</div>
                  <div className="text-xs text-zinc-500">
                    {ui("AI 全程不调用。使用存档中的对话数据，像阅读小说一样点击推进。 不会产生新的分支。")}</div>
                </label>

                <label
                  className={`block p-4 border cursor-pointer transition-colors ${
                    selectedMode === "branch"
                      ? "border-amber-500/40 bg-amber-950/20"
                      : "border-zinc-800 hover:border-zinc-600 bg-zinc-900/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="replayMode"
                    value="branch"
                    checked={selectedMode === "branch"}
                    onChange={() => setSelectedMode("branch")}
                    className="sr-only"
                  />
                  <div className="text-sm text-white mb-1">
                    {ui("分支模式 · 可随时分叉")}</div>
                  <div className="text-xs text-zinc-500">
                    {ui("先使用存档数据推进。当你输入与存档不同的行动时，AI 正式接管，开启全新的分支推演。")}</div>
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleStartReplay}
                  className="flex-1 py-3 text-sm text-white border border-amber-500/40 bg-amber-950/20 hover:bg-amber-900/30 transition-colors cursor-pointer"
                >
                  {ui("开始重放")}</button>
                <button
                  onClick={() => {
                    setImportData(null);
                    setError(null);
                  }}
                  className="px-6 py-3 text-sm text-zinc-400 border border-zinc-700 hover:border-zinc-500 transition-colors cursor-pointer"
                >
                  {ui("重新选择")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
