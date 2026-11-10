// ============================================================
// Eidos · 玩家系统 Slice
// ============================================================

import type {
  Clue,
  CriticalFactEntry,
  DiaryEntry,
  EncyclopediaEntry,
  EncyclopediaEntryType,
  InventoryItem,
  KnowledgeItem,

  QuestEntry,
  QuestStatus,
  ProtagonistState,
} from "@/lib/game/types";

export interface PlayerSlice {
  protagonistState: ProtagonistState;
  updateProtagonistState: (s: Partial<ProtagonistState>) => void;

  inventory: InventoryItem[];
  addToInventory: (item: InventoryItem) => void;
  removeFromInventory: (itemId: string, quantity?: number) => void;
  hasItem: (itemName: string) => boolean;
  useItem: (itemId: string) => InventoryItem | null;

  clues: Clue[];
  discoverClue: (clueId: string) => void;
  getAvailableClues: () => Clue[];
  getDiscoveredClues: () => Clue[];

  encyclopedia: EncyclopediaEntry[];
  upsertEncyclopediaEntry: (
    entry: Partial<
      Omit<EncyclopediaEntry, "id" | "firstEncountered" | "lastUpdated" | "knowledge">
    > & {
      type: string;
      name: string;
      description: string;
      id?: string;
      knowledge?: string; // AI 协议仍传单条 string，内部包装为 KnowledgeItem
    }
  ) => void;
  addKnowledge: (entryId: string, knowledge: string) => void;
  deleteEncyclopediaEntry: (entryId: string) => void;

  criticalFacts: CriticalFactEntry[];
  addCriticalFact: (fact: string) => void;

  questLog: QuestEntry[];
  addQuest: (q: Omit<QuestEntry, "id" | "createdAt" | "resolvedAt">) => void;
  updateQuestStatus: (id: string, status: QuestStatus) => void;
  getActiveQuests: () => QuestEntry[];

  lastEncyclopediaUpdateAt: number;
  markEncyclopediaUpdated: () => void;
  diary: DiaryEntry[];
  getDiaryForDay: (day: number) => DiaryEntry | undefined;
  upsertDiaryEntry: (day: number, entries: string[], summary: string) => void;


  relationships: Record<
    string,
    {
      npcName: string;
      affinity: number;
      trust: number;
      tags: string[];
      firstMet: { day: number; hour: number; minute: number };
      lastInteraction: { day: number; hour: number; minute: number };
      notes: string;
    }
  >;
  updateRelationship: (update: {
    npcName: string;
    affinityDelta?: number;
    trustDelta?: number;
    addTags?: string[];
    removeTags?: string[];
  }) => void;

  updateItemValue: (itemId: string, value: number) => void;

  // ========== 直接编辑 setter（创造模式） ==========
  setProtagonistState: (state: ProtagonistState) => void;
  setEncyclopediaEntry: (entryId: string, partial: Partial<EncyclopediaEntry>) => void;
  setClue: (clueId: string, partial: Partial<Clue>) => void;
  setQuest: (questId: string, partial: Partial<QuestEntry>) => void;
  setInventoryItem: (itemId: string, partial: Partial<InventoryItem>) => void;
  removeCriticalFact: (index: number) => void;
  setDiaryEntry: (day: number, partial: Partial<DiaryEntry>) => void;
  setRelationship: (npcName: string, partial: Partial<{ affinity: number; trust: number; tags: string[]; notes: string }>) => void;
}

