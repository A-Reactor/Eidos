"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EidosButton } from "@/components/ui/EidosScreen";
import { FileImportCard } from '@/components/ui/FileImportCard';
import { getVoiceLibrary, requestForSegment } from "@/lib/game/momoi/runtime";
import { voiceIdentity, type VoiceAsset, type VoiceRequest } from "@/lib/game/momoi/model";
import type { StorySegment } from "@/lib/ai/types";
import { generateVoiceBatch } from "@/lib/game/momoi/generate-batch";
import { isVoiceLanguage, VOICE_LANGUAGES } from '@/lib/game/momoi/languages';
interface Row { id: string; request: VoiceRequest; asset?: VoiceAsset }
export function VoiceResources({ segments }: { segments: StorySegment[] }) {
  const ui = useInterfaceText();
  const assets = useGameStore(s => s.voiceAssets);
  const config = useGameStore(s => s.voiceConfig);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<'all' | 'saved' | 'missing'>('all');
  const [limit, setLimit] = useState(30);
  const audio = useRef<HTMLAudioElement | null>(null);
  const batch = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelled = useRef(false);
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true; batch.current?.abort(); audio.current?.pause(); }; }, []);
  useEffect(() => () => { batch.current?.abort(); }, [config]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const entries = new Map<string, Row>();
      for (const segment of segments) {
        const request = requestForSegment(segment); if (!request) continue;
        const id = await voiceIdentity(request); entries.set(id, { id, request, asset: assets[id] });
      }
      for (const asset of Object.values(assets)) {
        if (entries.has(asset.id)) continue;
        const request = requestForSegment({ type: "dialogue", text: asset.text, speaker: asset.speaker });
        if (request) { request.emotion = asset.emotion; request.config = { ...request.config, material: asset.material ?? 'original', ...(isVoiceLanguage(asset.speechLanguage) ? { translationLanguage: asset.speechLanguage } : {}) }; entries.set(asset.id, { id: asset.id, request, asset }); }
      }
      if (active) setRows([...entries.values()]);
    })().catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; };
  }, [segments, config, assets]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    setBusy(true); setMessage(""); audio.current?.pause();
    const controller = new AbortController(); batch.current = controller;
    try { await action(controller.signal); if (!cancelled.current) setMessage(ui("音频资源已保存")); }
    catch (error) { if (!cancelled.current) setMessage(error instanceof Error ? error.message : ui("操作失败")); }
    finally { if (!cancelled.current) { setBusy(false); setProgress(null); } }
  }
  async function generate(row: Row, signal: AbortSignal) {
    const library = await getVoiceLibrary();
    const next = await library.ensure(row.request, Boolean(row.asset), { priority: "manual", signal });
    if (next.id !== row.id && row.asset) await library.remove(row.id);
  }
  async function upload(row: Row, file: File) {
    const library = await getVoiceLibrary();
    if (file.size > 20 * 1024 * 1024) throw new Error(ui("单段音频不能超过 20 MB"));
    if (!/\.(wav|mp3|ogg|m4a|flac)$/i.test(file.name)) throw new Error(ui("请选择 WAV、MP3、OGG、M4A 或 FLAC 音频"));
    const url = URL.createObjectURL(file);
    try {
      const probe = new Audio(url); probe.preload = "metadata";
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(ui("读取音频超时"))), 10000);
        probe.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        probe.onerror = () => { clearTimeout(timer); reject(new Error(ui("音频无法解码，请换一个文件"))); };
      }).finally(() => { probe.src = ""; });
    } finally { URL.revokeObjectURL(url); }
    const audioBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error(ui("文件读取失败"))); reader.readAsDataURL(file); });
    const extension = file.name.split(".").at(-1)!.toLowerCase();
    const mimeType = ({ wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac" })[extension]!;
    if (cancelled.current) return;
    await library.replace(row.request, { audioBase64, mimeType });
    if (await voiceIdentity(row.request) !== row.id && row.asset) await library.remove(row.id);
  }
  const missing = rows.filter(row => !row.asset);
  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => (filter === 'all' || (filter === 'saved' ? Boolean(row.asset) : !row.asset)) && `${row.request.speaker} ${row.request.text}`.toLocaleLowerCase().includes(search));
  const filters = [{ id: 'all', label: ui("全部"), count: rows.length }, { id: 'saved', label: ui("已保存"), count: rows.length - missing.length }, { id: 'missing', label: ui("待生成"), count: missing.length }] as const;
  return <div className="eidos-voice-resources space-y-4">
    <div className="eidos-audio-sticky eidos-audio-resource-toolbar">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="eidos-audio-filters" role="group" aria-label={ui("音频筛选")}>{filters.map(item => <button key={item.id} type="button" className="eidos-focus" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setLimit(30); }}>{ui(item.label)}<span>{item.count}</span></button>)}</div><div className="flex flex-wrap gap-2"><EidosButton onClick={() => audio.current?.pause()}>{ui("停止试听")}</EidosButton><EidosButton disabled={busy || !missing.length} onClick={() => void run(async signal => {
      setProgress({ done: 0, total: missing.length });
      await generateVoiceBatch(await getVoiceLibrary(), missing.map(row => row.request), { priority: "batch", signal, onProgress: (done, total) => { if (!cancelled.current) setProgress({ done, total }); } });
    })}>{busy ? ui("处理中…") : ui("补齐本组对话")}</EidosButton></div></div>
    {progress && <div className="flex items-center justify-between text-xs"><span role="status">{ui("批量进度 ·")}{progress.done} / {progress.total}</span><EidosButton onClick={() => batch.current?.abort()}>{ui("取消剩余任务")}</EidosButton></div>}
    <input aria-label={ui("搜索对话音频")} className="eidos-settings-control" placeholder={ui("搜索角色或台词")} value={query} onChange={e => { setQuery(e.target.value); setLimit(30); }} />
    </div>
    <p className="eidos-audio-caption">{ui("录音随存档保存；重新生成使用当前模型与音色。")}</p>
    {message && <p role="status" className="text-xs leading-6">{message}</p>}
    {!rows.length && <p className="py-8 text-center text-sm opacity-60">{ui("还没有对话音频。进入一段对话后，可以生成或上传音频。")}</p>}
    {rows.length > 0 && !filtered.length && <p className="eidos-audio-empty">{ui("没有找到匹配的音频。")}</p>}
    {filtered.slice(0, limit).map(row => <article key={row.id} className="eidos-audio-resource">
      <div className="eidos-audio-resource-heading"><strong>{row.request.speaker || ui("未署名角色")}</strong><span className="eidos-audio-badge" data-ready={Boolean(row.asset)}>{row.asset ? row.asset.provider === "uploaded" ? ui("已上传") : ui("已保存") : ui("待生成")}</span></div>
      <p className="eidos-voice-resource-text">{row.request.text}</p>
      {row.asset?.spokenText && <details className="eidos-audio-translation"><summary>{isVoiceLanguage(row.asset.speechLanguage) ? ui(VOICE_LANGUAGES[row.asset.speechLanguage]) : ui("译文")}{ui("朗读")}</summary><p lang={row.asset.speechLanguage}>{row.asset.spokenText}</p></details>}
      <div className="flex flex-wrap gap-2">
        {row.asset && <EidosButton disabled={busy} onClick={() => {
          audio.current?.pause();
          const element = new Audio(`data:${row.asset!.mimeType};base64,${row.asset!.audioBase64}`); audio.current = element;
          element.volume = useGameStore.getState().momoiSettings.volume;
          element.onerror = () => setMessage(ui("音频无法播放，请重新生成或上传替换"));
          void element.play().catch(() => setMessage(ui("播放失败，请重试")));
        }}>{ui("试听")}</EidosButton>}
        <EidosButton disabled={busy} onClick={() => void run(signal => generate(row, signal))}>{row.asset ? ui("重新生成") : ui("生成")}</EidosButton>
        <FileImportCard compact className="eidos-audio-replace" label={ui("替换 {0} 的音频", {"0": row.request.speaker || ui("当前对话")})} inputLabel={ui("上传 {0} 的音频", {"0": row.request.speaker || ui("当前对话")})} heading={ui("上传替换")} description={ui("拖入或选择音频")}
          accept=".wav,.mp3,.ogg,.m4a,.flac" disabled={busy} onFiles={async files => { await run(() => upload(row, files[0])); }} />
        {row.asset && <EidosButton disabled={busy} onClick={() => void run(async () => { await (await getVoiceLibrary()).remove(row.id); })}>{ui("删除")}</EidosButton>}
      </div>
    </article>)}
    {filtered.length > limit && <EidosButton onClick={() => setLimit(limit + 30)}>{ui("显示更多")}</EidosButton>}
  </div>;
}
