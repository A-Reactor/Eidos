"use client";
import { useInterfaceText } from "@/components/shell/useInterfaceText";


// ============================================================
// Eidos · 创造模式 — 世界信息调整面板
// ============================================================
// 创造模式时在 GameScreen 右侧显示，按分类浏览/编辑世界数据。
// 主面板只显示条目名称，点击弹出 EditModal 编辑。
// ============================================================

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { EditModal } from "./EditModal";
import type { EncyclopediaEntry, InventoryItem, QuestEntry, DiaryEntry, Clue, NpcBehavior, NPCRelationship } from "@/lib/game/types";
import type { MetaChannelManifest } from "@/lib/meta-reality/types";
import { buildNpcViewModels } from "@/lib/game/npc-view-model";
import {
  createDefaultMetaChannelManifest,
  normalizeMetaChannelManifest,
} from "@/lib/meta-reality/manifest-editor";

// ============================================================
// 分类配置
// ============================================================

interface CategoryDef {
  id: string;
  label: string;
  /** 从 store 获取条目列表 */
  getItems: (s: ReturnType<typeof useGameStore.getState>) => ItemDef[];
}

interface ItemDef {
  /** 唯一 ID（用于编辑回写） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 副标签（如类型、数量等） */
  subtitle?: string;
  /** 完整数据（传给 EditModal） */
  data: Record<string, unknown>;
  /** EditModal 的 category */
  category: string;
  /** 保存回调 */
  onSave: (s: ReturnType<typeof useGameStore.getState>, data: Record<string, unknown>) => void;
  /** 删除回调（可选） */
  onDelete?: (s: ReturnType<typeof useGameStore.getState>) => void;
}

// ============================================================
// 类别定义
// ============================================================

