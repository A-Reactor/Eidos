"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";

import { useRef, useState } from 'react';
import { InteractionDialog } from '@/components/ui/InteractionDialog';
import { parseCardBytes } from '@/lib/game/cards/parser';
import { cardCompatibility, cardEntries } from '@/lib/game/cards/entries';
import { cardText, MAX_CARD_FILE_BYTES, type CardRole, type ParsedCard } from '@/lib/game/cards/types';
import type { WorldDefinition } from '@/lib/game/types';
import { cardInitialization } from '@/lib/game/cards/initialization';
import { CardVariableChoices } from './CardVariableChoices';
import { FileImportCard } from '@/components/ui/FileImportCard';

export interface CardMountRequest { bytes: Uint8Array; filename: string; role: CardRole; worldId?: string; saveOnly?: boolean; publicVariables?: string[] }
function useCardImport(onMount: (request: CardMountRequest) => Promise<void>) {
  const ui = useInterfaceText();
  const [source, setSource] = useState<{ parsed: ParsedCard; bytes: Uint8Array; filename: string } | null>(null);
  const [role, setRole] = useState<CardRole>('character');
  const [worldId, setWorldId] = useState('');
  const [publicVariables, setPublicVariables] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const sequence = useRef(0);
  const lock = useRef(false);
  const compatibility = source ? cardCompatibility(source.parsed) : null;
  const readFile = async (file?: File) => {
    const token = ++sequence.current; setSource(null); setError(''); setSaved(false);
    if (!file) return;
    try {
      if (file.size > MAX_CARD_FILE_BYTES) throw new Error(ui("卡片文件超过 20 MiB"));
      const bytes = new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error(ui("文件读取失败"))); reader.readAsArrayBuffer(file);
      }));
      const parsed = parseCardBytes(bytes, file.name);
      if (token !== sequence.current) return;
      setSource({ parsed, bytes, filename: file.name });
      const initial = cardCompatibility(parsed).blocked.length ? undefined : cardInitialization(parsed);
      setPublicVariables(initial?.publicVariables ?? []);
      setRole(parsed.kind === 'worldbook' ? 'world' : 'character');
    } catch (error) { if (token === sequence.current) setError(error instanceof Error ? error.message : ui("原卡读取失败")); }
  };
  const mount = async (saveOnly = false) => {
    if (!source || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await onMount({ bytes: source.bytes, filename: source.filename, role, worldId: worldId || undefined, saveOnly, publicVariables }); setSaved(true); }
    catch (error) { setError(error instanceof Error ? error.message : ui("保存失败")); }
    finally { lock.current = false; setBusy(false); }
  };
  return { source, role, setRole, worldId, setWorldId, publicVariables, setPublicVariables, error, busy, saved, compatibility, readFile, mount };
}

function CardSourcePreview({ parsed }: { parsed: ParsedCard }) {
  const ui = useInterfaceText();
  return <details><summary className="cursor-pointer text-sm">{ui("查看原文")}</summary><div aria-label={ui("原文预览")} className="mt-3 max-h-72 space-y-4 overflow-auto">
    {['description', 'personality', 'scenario', 'system_prompt', 'first_mes', 'mes_example'].filter(key => cardText(parsed.data[key])).map(key => <div key={key}><p className="text-xs text-zinc-400">{key}</p><pre className="whitespace-pre-wrap break-words text-xs">{cardText(parsed.data[key])}</pre></div>)}
    {cardEntries(parsed).slice(0, 24).map(e => <div key={e.pointer}><p className="text-xs text-zinc-400">{e.pointer}</p><pre className="whitespace-pre-wrap break-words text-xs">{e.text}</pre></div>)}
  </div></details>;
}

export function CardImportDialog({ worlds, onMount, onClose }: {
  worlds: WorldDefinition[]; onMount: (request: CardMountRequest) => Promise<void>; onClose: () => void;
}) {
  const ui = useInterfaceText();
  const { source, role, setRole, worldId, setWorldId, publicVariables, setPublicVariables, error, busy, saved, compatibility, readFile, mount } = useCardImport(onMount);
  return <InteractionDialog title={ui("导入酒馆原卡")} onClose={() => { if (!busy) onClose(); }} className="max-h-[90dvh] overflow-y-auto">
    <p className="text-sm text-zinc-400">{ui("保留原文件和正文，以常驻规则与关键词取用内容。无需 AI 转卡。")}</p>
    <FileImportCard label={ui("导入酒馆卡文件")} inputLabel={ui("选择原卡文件")} heading={ui("导入酒馆原卡")} description={ui("拖入 JSON / PNG，或点击选择文件")} hint={ui("人物卡、世界书或玩家身份卡 · 最大 20 MiB")}
      accept=".json,.png,application/json,image/png" disabled={busy} onFiles={async files => { await readFile(files[0]); }} />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {saved && <p role="status" className="text-sm text-emerald-300">{ui("原卡已保存")}{!compatibility?.blocked.length ? ui("，世界已加入书库") : ''}。</p>}
    {source && <>
      <h3 className="text-lg">{source.parsed.name}</h3>
      <p className="text-xs text-zinc-400">{source.filename} · {cardEntries(source.parsed).length} {ui("个世界书条目")}</p>
      <label className="block text-sm">{ui("挂载用途")}<select aria-label={ui("挂载用途")} className="eidos-field mt-1 block w-full p-2" value={role} disabled={busy || source.parsed.kind === 'worldbook'} onChange={e => setRole(e.target.value as CardRole)}><option value="character">{ui("人物")}</option><option value="world">{ui("世界／叙事者")}</option><option value="persona">{ui("玩家身份")}</option></select></label>
      <label className="block text-sm">{ui("目标世界")}<select aria-label={ui("目标世界")} className="eidos-field mt-1 block w-full p-2" value={worldId} disabled={busy} onChange={e => setWorldId(e.target.value)}><option value="">{ui("创建卡片世界")}</option>{worlds.map(w => <option key={w.id} value={w.id} disabled={(w.cardBindings?.length ?? 0) >= 16}>{w.name}（{(w.cardBindings?.length ?? 0) >= 16 ? ui("已达 16 张上限") : ui("建立副本")}）</option>)}</select></label>
      {compatibility && <div className="space-y-2 text-xs leading-5 text-amber-200" aria-label={ui("兼容范围")}>
        {compatibility.blocked.map(reason => <p key={reason}>{reason}{ui("，当前只能保存原卡。")}</p>)}
        {compatibility.warnings.map(reason => <p key={reason}>{reason}</p>)}
      </div>}
      <CardSourcePreview parsed={source.parsed} />
      <CardVariableChoices card={source.parsed} selected={publicVariables} onChange={setPublicVariables} disabled={busy} />
      <div className="flex flex-wrap gap-3"><button className="eidos-focus border px-3 py-2 text-sm disabled:opacity-40" disabled={busy || !!compatibility?.blocked.length} onClick={() => void mount()}>{ui("保存并创建卡片世界")}</button>
        {!!compatibility?.blocked.length && <button className="eidos-focus border px-3 py-2 text-sm" disabled={busy} onClick={() => void mount(true)}>{ui("仅保存原卡")}</button>}
        <button className="eidos-focus px-3 py-2 text-sm" disabled={busy} onClick={onClose}>{ui("关闭")}</button>
      </div>
    </>}
  </InteractionDialog>;
}
