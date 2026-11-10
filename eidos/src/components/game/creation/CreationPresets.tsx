"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


import { useState } from "react";
import { CreationImportZone } from "./CreationImportZone";

export interface CreationPresetItem {
  id: number;
  name: string;
  status: "paused" | "complete";
  mode: "concept" | "source_archive";
}

interface Props {
  presets: CreationPresetItem[];
  busy: boolean;
  onImport: (file?: File) => Promise<void>;
  onSelect: (id: number) => void;
  onExport: (id: number) => void;
  onRename: (id: number, name: string) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
}

const action = "eidos-world-create__ghost eidos-focus border px-3 py-2 text-xs disabled:opacity-40";

export function CreationPresets({ presets, busy, onImport, onSelect, onExport, onRename, onDelete }: Props) {
  const ui = useInterfaceText();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const ordered = [...presets].sort((a, b) => b.id - a.id);

  return <section aria-label={ui("生成预设管理")} className="space-y-5">
    <CreationImportZone label={ui("生成预设文件导入区")} inputLabel={ui("导入生成材料")} accept=".json,application/json" disabled={busy}
      heading={ui("导入生成材料")} description={ui("拖放 JSON 文件到此处，或点击选择文件")}
      hint={ui("导入后会加入下方列表，可填充生成条件或恢复未完成的草稿。")}
      onFiles={async (files) => {
        if (!files[0].name.toLowerCase().endsWith(".json")) throw new Error("请选择 JSON 生成材料文件。");
        await onImport(files[0]);
      }} />
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium">{ui("已保存的生成预设")}</h3>
      <span className="text-xs opacity-60">{ui("按创建时间从新到旧 ·")}{ordered.length} {ui("项")}</span>
    </div>
    <p className="text-xs leading-6 opacity-65">{ui("填充预设只复用你填写的条件和导入的原始素材，重新生成世界与身份；恢复草稿会保留生成对话与已有内容，继续完善世界。")}</p>
    {!ordered.length && <p className="py-8 text-sm opacity-60">{ui("暂无生成预设。生成世界后会自动保存在这里，也可以导入生成材料文件。")}</p>}
    <ul className="space-y-4">
      {ordered.map((preset) => <li key={preset.id} className="eidos-world-create__summary border p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h4 className="min-w-0 break-words text-sm font-medium">{preset.name}</h4>
          <span className="text-xs opacity-60">{preset.status === "complete" ? ui("已完成") : ui("未完成")} · {preset.mode === "concept" ? ui("概念创建") : ui("资料建档")}</span>
        </div>
        <time dateTime={new Date(preset.id).toISOString()} className="block text-xs opacity-60">{new Date(preset.id).toLocaleString("zh-CN", { hour12: false })}</time>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className="eidos-world-create__primary eidos-focus border px-3 py-2 text-xs disabled:opacity-40" onClick={() => onSelect(preset.id)} aria-label={`${preset.status === "complete" ? ui("填充预设") : ui("恢复草稿")}：${preset.name}`}>{preset.status === "complete" ? ui("填充预设") : ui("恢复草稿")}</button>
          <button disabled={busy} className={action} onClick={() => onExport(preset.id)} aria-label={ui("导出预设：{0}", {"0": preset.name})}>{ui("导出")}</button>
          <button disabled={busy} className={action} onClick={() => { setEditingId(preset.id); setName(preset.name); setDeletingId(null); }} aria-label={ui("重命名预设：{0}", {"0": preset.name})}>{ui("重命名")}</button>
          <button disabled={busy} className={action} onClick={() => { setDeletingId(preset.id); setEditingId(null); }} aria-label={ui("删除预设：{0}", {"0": preset.name})}>{ui("删除")}</button>
        </div>
        {editingId === preset.id && <form className="flex flex-wrap gap-2" onSubmit={async (event) => { event.preventDefault(); if (name.trim() && await onRename(preset.id, name.trim())) setEditingId(null); }}>
          <input aria-label={ui("预设名称")} className="eidos-world-create__input min-w-0 flex-1 border px-3 py-2 text-sm" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} autoFocus />
          <button className={action} disabled={busy || !name.trim()} type="submit">{ui("保存名称")}</button>
          <button className={action} disabled={busy} type="button" onClick={() => setEditingId(null)}>{ui("取消")}</button>
        </form>}
        {deletingId === preset.id && <div className="space-y-3 border-t border-current/20 pt-3">
          <p className="text-xs">{ui("删除此预设及其生成材料？已加入世界书库的世界不受影响。")}</p>
          <div className="flex gap-2">
            <button className={action} disabled={busy} onClick={async () => { if (await onDelete(preset.id)) setDeletingId(null); }}>{ui("确认删除")}</button>
            <button className={action} disabled={busy} onClick={() => setDeletingId(null)}>{ui("取消")}</button>
          </div>
        </div>}
      </li>)}
    </ul>
  </section>;
}