interface CategoryGroup {
  name: string;
  children: CategoryDef[];
}

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    name: "玩家",
    children: [
      {
        id: "protagonist",
        label: "主角状态",
        getItems: (s) => [{
          id: "protagonist",
          name: `健康: ${s.protagonistState?.health ?? "良好"} / 情绪: ${s.protagonistState?.mood ?? "平静"}`,
          data: { ...s.protagonistState } as Record<string, unknown>,
          category: "protagonistState",
          onSave: (_s, d) => s.setProtagonistState?.(d as any),
        }],
      },
      {
        id: "inventory",
        label: "背包",
        getItems: (s) => (s.inventory as InventoryItem[]).map((item) => ({
          id: item.id,
          name: item.name,
          subtitle: `x${item.quantity} · ${item.category}`,
          data: { ...item } as Record<string, unknown>,
          category: "inventoryItem",
          onSave: (_s, d) => s.setInventoryItem?.(item.id, d as Partial<InventoryItem>),
        })),
      },
      {
        id: "relationships",
        label: "NPC关系",
        getItems: (s) => Object.entries(s.relationships as Record<string, { npcName: string; affinity: number; trust: number; tags: string[]; notes: string }>).map(([name, rel]) => ({
          id: name,
          name: name,
          subtitle: `好感 ${rel.affinity} / 信任 ${rel.trust}${rel.tags?.length ? ` · ${rel.tags.join(", ")}` : ""}`,
          data: { ...rel } as Record<string, unknown>,
          category: "npcRelationship",
          onSave: (_s, d) => s.setRelationship?.(name, d as any),
        })),
      },
    ],
  },
  {
    name: "知识",
    children: [
      {
        id: "encyclopedia",
        label: "百科",
        getItems: (s) => (s.encyclopedia as EncyclopediaEntry[]).filter((e) => e.type !== "npc").map((e) => ({
          id: e.id,
          name: e.name,
          subtitle: formatEncycType(e.type),
          data: {
            ...e,
            knowledge: Array.isArray(e.knowledge)
              ? e.knowledge.map((k: any) => (typeof k === "string" ? k : k.text)).join("\n")
              : (e.knowledge ?? ""),
          } as Record<string, unknown>,
          category: "encyclopediaEntry",
          onSave: (_s, d) => {
            const entry = { ...d } as any;
            // knowledge 可能是多行字符串 → 转回 KnowledgeItem[]
            if (typeof entry.knowledge === "string") {
              const now = s.gameTime;
              entry.knowledge = entry.knowledge
                .split("\n")
                .filter((k: string) => k.trim())
                .map((text: string) => ({
                  text,
                  source: "player" as const,
                  addedAt: { ...now },
                  importance: 50,
                }));
            }
            s.setEncyclopediaEntry?.(e.id, entry);
          },
          onDelete: (_s) => s.deleteEncyclopediaEntry?.(e.id),
        })),
      },
      {
        id: "criticalFacts",
        label: "关键信息",
        getItems: (s) => (s.criticalFacts as Array<{ text: string }>).map((fact, i) => ({
          id: `cf_${i}`,
          name: fact.text.length > 40 ? fact.text.slice(0, 40) + "..." : fact.text,
          data: { text: fact.text },
          category: "criticalFact",
          onSave: (_s, d) => {
            if (d.text && typeof d.text === "string" && d.text.trim()) {
              s.addCriticalFact?.(d.text.trim());
              s.removeCriticalFact?.(i);
            }
          },
          onDelete: (_s) => s.removeCriticalFact?.(i),
        })),
      },
      {
        id: "clues",
        label: "线索",
        getItems: (s) => (s.clues as Clue[]).map((c) => ({
          id: c.id,
          name: c.name,
          subtitle: c.discovered ? "已发现" : "未发现",
          data: { ...c } as Record<string, unknown>,
          category: "clue",
          onSave: (_s, d) => s.setClue?.(c.id, d as any),
        })),
      },
      {
        id: "diary",
        label: "日记",
        getItems: (s) => (s.diary as DiaryEntry[]).map((d) => ({
          id: `day_${d.day}`,
          name: `第${d.day}天`,
          subtitle: d.summary?.length > 25 ? d.summary.slice(0, 25) + "..." : (d.summary ?? ""),
          data: { ...d } as Record<string, unknown>,
          category: "diaryEntry",
          onSave: (_s, data) => s.setDiaryEntry?.(d.day, data as Partial<DiaryEntry>),
        })),
      },
    ],
  },
  {
    name: "世界",
    children: [
      {
        id: "worldFlags",
        label: "世界标志",
        getItems: (s) => Object.entries(s.worldFlags as Record<string, boolean>).map(([key, value]) => ({
          id: key,
          name: key,
          subtitle: value ? "启用" : "关闭",
          data: { key, value },
          category: "worldFlag",
          onSave: (_s, d) => s.setWorldFlag?.(d.key as string, !!d.value),
          onDelete: (_s) => s.deleteWorldFlag?.(key),
        })),
      },
      {
        id: "npcProfiles",
        label: "NPC信息",
        getItems: (s) => {
          const names = new Set<string>([
            ...Object.keys((s.currentWorld?.npcs ?? {}) as Record<string, unknown>),
            ...Object.keys((s.npcStates ?? {}) as Record<string, string>),
            ...Object.keys((s.npcBehaviors ?? {}) as Record<string, NpcBehavior>),
            ...Object.keys((s.relationships ?? {}) as Record<string, unknown>),
          ]);
          return buildNpcViewModels([...names], {
            encyclopedia: s.encyclopedia as EncyclopediaEntry[],
            npcStates: s.npcStates as Record<string, string>,
            npcBehaviors: s.npcBehaviors as Record<string, NpcBehavior>,
            relationships: s.relationships as Record<string, NPCRelationship>,
          }).map((npc) => {
            const behavior = (s.npcBehaviors as Record<string, NpcBehavior>)[npc.name];
            const relationship = (s.relationships as Record<string, NPCRelationship>)[npc.name];
            return {
              id: npc.name,
              name: npc.name,
              subtitle: npc.statusLine,
              data: {
                npcName: npc.name,
                state: npc.state ?? "",
                currentScene: behavior?.currentScene ?? s.currentSceneId ?? "",
                currentActivity: behavior?.currentActivity ?? "",
                currentMood: behavior?.currentMood ?? "",
                interactingWith: behavior?.interactingWith ?? [],
                affinity: relationship?.affinity ?? 0,
                trust: relationship?.trust ?? 0,
                tags: relationship?.tags ?? [],
                notes: relationship?.notes ?? "",
                knownDescription: npc.knownDescription ?? "",
                primaryKnowledge: npc.primaryKnowledge ?? "",
              },
              category: "npcProfile",
              onSave: (_s, d) => {
                const npcName = d.npcName as string;
                const state = typeof d.state === "string" ? d.state.trim() : "";
                if (state) s.setNpcStateDirect?.(npcName, state);
                s.setNpcBehaviorDirect?.(npcName, {
                  currentScene: String(d.currentScene || s.currentSceneId || ""),
                  currentActivity: String(d.currentActivity || ""),
                  currentMood: String(d.currentMood || "平静"),
                  interactingWith: Array.isArray(d.interactingWith) ? d.interactingWith as string[] : [],
                  lastObserved: behavior?.lastObserved ?? s.gameTime,
                  source: behavior?.source ?? "kei_update",
                });
                const affinity = Number(d.affinity ?? 0);
                const trust = Number(d.trust ?? 0);
                const tags = Array.isArray(d.tags) ? d.tags as string[] : [];
                if (relationship) {
                  s.setRelationship?.(npcName, { affinity, trust, tags, notes: String(d.notes ?? "") });
                } else {
                  s.updateRelationship?.({ npcName, affinityDelta: affinity, trustDelta: trust, addTags: tags });
                  s.setRelationship?.(npcName, { notes: String(d.notes ?? "") });
                }
              },
            } satisfies ItemDef;
          });
        },
      },
      {
        id: "sceneDetails",
        label: "场景探索",
        getItems: (s) => Object.entries(s.sceneDetailLevels as Record<string, number>).map(([sceneId, level]) => ({
          id: sceneId,
          name: sceneId,
          subtitle: `探索度 ${level}%`,
          data: { sceneId, level },
          category: "sceneDetailLevel",
          onSave: (_s, d) => s.setSceneDetailLevel?.(d.sceneId as string, d.level as number),
        })),
      },
      {
        id: "metaChannels",
        label: "边界通道",
        getItems: (s) => {
          if (!s.currentWorld) return [];
          const activeManifest = (s.metaChannelManifest ?? s.currentWorld.metaChannelManifest ?? null) as MetaChannelManifest | null;
          const manifest = activeManifest ?? createDefaultMetaChannelManifest({
            worldName: s.currentWorld.name,
          });
          return [{
            id: manifest.id || "meta_manifest",
            name: activeManifest ? manifest.title : "未配置边界通道",
            subtitle: activeManifest
              ? `${manifest.channels.length} 个通道 · ${manifest.tone}`
              : "创建现实边界规则",
            data: { ...manifest } as unknown as Record<string, unknown>,
            category: "metaChannelManifest",
            onSave: (state, data) => {
              state.applyMetaChannelManifestToCurrentWorld?.(
                normalizeMetaChannelManifest(data, { worldName: state.currentWorld?.name }),
              );
            },
          } satisfies ItemDef];
        },
      },
    ],
  },
  {
    name: "剧情",
    children: [
      {
        id: "quests",
        label: "任务",
        getItems: (s) => (s.questLog as QuestEntry[]).map((q) => ({
          id: q.id,
          name: q.title,
          subtitle: formatQuestStatus(q.status),
          data: { ...q } as Record<string, unknown>,
          category: "questEntry",
          onSave: (_s, d) => s.setQuest?.(q.id, d as any),
        })),
      },
      {
        id: "causalProjections",
        label: "因果推演",
        getItems: (s) => (s.causalProjections ?? []).map((cp: any) => ({
          id: cp.actionDescription ?? cp.generatedAt?.day?.toString() ?? "",
          name: (cp.actionDescription ?? "因果预测") as string,
          subtitle: `${cp.rippleEffects?.length ?? 0} 条涟漪`,
          data: { ...cp } as Record<string, unknown>,
          category: "causalProjection",
          onSave: () => { /* 只读 */ },
        })),
      },
    ],
  },
];