export const createPlayerSlice = (
  set: (partial: (Record<string, any> | ((state: Record<string, any>) => Record<string, any>))) => void,
  get: () => any,
  _store?: any,
  options: { createId?: (kind: 'encyclopedia' | 'quest') => string } = {},
): PlayerSlice => ({
  // ========== 主角状态 ==========
  protagonistState: { health: "良好", mood: "平静", statusEffects: [], notes: "" },
  updateProtagonistState: (s) =>
    set((st) => ({
      protagonistState: { ...st.protagonistState, ...s },
    })),

  // ========== 背包系统 ==========
  inventory: [],
  addToInventory: (item) =>
    set((s) => {
      const existing = s.inventory.find((i: InventoryItem) => isSameInventoryRecord(i, item));
      if (existing) {
        return {
          inventory: s.inventory.map((i: InventoryItem) =>
            i.id === existing.id
              ? mergeInventoryRecord(i, item)
              : i
          ),
        };
      }
      return { inventory: [...s.inventory, { ...item }] };
    }),
  removeFromInventory: (itemId, quantity = 1) =>
    set((s) => {
      const item = s.inventory.find((i: InventoryItem) => i.id === itemId);
      if (!item) return s;
      if (item.quantity <= quantity) {
        return { inventory: s.inventory.filter((i: InventoryItem) => i.id !== itemId) };
      }
      return {
        inventory: s.inventory.map((i: InventoryItem) =>
          i.id === itemId ? { ...i, quantity: i.quantity - quantity } : i
        ),
      };
    }),
  hasItem: (itemName) =>
    get().inventory.some(
      (i: InventoryItem) => i.name.toLowerCase() === itemName.toLowerCase()
    ),
  useItem: (itemId) => {
    const item = get().inventory.find((i: InventoryItem) => i.id === itemId);
    if (!item) return null;
    if (item.consumable) {
      get().removeFromInventory(itemId, 1);
    }
    return item;
  },

  // ========== 线索系统 ==========
  clues: [],
  discoverClue: (clueId) =>
    set((s) => ({
      clues: s.clues.map((c: Clue) =>
        c.id === clueId
          ? { ...c, discovered: true, discoveredAt: { ...s.gameTime } }
          : c
      ),
    })),
  getAvailableClues: () => {
    const { clues, currentSceneId, sceneDetailLevels } = get();
    const discoveredIds = new Set(
      clues.filter((c: Clue) => c.discovered).map((c: Clue) => c.id)
    );

    return clues.filter((c: Clue) => {
      if (c.discovered) return false;
      if (c.sceneId !== currentSceneId) return false;
      const detail = sceneDetailLevels[currentSceneId] ?? 10;
      if (detail < c.detailThreshold) return false;
      // 前置线索必须全部已发现
      if (c.prerequisiteClues.length > 0) {
        if (!c.prerequisiteClues.every((p) => discoveredIds.has(p))) {
          return false;
        }
      }
      return true;
    });
  },
  getDiscoveredClues: () =>
    get().clues.filter((c: Clue) => c.discovered),

  // ========== 百科全书 ==========
  encyclopedia: [],
  upsertEncyclopediaEntry: (entry) =>
    set((s) => {
      const now = s.gameTime;
      /** 将 AI 传入的单条 string 包装为 KnowledgeItem */
      const wrapKnowledge = (k: string): KnowledgeItem => ({
        text: k,
        source: "ai" as const,
        addedAt: { ...now },
        importance: 50,
      });
      // 精确匹配：同类型 + 同名
      const existing = s.encyclopedia.find(
        (e: EncyclopediaEntry) =>
          e.type === entry.type && e.name === entry.name
      );
      if (existing) {
        return {
          encyclopedia: s.encyclopedia.map((e: EncyclopediaEntry) =>
            e.id === existing.id
              ? {
                  ...e,
                  description: entry.description || e.description,
                  // 追加新认知，去重（按 text 字段比较）
                  knowledge:
                    entry.knowledge &&
                    !e.knowledge.some(
                      (k: KnowledgeItem) => k.text === entry.knowledge
                    )
                      ? [...e.knowledge, wrapKnowledge(entry.knowledge)]
                      : e.knowledge,
                  lastUpdated: { ...now },
                  relatedEntries: [
                    ...new Set([
                      ...e.relatedEntries,
                      ...(entry.relatedEntries ?? []),
                    ]),
                  ],
                }
              : e
          ),
        };
      }
      const newEntry: EncyclopediaEntry = {
        id:
          entry.id ?? options.createId?.('encyclopedia') ??
          `enc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: (entry.type || "other") as EncyclopediaEntryType,
        name: entry.name,
        description: entry.description,
        knowledge: entry.knowledge ? [wrapKnowledge(entry.knowledge)] : [],
        firstEncountered: { ...now },
        lastUpdated: { ...now },
        relatedEntries: entry.relatedEntries ?? [],
      };
      return { encyclopedia: [...s.encyclopedia, newEntry] };
    }),
  addKnowledge: (entryId, knowledge) =>
    set((s) => {
      const now = s.gameTime;
      const newItem: KnowledgeItem = {
        text: knowledge,
        source: "ai",
        addedAt: { ...now },
        importance: 50,
      };
      return {
        encyclopedia: s.encyclopedia.map((e: EncyclopediaEntry) =>
          e.id === entryId
            ? {
                ...e,
                knowledge: [...e.knowledge, newItem],
                lastUpdated: { ...now },
              }
            : e
        ),
      };
    }),
  deleteEncyclopediaEntry: (entryId) =>
    set((s) => ({
      encyclopedia: s.encyclopedia.filter(
        (e: EncyclopediaEntry) => e.id !== entryId
      ),
    })),

  // ========== 关键信息追踪（带重要性评分） ==========
  criticalFacts: [],
  /**
   * 添加一条关键信息。自动去重：若文本已存在则递增 referencedCount，
   * 否则新建条目（默认 importanceScore=50）。按重要性+引用次数排序，
   * 保留最多 20 条，超出时丢弃最低分条目。
   */
  addCriticalFact: (fact) =>
    set((s) => {
      const now = s.gameTime;
      // 去重：同一文本已存在 → 递增引用计数
      const existingIdx = s.criticalFacts.findIndex(
        (f: CriticalFactEntry) => f.text === fact
      );
      if (existingIdx >= 0) {
        return {
          criticalFacts: s.criticalFacts.map((f: CriticalFactEntry, i: number) =>
            i === existingIdx
              ? {
                  ...f,
                  referencedCount: f.referencedCount + 1,
                  lastReferencedAt: { ...now },
                }
              : f
          ),
        };
      }
      // 新条目
      const newEntry: CriticalFactEntry = {
        text: fact,
        importanceScore: 50,
        referencedCount: 1,
        lastReferencedAt: { ...now },
      };
      const updated = [...s.criticalFacts, newEntry];
      // 按 importanceScore 降序 → referencedCount 降序 排列
      updated.sort(
        (a, b) =>
          b.importanceScore - a.importanceScore ||
          b.referencedCount - a.referencedCount
      );
      // 保留 top 20，丢弃低分条目
      return { criticalFacts: updated.slice(0, 20) };
    }),

  // ========== 任务追踪 ==========
  questLog: [],
  addQuest: (q) =>
    set((s) => ({
      questLog: [
        ...s.questLog,
        {
          ...q,
          id: options.createId?.('quest') ?? `quest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: { ...s.gameTime },
          resolvedAt: null,
        },
      ],
    })),
  updateQuestStatus: (id, status) =>
    set((s) => ({
      questLog: s.questLog.map((q: QuestEntry) =>
        q.id === id
          ? {
              ...q,
              status,
              resolvedAt: status !== "active" ? { ...s.gameTime } : null,
            }
          : q
      ),
    })),
  getActiveQuests: () =>
    get().questLog.filter((q: QuestEntry) => q.status === "active"),

  // ========== 百科更新追踪 ==========
  lastEncyclopediaUpdateAt: 0,
  markEncyclopediaUpdated: () =>
    set({ lastEncyclopediaUpdateAt: get().history.length }),

  // ========== 日记 ==========
  diary: [],
  getDiaryForDay: (day) =>
    get().diary.find((d: DiaryEntry) => d.day === day),
  upsertDiaryEntry: (day, entries, summary) =>
    set((s) => {
      const existing = s.diary.findIndex((d: DiaryEntry) => d.day === day);
      if (existing >= 0) {
        const updated = [...s.diary];
        updated[existing] = { day, entries, summary, createdAt: { ...s.gameTime } };
        return { diary: updated };
      }
      return {
        diary: [
          ...s.diary,
          { day, entries, summary, createdAt: { ...s.gameTime } },
        ],
      };
    }),

  // ========== NPC 关系 ==========
  relationships: {},
  updateRelationship: (update) =>
    set((s) => {
      const existing = s.relationships[update.npcName];
      const now = s.gameTime;

      if (!existing) {
        // 首次初始化
        return {
          relationships: {
            ...s.relationships,
            [update.npcName]: {
              npcName: update.npcName,
              affinity: Math.max(
                -100,
                Math.min(100, update.affinityDelta ?? 0)
              ),
              trust: Math.max(0, Math.min(100, update.trustDelta ?? 0)),
              tags: update.addTags ?? [],
              firstMet: { ...now },
              lastInteraction: { ...now },
              notes: "",
            },
          },
        };
      }

      // 更新已有关系
      const newAffinity = Math.max(
        -100,
        Math.min(
          100,
          existing.affinity + (update.affinityDelta ?? 0)
        )
      );
      const newTrust = Math.max(
        0,
        Math.min(100, existing.trust + (update.trustDelta ?? 0))
      );
      const newTags = [...existing.tags];
      if (update.addTags) {
        update.addTags.forEach((t) => {
          if (!newTags.includes(t)) newTags.push(t);
        });
      }
      if (update.removeTags) {
        update.removeTags.forEach((t) => {
          const idx = newTags.indexOf(t);
          if (idx >= 0) newTags.splice(idx, 1);
        });
      }
      // 自动标签
      if (newAffinity >= 60 && newTrust >= 60 && !newTags.includes("朋友"))
        newTags.push("朋友");
      if (newAffinity <= -40 && !newTags.includes("敌人"))
        newTags.push("敌人");

      return {
        relationships: {
          ...s.relationships,
          [update.npcName]: {
            ...existing,
            affinity: newAffinity,
            trust: newTrust,
            tags: newTags,
            lastInteraction: { ...now },
            notes: "",
          },
        },
      };
    }),

  updateItemValue: (itemId, value) =>
    set((s) => ({
      inventory: s.inventory.map((i: InventoryItem) =>
        i.id === itemId ? { ...i, value } : i
      ),
    })),

  // ========== 直接编辑 setter（创造模式） ==========
  setProtagonistState: (state) => set({ protagonistState: { ...state } }),
  setEncyclopediaEntry: (entryId, partial) =>
    set((s) => ({
      encyclopedia: s.encyclopedia.map((e: EncyclopediaEntry) =>
        e.id === entryId
          ? { ...e, ...partial, lastUpdated: { ...s.gameTime } }
          : e
      ),
    })),
  setClue: (clueId, partial) =>
    set((s) => ({
      clues: s.clues.map((c: Clue) =>
        c.id === clueId ? { ...c, ...partial } : c
      ),
    })),
  setQuest: (questId, partial) =>
    set((s) => ({
      questLog: s.questLog.map((q: QuestEntry) =>
        q.id === questId ? { ...q, ...partial } : q
      ),
    })),
  setInventoryItem: (itemId, partial) =>
    set((s) => ({
      inventory: s.inventory.map((i: InventoryItem) =>
        i.id === itemId ? { ...i, ...partial } : i
      ),
    })),
  removeCriticalFact: (index) =>
    set((s) => ({
      criticalFacts: s.criticalFacts.filter(
        (_: CriticalFactEntry, i: number) => i !== index
      ),
    })),
  setDiaryEntry: (day, partial) =>
    set((s) => ({
      diary: s.diary.map((d: DiaryEntry) =>
        d.day === day ? { ...d, ...partial } : d
      ),
    })),
  setRelationship: (npcName, partial) =>
    set((s) => {
      const existing = s.relationships[npcName];
      if (!existing) return s;
      return {
        relationships: {
          ...s.relationships,
          [npcName]: { ...existing, ...partial },
        },
      };
    }),
});

