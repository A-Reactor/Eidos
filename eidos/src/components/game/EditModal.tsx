"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// Eidos · 创造模式 — 数据编辑弹窗
// ============================================================
// 通用数据编辑浮层，按 category 区分编辑表单。
// 交互：ESC关闭 / 点击遮罩关闭 / dirty 追踪
// ============================================================

import { InteractionDialog } from "@/components/ui/InteractionDialog";
import { useEscapeBack } from '@/components/ui/use-escape-back';
import { useState, useCallback, useEffect, useRef } from "react";
import {
  META_CHANNEL_KINDS,
  META_MANIFEST_TONES,
  createDefaultMetaChannel,
  normalizeMetaChannelManifest,
} from "@/lib/meta-reality/manifest-editor";

export interface EditModalProps {
  category: string;
  title: string;
  data: Record<string, unknown>;
  onSave: (data: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function EditModal({ category, title, data, onSave, onDelete, onClose }: EditModalProps) {
  const ui = useInterfaceText();
  const [formData, setFormData] = useState<Record<string, unknown>>({ ...data });
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const [baseline, setBaseline] = useState(data);
  const [discardOpen, setDiscardOpen] = useState(false);
  const isDirty = JSON.stringify(formData) !== JSON.stringify(baseline);
  const requestClose = useCallback(() => { if (isDirty) setDiscardOpen(true); else onClose(); }, [isDirty, onClose]);

  const update = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = () => {
    onSave(formData);
    setBaseline({ ...formData });
    setSaved(true);
    setTimeout(() => setSaved(false), 1000);
  };

  useEscapeBack(panelRef, requestClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current!;
    panel.focus();
    const trap = (event: KeyboardEvent) => {
      // 嵌套确认框自己管理焦点。
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    panel.addEventListener("keydown", trap);
    return () => { panel.removeEventListener("keydown", trap); previous?.focus(); };
  }, []);

  // 阻止背景滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const renderForm = () => {
    switch (category) {
      case "protagonistState":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("健康状态")}</label>
              <input
                type="text"
                value={(formData.health as string) ?? ""}
                onChange={(e) => update("health", e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("情绪")}</label>
              <input
                type="text"
                value={(formData.mood as string) ?? ""}
                onChange={(e) => update("mood", e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("备注")}</label>
              <textarea
                value={(formData.notes as string) ?? ""}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none"
              />
            </div>
          </div>
        );

      case "inventoryItem":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("名称")}</label>
              <input type="text" value={(formData.name as string) ?? ""} onChange={(e) => update("name", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("描述")}</label>
              <textarea value={(formData.description as string) ?? ""} onChange={(e) => update("description", e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-zinc-400 block mb-1">{ui("数量")}</label>
                <input type="number" value={(formData.quantity as number) ?? 1} onChange={(e) => update("quantity", Number(e.target.value))} min={0} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-zinc-400 block mb-1">{ui("价值")}</label>
                <input type="number" value={(formData.value as number) ?? 0} onChange={(e) => update("value", Number(e.target.value))} min={0} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("类别")}</label>
              <select value={(formData.category as string) ?? "misc"} onChange={(e) => update("category", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500">
                <option value="weapon">{ui("武器")}</option>
                <option value="tool">{ui("工具")}</option>
                <option value="consumable">{ui("消耗品")}</option>
                <option value="key">{ui("关键物品")}</option>
                <option value="document">{ui("文档")}</option>
                <option value="misc">{ui("杂项")}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={!!formData.consumable} onChange={(e) => update("consumable", e.target.checked)} className="accent-amber-500" />
              {ui("消耗品")}</label>
          </div>
        );

      case "npcRelationship":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("好感度 (")}{(formData.affinity as number) ?? 0})</label>
              <input type="range" value={(formData.affinity as number) ?? 0} onChange={(e) => update("affinity", Number(e.target.value))} min={-100} max={100} className="w-full accent-amber-500" />
              <div className="flex justify-between text-[10px] text-zinc-600"><span>-100</span><span>0</span><span>100</span></div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("信任度 (")}{(formData.trust as number) ?? 0})</label>
              <input type="range" value={(formData.trust as number) ?? 0} onChange={(e) => update("trust", Number(e.target.value))} min={0} max={100} className="w-full accent-blue-500" />
              <div className="flex justify-between text-[10px] text-zinc-600"><span>0</span><span>50</span><span>100</span></div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("标签（逗号分隔）")}</label>
              <input type="text" value={((formData.tags as string[]) ?? []).join(", ")} onChange={(e) => update("tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("备注")}</label>
              <textarea value={(formData.notes as string) ?? ""} onChange={(e) => update("notes", e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
          </div>
        );

      case "encyclopediaEntry":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("名称")}</label>
              <input type="text" value={(formData.name as string) ?? ""} onChange={(e) => update("name", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("类型")}</label>
              <select value={(formData.type as string) ?? "other"} onChange={(e) => update("type", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500">
                <option value="npc">{ui("人物")}</option>
                <option value="item">{ui("物品")}</option>
                <option value="location">{ui("地点")}</option>
                <option value="faction">{ui("势力")}</option>
                <option value="concept">{ui("概念")}</option>
                <option value="other">{ui("其他")}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("描述")}</label>
              <textarea value={(formData.description as string) ?? ""} onChange={(e) => update("description", e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("认知内容")}</label>
              <textarea value={(formData.knowledge as string) ?? ""} onChange={(e) => update("knowledge", e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
          </div>
        );

      case "criticalFact":
        return (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">{ui("关键信息")}</label>
            <textarea value={(formData.text as string) ?? ""} onChange={(e) => update("text", e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
          </div>
        );

      case "clue":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("名称")}</label>
              <input type="text" value={(formData.name as string) ?? ""} onChange={(e) => update("name", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("描述")}</label>
              <textarea value={(formData.description as string) ?? ""} onChange={(e) => update("description", e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={!!formData.discovered} onChange={(e) => update("discovered", e.target.checked)} className="accent-amber-500" />
              {ui("已发现")}</label>
          </div>
        );

      case "questEntry":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("标题")}</label>
              <input type="text" value={(formData.title as string) ?? ""} onChange={(e) => update("title", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("描述")}</label>
              <textarea value={(formData.description as string) ?? ""} onChange={(e) => update("description", e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("状态")}</label>
              <select value={(formData.status as string) ?? "active"} onChange={(e) => update("status", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500">
                <option value="active">{ui("进行中")}</option>
                <option value="done">{ui("已完成")}</option>
                <option value="failed">{ui("失败")}</option>
              </select>
            </div>
          </div>
        );



      case "diaryEntry":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("天数")}</label>
              <input type="number" value={(formData.day as number) ?? 0} onChange={(e) => update("day", Number(e.target.value))} min={0} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("摘要")}</label>
              <textarea value={(formData.summary as string) ?? ""} onChange={(e) => update("summary", e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
          </div>
        );

      case "worldFlag":
        return (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">{ui("标志名称")}</label>
            <input type="text" value={(formData.key as string) ?? ""} readOnly className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-500 outline-none" />
            <label className="flex items-center gap-2 text-sm text-zinc-300 mt-3 cursor-pointer">
              <input type="checkbox" checked={!!formData.value} onChange={(e) => update("value", e.target.checked)} className="accent-amber-500" />
              {ui("启用")}</label>
          </div>
        );

      case "npcState":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("NPC 名称")}</label>
              <input type="text" value={(formData.npcName as string) ?? ""} readOnly className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-500 outline-none" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("状态")}</label>
              <input type="text" value={(formData.state as string) ?? ""} onChange={(e) => update("state", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
          </div>
        );

      case "npcBehavior":
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("所在场景")}</label>
              <input type="text" value={(formData.currentScene as string) ?? ""} onChange={(e) => update("currentScene", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("当前活动")}</label>
              <input type="text" value={(formData.currentActivity as string) ?? ""} onChange={(e) => update("currentActivity", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("情绪")}</label>
              <input type="text" value={(formData.currentMood as string) ?? ""} onChange={(e) => update("currentMood", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("互动对象（逗号分隔）")}</label>
              <input type="text" value={((formData.interactingWith as string[]) ?? []).join(", ")} onChange={(e) => update("interactingWith", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
          </div>
        );

      case "npcProfile": {
        const knownDescription = typeof formData.knownDescription === "string"
          ? formData.knownDescription
          : "";
        return (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("NPC 名称")}</label>
              <input type="text" value={(formData.npcName as string) ?? ""} readOnly className="w-full bg-zinc-800/50 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-500 outline-none" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("状态")}</label>
              <input type="text" value={(formData.state as string) ?? ""} onChange={(e) => update("state", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">{ui("所在场景")}</label>
                <input type="text" value={(formData.currentScene as string) ?? ""} onChange={(e) => update("currentScene", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">{ui("情绪")}</label>
                <input type="text" value={(formData.currentMood as string) ?? ""} onChange={(e) => update("currentMood", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("当前活动")}</label>
              <input type="text" value={(formData.currentActivity as string) ?? ""} onChange={(e) => update("currentActivity", e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("互动对象（逗号分隔）")}</label>
              <input type="text" value={((formData.interactingWith as string[]) ?? []).join(", ")} onChange={(e) => update("interactingWith", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">{ui("好感")}</label>
                <input type="number" value={(formData.affinity as number) ?? 0} onChange={(e) => update("affinity", Number(e.target.value))} min={-100} max={100} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">{ui("信任")}</label>
                <input type="number" value={(formData.trust as number) ?? 0} onChange={(e) => update("trust", Number(e.target.value))} min={0} max={100} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("关系标签（逗号分隔）")}</label>
              <input type="text" value={((formData.tags as string[]) ?? []).join(", ")} onChange={(e) => update("tags", e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean))} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">{ui("关系备注")}</label>
              <textarea value={(formData.notes as string) ?? ""} onChange={(e) => update("notes", e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none" />
            </div>
            {knownDescription && (
              <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs leading-5 text-zinc-400">
                {knownDescription}
              </div>
            )}
          </div>
        );
      }

      case "sceneDetailLevel":
        return (
          <div>
            <label className="text-xs text-zinc-400 block mb-1">{ui("场景探索度 (")}{(formData.level as number) ?? 0})</label>
            <input type="range" value={(formData.level as number) ?? 0} onChange={(e) => update("level", Number(e.target.value))} min={0} max={100} className="w-full accent-amber-500" />
            <div className="flex justify-between text-[10px] text-zinc-600"><span>0</span><span>50</span><span>100</span></div>
          </div>
        );

      case "metaChannelManifest": {
        const manifest = normalizeMetaChannelManifest(formData);
        const channels = manifest.channels;
        const updateChannel = (
          index: number,
          key: keyof (typeof channels)[number],
          value: unknown,
        ) => {
          update("channels", channels.map((channel, i) => (
            i === index ? { ...channel, [key]: value } : channel
          )));
        };
        return (
          <div className="space-y-4">
            <div>
              <label htmlFor="meta-manifest-title" className="text-xs text-zinc-400 block mb-1">{ui("通道标题")}</label>
              <input
                id="meta-manifest-title"
                type="text"
                value={manifest.title}
                onChange={(e) => update("title", e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label htmlFor="meta-manifest-tone" className="text-xs text-zinc-400 block mb-1">{ui("叙事语气")}</label>
              <select
                id="meta-manifest-tone"
                value={manifest.tone}
                onChange={(e) => update("tone", e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
              >
                {META_MANIFEST_TONES.map((tone) => (
                  <option key={tone} value={tone}>{tone}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="meta-forbidden-moves" className="text-xs text-zinc-400 block mb-1">{ui("禁用动作")}</label>
              <textarea
                id="meta-forbidden-moves"
                value={manifest.forbiddenMoves.join("\n")}
                onChange={(e) => update("forbiddenMoves", e.target.value.split("\n").map((line) => line.trim()).filter(Boolean))}
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 resize-none"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">{ui("通道列表")}</span>
                <button
                  type="button"
                  onClick={() => update("channels", [...channels, createDefaultMetaChannel(channels.length + 1)])}
                  className="px-2 py-1 text-[11px] text-amber-300 border border-amber-500/30 rounded hover:border-amber-400/60 transition-colors"
                >
                  {ui("添加通道")}</button>
              </div>
              {channels.map((channel, index) => (
                <div key={`${channel.id}_${index}`} className="space-y-2 border border-zinc-800 bg-zinc-900/30 rounded p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`meta-channel-id-${index}`} className="text-[11px] text-zinc-500 block mb-1">ID</label>
                      <input
                        id={`meta-channel-id-${index}`}
                        type="text"
                        value={channel.id}
                        onChange={(e) => updateChannel(index, "id", e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={`meta-channel-kind-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("类型")}</label>
                      <select
                        id={`meta-channel-kind-${index}`}
                        value={channel.kind}
                        onChange={(e) => updateChannel(index, "kind", e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                      >
                        {META_CHANNEL_KINDS.map((kind) => (
                          <option key={kind} value={kind}>{kind}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor={`meta-channel-consumers-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("可读取 AI")}</label>
                    <input
                      id={`meta-channel-consumers-${index}`}
                      type="text"
                      value={channel.allowedConsumers.join(", ")}
                      onChange={(e) => updateChannel(index, "allowedConsumers", e.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div>
                    <label htmlFor={`meta-channel-prompt-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("玩家提示")}</label>
                    <textarea
                      id={`meta-channel-prompt-${index}`}
                      value={channel.promptToPlayer}
                      onChange={(e) => updateChannel(index, "promptToPlayer", e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 resize-none"
                    />
                  </div>
                  <div>
                    <label htmlFor={`meta-channel-interpretation-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("世界解释")}</label>
                    <textarea
                      id={`meta-channel-interpretation-${index}`}
                      value={channel.worldInterpretation}
                      onChange={(e) => updateChannel(index, "worldInterpretation", e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 resize-none"
                    />
                  </div>
                  <div>
                    <label htmlFor={`meta-channel-consequence-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("后果模板")}</label>
                    <textarea
                      id={`meta-channel-consequence-${index}`}
                      value={channel.consequenceTemplate}
                      onChange={(e) => updateChannel(index, "consequenceTemplate", e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 resize-none"
                    />
                  </div>
                  <div>
                    <label htmlFor={`meta-channel-refusal-${index}`} className="text-[11px] text-zinc-500 block mb-1">{ui("拒绝回退")}</label>
                    <textarea
                      id={`meta-channel-refusal-${index}`}
                      value={channel.refusalFallback}
                      onChange={(e) => updateChannel(index, "refusalFallback", e.target.value)}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 resize-none"
                    />
                  </div>
                  {channels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => update("channels", channels.filter((_, i) => i !== index))}
                      className="text-[11px] text-red-400/70 hover:text-red-300 transition-colors"
                    >
                      {ui("删除通道")}</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }

      case "causalProjection":
        return (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">{ui("因果推演数据结构复杂，此处仅展示只读摘要：")}</p>
            <div className="text-xs text-zinc-300 bg-zinc-900/50 border border-zinc-800 rounded p-3 max-h-[200px] overflow-y-auto">
              <div className="mb-2"><span className="text-zinc-500">{ui("触发行动:")}</span>{(formData.actionDescription as string) ?? "—"}</div>
              <div className="mb-2"><span className="text-zinc-500">{ui("涟漪数量:")}</span>{((formData.rippleEffects as unknown[]) ?? []).length}</div>
              {((formData.rippleEffects as Array<Record<string, unknown>>) ?? []).map((r, i) => (
                <div key={i} className="mb-1 pl-2 border-l border-zinc-700">
                  <div className="text-zinc-400">{r.projectedOutcome as string ?? "—"}</div>
                  <div className="text-[10px] text-zinc-600">{ui("状态:")}{r.status as string ?? "pending"} {ui("| 置信度:")}{Math.round(((r.confidence as number) ?? 0) * 100)}%</div>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return (
          <div>
            <p className="text-xs text-zinc-500 mb-2">{ui("此类型暂无专用编辑器，以下为 JSON 只读展示：")}</p>
            <pre className="text-xs text-zinc-300 bg-zinc-900/50 border border-zinc-800 rounded p-3 max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center cursor-default"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
          <button
            onClick={requestClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 overflow-y-auto flex-1">
          {renderForm()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 shrink-0">
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                className="px-3 py-1.5 text-xs text-red-400/70 border border-red-800/30 hover:border-red-600/50 hover:text-red-300 transition-colors cursor-pointer rounded"
              >
                {ui("删除")}</button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestClose}
              className="px-3 py-1.5 text-xs text-zinc-400 border border-zinc-700 hover:border-zinc-500 transition-colors cursor-pointer rounded"
            >
              {ui("取消")}</button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className={`px-3 py-1.5 text-xs border transition-colors cursor-pointer rounded ${
                isDirty
                  ? "text-amber-300 border-amber-500/40 hover:border-amber-400 bg-amber-950/20"
                  : "text-zinc-600 border-zinc-800 cursor-not-allowed"
              }`}
            >
              {saved ? ui("已保存") : ui("保存")}
            </button>
          </div>
        </div>
      </div>
      {discardOpen && <InteractionDialog title={ui("放弃未保存的修改？")} onClose={() => setDiscardOpen(false)}>
        <div className="flex gap-3"><button className="eidos-dossier-action px-4 py-2" onClick={() => setDiscardOpen(false)}>{ui("继续编辑")}</button><button className="eidos-dossier-action px-4 py-2" onClick={onClose}>{ui("放弃更改")}</button></div>
      </InteractionDialog>}
    </div>
  );
}
