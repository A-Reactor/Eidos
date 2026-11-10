"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// NpcInfoBar — 常驻 NPC 信息条
// 显示当前场景所有 NPC 的名称、心情、行为、玩家已知简介和关系状态。
// 点击 NPC 可打开 NpcPerspectivePanel 并自动选中该 NPC。
// ============================================================

import {
  affinityToneClass,
  buildNpcViewModels,
  type NpcViewModel,
} from "@/lib/game/npc-view-model";
import type {
  EncyclopediaEntry,
  NPCRelationship,
  NpcBehavior,
  NpcMemoryState,
} from "@/lib/game/types";

interface NpcInfoBarProps {
  npcIds: string[];
  npcViewModels?: NpcViewModel[];
  npcMemory?: NpcMemoryState;
  encyclopedia?: EncyclopediaEntry[];
  npcBehaviors: Record<string, NpcBehavior>;
  npcStates: Record<string, string>;
  relationships: Record<string, NPCRelationship>;
  isLoading: boolean;
  onSelectNpc?: (npcName: string) => void;
}

/** 心情点颜色 */
function moodDotColor(mood?: string): string {
  switch (mood) {
    case "愤怒": return "bg-red-500";
    case "紧张": case "恐惧": return "bg-amber-500";
    case "愉快": case "兴奋": return "bg-emerald-400";
    case "悲伤": return "bg-blue-400";
    default: return "bg-zinc-500";
  }
}

export function NpcInfoBar({
  npcIds,
  npcViewModels,
  npcMemory,
  encyclopedia = [],
  npcBehaviors,
  npcStates,
  relationships,
  isLoading,
  onSelectNpc,
}: NpcInfoBarProps) {
  const ui = useInterfaceText();
  if (npcIds.length === 0) return null;
  const models = npcViewModels ?? buildNpcViewModels(npcIds, {
    npcMemory,
    encyclopedia,
    npcBehaviors,
    npcStates,
    relationships,
  });

  return (
    <div className="flex items-stretch gap-3 px-4 py-3 border-t border-zinc-800/50 bg-zinc-950/70 shrink-0 overflow-x-auto">
      <div className="flex w-16 shrink-0 flex-col justify-center border-r border-zinc-800/70 pr-3">
        <span className="font-mono text-[9px] uppercase tracking-[.18em] text-zinc-500">SCENE</span>
        <span className="text-[11px] font-semibold text-zinc-300">{ui("NPC 档案")}</span>
      </div>
      {models.map((model) => (
        <NpcDossierCard
          key={model.name}
          model={model}
          isLoading={isLoading}
          onSelectNpc={onSelectNpc}
        />
      ))}
    </div>
  );
}

function NpcDossierCard({
  model,
  isLoading,
  onSelectNpc,
}: {
  model: NpcViewModel;
  isLoading: boolean;
  onSelectNpc?: (npcName: string) => void;
}) {
  const ui = useInterfaceText();
  const relationTone = model.relationship
    ? affinityToneClass(model.relationship.affinity)
    : "text-zinc-400";
  const location = model.currentScene ?? "当前场景";
  const activity = model.activity ?? model.state ?? "观察中";
  const interactingWith = model.interactingWith.length > 0
    ? model.interactingWith.join(ui("、"))
    : "暂无";
  const tags = model.relationship?.tags ?? [];
  const title = model.tooltip || "点击查看详情";
  const className = `group flex min-w-[320px] max-w-[380px] flex-col rounded border px-3 py-2.5 text-left transition-colors shrink-0 ${
    model.hasReacted
      ? "border-purple-500/30 bg-purple-950/20 text-purple-100/90"
      : "border-zinc-800 bg-zinc-950/40 text-zinc-300"
  } ${onSelectNpc ? "cursor-pointer hover:border-zinc-600 hover:bg-zinc-900/55" : ""} ${isLoading ? "opacity-60 cursor-not-allowed" : ""}`;

  const content = (
    <>
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-white">{model.name}</span>
            {model.hasReacted && (
              <span className="rounded border border-purple-400/30 px-1 py-0.5 text-[8px] uppercase tracking-[.12em] text-purple-200">
                {ui("已回应")}</span>
            )}
            {model.mood && (
              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${moodDotColor(model.mood)}`}
                  title={model.mood}
                />
                {model.mood}
              </span>
            )}
          </span>
          {model.knownDescription && (
            <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-400">
              {model.knownDescription}
            </span>
          )}
        </span>
        {model.relationship && model.affinityLabel && (
          <span className={`shrink-0 text-right text-[10px] ${relationTone}`}>
            <span className="block font-semibold">{model.affinityLabel}</span>
            <span className="font-mono text-[9px] text-zinc-500">
              {model.relationship.affinity}/{model.relationship.trust}
            </span>
          </span>
        )}
      </span>

      <span className="mt-2 grid grid-cols-3 gap-1.5">
        <DossierField label={ui("当前位置")} value={location} />
        <DossierField label={ui("当前行动")} value={activity} />
        <DossierField label={ui("互动对象")} value={interactingWith} />
      </span>

      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[.12em] text-zinc-600">{ui("关系温度")}</span>
        {model.relationshipLine ? (
          <span className="text-[10px] text-zinc-400">{model.relationshipLine}</span>
        ) : (
          <span className="text-[10px] text-zinc-600">{ui("未建立")}</span>
        )}
        {tags.map((tag) => (
          <span key={tag} className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[9px] text-zinc-300">
            {tag}
          </span>
        ))}
      </span>

      {model.primaryKnowledge && model.primaryKnowledge !== model.knownDescription && (
        <span className="mt-1.5 border-l border-zinc-700 pl-2 text-[10px] leading-4 text-zinc-500">
          {model.primaryKnowledge}
        </span>
      )}
    </>
  );

  if (onSelectNpc) {
    return (
      <button
        disabled={isLoading}
        onClick={() => onSelectNpc(model.name)}
        className={className}
        title={title}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {content}
    </span>
  );
}

function DossierField({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded border border-zinc-800/80 bg-black/20 px-2 py-1">
      <span className="block font-mono text-[8px] uppercase tracking-[.12em] text-zinc-600">{label}</span>
      <span className="mt-0.5 block truncate text-[10px] leading-3 text-zinc-300" title={value}>
        {value}
      </span>
    </span>
  );
}