function isSameInventoryRecord(existing: InventoryItem, incoming: InventoryItem): boolean {
  if (existing.id === incoming.id) return true;
  return normalizeInventoryName(existing.name) === normalizeInventoryName(incoming.name)
    && existing.category === incoming.category;
}

function mergeInventoryRecord(existing: InventoryItem, incoming: InventoryItem): InventoryItem {
  const sameId = existing.id === incoming.id;
  const stackable = isStackableInventoryItem(existing) || isStackableInventoryItem(incoming);
  const quantity = stackable && !sameId
    ? safeQuantity(existing.quantity) + safeQuantity(incoming.quantity)
    : Math.max(safeQuantity(existing.quantity), safeQuantity(incoming.quantity));

  return {
    ...existing,
    name: sameId && incoming.name.trim() ? incoming.name : existing.name,
    description: sameId
      ? chooseIncomingDescription(existing.description, incoming.description)
      : chooseFullerDescription(existing.description, incoming.description),
    quantity,
    category: incoming.category ?? existing.category,
    consumable: existing.consumable || incoming.consumable,
    value: Math.max(existing.value ?? 0, incoming.value ?? 0),
    imageUrl: incoming.imageUrl ?? existing.imageUrl,
  };
}

function isStackableInventoryItem(item: InventoryItem): boolean {
  return item.consumable || item.category === "consumable" || item.category === "misc";
}

function chooseIncomingDescription(current: string, incoming: string): string {
  return incoming.trim().length > 0 ? incoming : current;
}

function chooseFullerDescription(current: string, incoming: string): string {
  return incoming.trim().length > current.trim().length ? incoming : current;
}

function normalizeInventoryName(name: string): string {
  return name.trim().toLocaleLowerCase("zh-Hans-CN");
}

function safeQuantity(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}
