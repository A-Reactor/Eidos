import type { EncyclopediaEntry, EncyclopediaEntryType } from "@/lib/game/types";

export const PLAYER_ENCYCLOPEDIA_TYPES: Exclude<EncyclopediaEntryType, "npc">[] = [
  "item",
  "location",
  "faction",
  "concept",
  "other",
];

export interface EncyclopediaMaintenanceUpdate {
  name: string;
  type: Exclude<EncyclopediaEntryType, "npc">;
  description: string;
  knowledge?: string;
}

export interface EncyclopediaMaintenanceResult {
  encyclopediaUpdates: EncyclopediaMaintenanceUpdate[];
  encyclopediaDeletions: string[];
}

export function filterPlayerEncyclopediaEntries(entries: unknown): EncyclopediaEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is EncyclopediaEntry => isValidPlayerEntry(entry))
    .map((entry) => JSON.parse(JSON.stringify(entry)) as EncyclopediaEntry);
}

export function sanitizeEncyclopediaMaintenanceResult(
  raw: unknown,
  existingEntries: EncyclopediaEntry[],
): EncyclopediaMaintenanceResult {
  const scopedExisting = filterPlayerEncyclopediaEntries(existingEntries);
  const existingNames = new Set(scopedExisting.map((entry) => entry.name));
  const rawRecord = isRecord(raw) ? raw : {};
  const updates = Array.isArray(rawRecord.encyclopediaUpdates)
    ? rawRecord.encyclopediaUpdates
    : [];
  const deletions = Array.isArray(rawRecord.encyclopediaDeletions)
    ? rawRecord.encyclopediaDeletions
    : [];

  return {
    encyclopediaUpdates: updates
      .map(normalizeUpdate)
      .filter((update): update is EncyclopediaMaintenanceUpdate => update !== null),
    encyclopediaDeletions: uniqueStrings(
      deletions.filter((name): name is string =>
        typeof name === "string" && name.trim().length > 0 && existingNames.has(name.trim()),
      ).map((name) => name.trim()),
    ),
  };
}

export function buildEncyclopediaMaintenancePrompt(input: {
  mode: "incremental" | "reorganize";
  encyclopedia: EncyclopediaEntry[];
  recentHistory?: Array<{ playerInput: string; summary: string }>;
}): { systemPrompt: string; userMessage: string } {
  const modeLabel = input.mode === "incremental" ? "增量维护" : "重整理";
  const history = input.recentHistory?.length
    ? input.recentHistory.map((item) => `- 玩家：${item.playerInput}\n  摘要：${item.summary}`).join("\n")
    : "（无）";

  return {
    systemPrompt: `你是 Eidos 的 KEI 百科维护器。你的权限被限制在“玩家百科”的非 NPC 条目内。

硬性边界：
- 只能整理 item、location、faction、concept、other。
- 禁止输出 npc 类型，人物/NPC 信息由 npcMemory 和 NPC 信息界面管理。
- 禁止修改世界定义、世界档案、sourceArchive、canon ledger、资料证据、NPC 档案或存档结构。
- name 必须是非空字符串；type 必须是 item/location/faction/concept/other。
- 只返回 JSON，不要叙事、解释或 Markdown。

输出格式：
{
  "encyclopediaUpdates": [
    {"name":"条目名","type":"location","description":"玩家可见简介","knowledge":"可选的新认知"}
  ],
  "encyclopediaDeletions": ["只删除输入百科中确实存在的非 NPC 条目名"]
}`,
    userMessage: `任务：${modeLabel}

当前玩家百科（已排除 NPC）：
${JSON.stringify(input.encyclopedia, null, 2)}

最近剧情：
${history}`,
  };
}

function normalizeUpdate(raw: unknown): EncyclopediaMaintenanceUpdate | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  if (raw.type === "npc") return null;
  const type = isPlayerEncyclopediaType(raw.type) ? raw.type : "other";
  const description = typeof raw.description === "string" && raw.description.trim()
    ? raw.description.trim()
    : name;
  const knowledge = typeof raw.knowledge === "string" && raw.knowledge.trim()
    ? raw.knowledge.trim()
    : undefined;
  return { name, type, description, knowledge };
}

function isValidPlayerEntry(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return typeof raw.id === "string"
    && raw.id.trim().length > 0
    && typeof raw.name === "string"
    && raw.name.trim().length > 0
    && isPlayerEncyclopediaType(raw.type);
}

function isPlayerEncyclopediaType(type: unknown): type is Exclude<EncyclopediaEntryType, "npc"> {
  return typeof type === "string"
    && PLAYER_ENCYCLOPEDIA_TYPES.includes(type as Exclude<EncyclopediaEntryType, "npc">);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