// ============================================================
// 格式化辅助
// ============================================================

const ENCYC_TYPE_LABELS: Record<string, string> = {
  npc: "人物", item: "物品", location: "地点", faction: "势力", concept: "概念", other: "其他",
};

function formatEncycType(t: string): string {
  return ENCYC_TYPE_LABELS[t] ?? t;
}

function formatQuestStatus(s: string): string {
  switch (s) {
    case "active": return "进行中";
    case "done": return "已完成";
    case "failed": return "失败";
    default: return s;
  }
}

// ============================================================
// 组件
// ============================================================

interface Props {
  onClose: () => void;
}

export function CreativeModePanel({ onClose }: Props) {
  const ui = useInterfaceText();
  const store = useGameStore();
  const [activeGroup, setActiveGroup] = useState(CATEGORY_GROUPS[0].name);
  const [activeCategory, setActiveCategory] = useState(CATEGORY_GROUPS[0].children[0].id);
  const [editingItem, setEditingItem] = useState<ItemDef | null>(null);

  const groupDef = CATEGORY_GROUPS.find((g) => g.name === activeGroup)!;
  const catDef = groupDef.children.find((c) => c.id === activeCategory)!;

  const state = useGameStore.getState();
  const items = catDef.getItems(state);

  const handleSaveItem = (data: Record<string, unknown>) => {
    if (!editingItem) return;
    const s = useGameStore.getState();
    editingItem.onSave(s, data);
    setEditingItem(null);
  };

  const handleDeleteItem = () => {
    if (!editingItem || !editingItem.onDelete) return;
    const s = useGameStore.getState();
    editingItem.onDelete(s);
    setEditingItem(null);
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[380px] bg-zinc-950/95 border-l border-zinc-800/50 z-40 flex flex-col shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 shrink-0">
        <h3 className="text-sm font-medium text-zinc-300">{ui("世界信息面板")}</h3>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer text-lg leading-none px-1"
        >
          &times;
        </button>
      </div>

      {/* Body: two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: group → category nav */}
        <div className="w-[100px] border-r border-zinc-800/30 overflow-y-auto shrink-0 py-2">
          {CATEGORY_GROUPS.map((group) => (
            <div key={group.name} className="mb-1">
              <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                {group.name}
              </div>
              {group.children.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setActiveGroup(group.name);
                    setActiveCategory(cat.id);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    activeCategory === cat.id
                      ? "text-amber-300 bg-amber-950/20 border-r-2 border-amber-500/50"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {ui(cat.label)}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Right: items list */}
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 py-1 mb-2">
            <span className="text-xs text-zinc-500">
              {ui(catDef.label)} · {items.length} {ui("条目")}</span>
          </div>

          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-zinc-600">
              {ui("（空）")}</div>
          ) : (
            <div className="space-y-0.5 px-1">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setEditingItem(item)}
                  className="w-full text-left px-3 py-2 rounded hover:bg-zinc-800/30 transition-colors cursor-pointer group"
                >
                  <div className="text-xs text-zinc-300 truncate">{item.name}</div>
                  {item.subtitle && (
                    <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{item.subtitle}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-zinc-800/50 shrink-0">
        <p className="text-[10px] text-zinc-600">{ui("点击条目查看和编辑数据 · 修改即时生效")}</p>
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <EditModal
          category={editingItem.category}
          title={editingItem.name}
          data={editingItem.data}
          onSave={handleSaveItem}
          onDelete={editingItem.onDelete ? handleDeleteItem : undefined}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  );
}
