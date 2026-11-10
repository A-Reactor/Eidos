import { getPlayerVisibleText } from '@/lib/game/player-reading';
import type {
  Clue,
  CriticalFactEntry,
  DiaryEntry,
  EncyclopediaEntry,
  InventoryItem,
  WorldLineNode,
} from "@/lib/game/types";

export type LongMemoryRetrievalStrategy =
  | "not_needed"
  | "current_state"
  | "explicit_step_window"
  | "summary_locator_window"
  | "no_match";

export type LongMemoryCurrentStateSource =
  | "inventory"
  | "clue"
  | "encyclopedia"
  | "critical_fact"
  | "diary";

export interface LongMemoryCurrentStateMatch {
  source: LongMemoryCurrentStateSource;
  label: string;
  detail: string;
  score: number;
}

export interface LongMemoryRetrievedEntry {
  nodeId: string;
  stepNumber: number;
  sceneName: string;
  gameTime: string;
  playerInput: string;
  summary: string;
  excerpt: string;
  score: number;
}

export interface LongMemorySelectedRange {
  centerStep: number;
  fromStep: number;
  toStep: number;
  radius: number;
}

export interface LongMemoryRetrievalResult {
  query: string;
  strategy: LongMemoryRetrievalStrategy;
  reason: string;
  selectedRange: LongMemorySelectedRange | null;
  currentStateMatches: LongMemoryCurrentStateMatch[];
  entries: LongMemoryRetrievedEntry[];
}

export interface LongMemoryRetrievalInput {
  rememberedNodeIds?: string[];
  playerInput: string;
  inventory?: InventoryItem[];
  clues?: Clue[];
  encyclopedia?: EncyclopediaEntry[];
  criticalFacts?: CriticalFactEntry[];
  diary?: DiaryEntry[];
  allNodes?: Record<string, WorldLineNode> | WorldLineNode[] | null;
  currentNodeId?: string | null;
  windowRadius?: number;
  maxNodes?: number;
  maxCharsPerNode?: number;
  maxContextChars?: number;
}

interface ExplicitStepRequest {
  step: number;
  radius: number;
}

const DEFAULT_WINDOW_RADIUS = 5;
const MAX_WINDOW_RADIUS = 12;
const DEFAULT_MAX_NODES = 13;
const DEFAULT_MAX_CHARS_PER_NODE = 700;
const DEFAULT_MAX_CONTEXT_CHARS = 6500;

const MEMORY_TRIGGER_RE =
  /(回溯|跳转|返回|回到|之前|以前|刚才|上次|当时|那时|早些|前面|曾经|记得|回忆|想起|历史|世界线|节点|回读|检索|查找|找找|翻记录|读档|读取|rewind|backtrack|previous|before|earlier|remember|recall|history|worldline|step)/i;

const DETAIL_RECALL_RE =
  /(写[着了]什么|内容是什么|上面.*什么|说了什么|提到什么|名字叫什么|到底.*什么|what.*(said|written|inside|content))/i;

const STOP_TERMS = [
  "之前",
  "以前",
  "刚才",
  "上次",
  "当时",
  "那时",
  "早些",
  "前面",
  "曾经",
  "记得",
  "回忆",
  "想起",
  "历史",
  "世界线",
  "节点",
  "回读",
  "检索",
  "查找",
  "找找",
  "看看",
  "一下",
  "到底",
  "究竟",
  "内容",
  "什么",
  "哪里",
  "哪儿",
  "是否",
  "有没有",
  "我要",
  "我想",
  "读取",
  "信息",
  "上下",
  "前后",
  "左右",
  "附近",
  "第",
  "步",
  "上面",
  "写了",
  "写着",
  "说了",
  "提到",
  "previous",
  "before",
  "earlier",
  "remember",
  "recall",
  "history",
  "what",
  "content",
  "step",
];

export function shouldRunLongMemoryRetrieval(playerInput: string): boolean {
  const text = playerInput.trim();
  if (!text) return false;
  if (parseExplicitStepRequest(text)) return true;
  return MEMORY_TRIGGER_RE.test(text) || DETAIL_RECALL_RE.test(text);
}

export function retrieveLongMemoryContext(input: LongMemoryRetrievalInput): LongMemoryRetrievalResult {
  const query = input.playerInput.trim();
  const terms = extractSearchTerms(query);
  const explicit = parseExplicitStepRequest(query);
  const raw = Array.isArray(input.allNodes) ? Object.fromEntries(input.allNodes.filter(Boolean).map(node => [node.id,node])) : input.allNodes ?? {};
  const branchNodes = selectCurrentBranch(normalizeNodes(raw), input.currentNodeId, input.rememberedNodeIds);
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES;
  const maxCharsPerNode = input.maxCharsPerNode ?? DEFAULT_MAX_CHARS_PER_NODE;
  const maxContextChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;

  if (!shouldRunLongMemoryRetrieval(query)) {
    return {
      query,
      strategy: "not_needed",
      reason: "玩家输入没有明显请求长线回忆或步骤回读。",
      selectedRange: null,
      currentStateMatches: [],
      entries: [],
    };
  }

  if (explicit) {
    return buildStepWindowResult({
      query,
      strategy: "explicit_step_window",
      reason: `玩家明确请求第${explicit.step}步上下${explicit.radius}步。`,
      nodes: branchNodes,
      centerStep: explicit.step,
      radius: explicit.radius,
      maxNodes,
      maxCharsPerNode,
      maxContextChars,
    });
  }

  const currentStateMatches = findCurrentStateMatches(input, terms);
  if (currentStateMatches.length > 0) {
    return {
      query,
      strategy: "current_state",
      reason: "请求命中背包、线索、百科、关键信息或日记等当前完整状态，不需要回读旧节点。",
      selectedRange: null,
      currentStateMatches,
      entries: [],
    };
  }

  const scoredNodes = branchNodes
    .map((node) => ({ node, score: scoreNode(node, terms) }))
    .filter(({ node, score }) => node.stepNumber > 0 && score >= 2)
    .sort((a, b) => b.score - a.score || b.node.stepNumber - a.node.stepNumber);

  const best = scoredNodes[0];
  if (!best) {
    return {
      query,
      strategy: "no_match",
      reason: "当前完整状态和压缩世界线节点都没有找到可靠证据。",
      selectedRange: null,
      currentStateMatches: [],
      entries: [],
    };
  }

  const radius = clampRadius(input.windowRadius ?? DEFAULT_WINDOW_RADIUS);
  return buildStepWindowResult({
    query,
    strategy: "summary_locator_window",
    reason: `先用压缩节点定位到第${best.node.stepNumber}步，再回读上下${radius}步的原文片段。`,
    nodes: branchNodes,
    centerStep: best.node.stepNumber,
    radius,
    maxNodes,
    maxCharsPerNode,
    maxContextChars,
  });
}

export function buildLongMemoryRetrievalContext(result: LongMemoryRetrievalResult): string {
  if (result.strategy === "not_needed") return "";

  const lines: string[] = [
    "## 长线记忆检索",
    "- 这是一段只读证据上下文，用来回答玩家对旧细节、旧物件、旧对话或指定步骤的回忆请求。",
    "- 当前地点、持有物、人物与本轮已发生事件优先使用当前完整状态。追问过去实际说过或见过什么时，以对应亲历原文为准，不用当前百科改写过去；现有材料不足时使用只读历史工具，不编造细节。",
    "- 回忆证据限于明确保留的亲历记忆、已提供的旧节点原文和只读历史工具返回的亲历内容；材料未支持的细节保持未知，不把未经历分支当作记忆。",
    "- 回溯能力保留的旧未来仅是主角记忆，不代表本轮世界或其他人物已经经历。",
    `- 玩家本轮检索意图：${result.query || "（空）"}`,
  ];

  if (result.strategy === "current_state") {
    lines.push("- 检索策略：优先使用当前完整状态。");
    lines.push("- 结论：自动检索已命中当前资料，本段未展开旧节点。若要核对过去原话而当前资料不足，可继续使用只读历史工具；当前资料命中不禁止核对原文。");
    lines.push("### 当前状态命中");
    for (const match of result.currentStateMatches.slice(0, 5)) {
      lines.push(`- [${sourceLabel(match.source)}] ${match.label}：${truncateText(match.detail, 260)}`);
    }
    return lines.join("\n");
  }

  if (result.strategy === "no_match") {
    lines.push("- 检索策略：当前状态未命中，压缩节点定位也未命中。");
    lines.push("- 结论：本次自动检索没有找到可靠证据。若有只读历史工具，可先请求搜索或读取亲历原文；仍无证据时说明记忆不确定，或请玩家补充定位线索。不要编造纸条正文、旧对话、旧地点或旧因果。");
    return lines.join("\n");
  }

  if (result.strategy === "explicit_step_window" && result.selectedRange) {
    lines.push(`- 检索策略：玩家明确要求第${result.selectedRange.centerStep}步上下${result.selectedRange.radius}步。`);
  } else if (result.strategy === "summary_locator_window" && result.selectedRange) {
    lines.push(`- 检索策略：压缩节点定位；命中第${result.selectedRange.centerStep}步，回读上下${result.selectedRange.radius}步。`);
  }

  if (result.selectedRange) {
    lines.push(`- 回读范围：第${result.selectedRange.fromStep}步至第${result.selectedRange.toStep}步。`);
  }

  if (result.entries.length === 0) {
    lines.push("- 结论：指定范围内没有可读节点。不要编造。");
    return lines.join("\n");
  }

  lines.push("### 回读证据");
  for (const entry of result.entries) {
    lines.push(`#### 节点 ${entry.nodeId}｜第${entry.stepNumber}步｜${entry.sceneName || "未知场景"}｜${entry.gameTime}`);
    lines.push(`- 玩家行动：${entry.playerInput || "（无）"}`);
    lines.push(`- 节点摘要：${entry.summary || "（无）"}`);
    lines.push(`- 原文回读片段（不保证全文）：${entry.excerpt || "（无可用文本）"}`);
  }

  return lines.join("\n");
}

function buildStepWindowResult(params: {
  query: string;
  strategy: "explicit_step_window" | "summary_locator_window";
  reason: string;
  nodes: WorldLineNode[];
  centerStep: number;
  radius: number;
  maxNodes: number;
  maxCharsPerNode: number;
  maxContextChars: number;
}): LongMemoryRetrievalResult {
  const radius = clampRadius(params.radius);
  const range = {
    centerStep: params.centerStep,
    fromStep: Math.max(0, params.centerStep - radius),
    toStep: params.centerStep + radius,
    radius,
  };
  const selected = params.nodes
    .filter((node) => node.stepNumber >= range.fromStep && node.stepNumber <= range.toStep)
    .slice(-params.maxNodes);
  const entries = fitEntriesToBudget(
    selected.map((node) => formatNodeEntry(node, params.maxCharsPerNode)),
    params.maxContextChars,
  );

  return {
    query: params.query,
    strategy: params.strategy,
    reason: params.reason,
    selectedRange: range,
    currentStateMatches: [],
    entries,
  };
}

function parseExplicitStepRequest(text: string): ExplicitStepRequest | null {
  const normalized = text.normalize("NFKC");
  const stepMatch =
    normalized.match(/第\s*(\d{1,5})\s*步/) ??
    normalized.match(/step\s*#?\s*(\d{1,5})/i) ??
    normalized.match(/(?:读取|回读|检索|查看|查找|读)\s*(\d{1,5})\s*步/);
  if (!stepMatch) return null;

  const step = Number(stepMatch[1]);
  if (!Number.isFinite(step) || step < 0) return null;

  const radiusMatch =
    normalized.match(/(?:上下|前后|左右)\s*(\d{1,3})\s*步?/) ??
    normalized.match(/(?:±|\+\/-|前后各)\s*(\d{1,3})\s*步?/i);
  const radius = radiusMatch ? Number(radiusMatch[1]) : DEFAULT_WINDOW_RADIUS;

  return { step, radius: clampRadius(radius) };
}

function normalizeNodes(nodes: LongMemoryRetrievalInput["allNodes"]): WorldLineNode[] {
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes ?? {});
  return list
    .filter((node): node is WorldLineNode => Boolean(node))
    .sort((a, b) => a.stepNumber - b.stepNumber || a.createdAt - b.createdAt);
}

function selectCurrentBranch(nodes: WorldLineNode[], currentNodeId?: string | null, rememberedNodeIds: string[] = []): WorldLineNode[] {
  if (!currentNodeId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const current = byId.get(currentNodeId);
  if (!current) return [];

  const pathIds = new Set<string>(rememberedNodeIds);
  const visited = new Set<string>();
  let cursor: WorldLineNode | undefined = current;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    pathIds.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return nodes.filter((node) => pathIds.has(node.id) && !node.summary.startsWith('[旁观剧情，主角未知]'));
}

function findCurrentStateMatches(
  input: LongMemoryRetrievalInput,
  terms: string[],
): LongMemoryCurrentStateMatch[] {
  return [
    ...(input.inventory ?? []).map((item) => ({
      source: "inventory" as const,
      label: `${item.name} (${item.id})`,
      detail: `${item.description}；类别：${item.category}；数量：${item.quantity}`,
      text: `${item.name} ${item.id} ${item.description} ${item.category}`,
    })),
    ...(input.clues ?? [])
      .filter((clue) => clue.discovered)
      .map((clue) => ({
        source: "clue" as const,
        label: clue.name,
        detail: clue.description,
        text: `${clue.name} ${clue.description} ${clue.relatedContradiction}`,
      })),
    ...(input.encyclopedia ?? []).map((entry) => ({
      source: "encyclopedia" as const,
      label: entry.name,
      detail: `${entry.description}${entry.knowledge.length > 0 ? `；已知：${entry.knowledge.map((k) => k.text).join("；")}` : ""}`,
      text: `${entry.name} ${entry.description} ${entry.knowledge.map((k) => k.text).join(" ")}`,
    })),
    ...(input.criticalFacts ?? []).map((fact, index) => ({
      source: "critical_fact" as const,
      label: `关键信息 ${index + 1}`,
      detail: fact.text,
      text: fact.text,
    })),
    ...(input.diary ?? []).map((entry) => ({
      source: "diary" as const,
      label: `第${entry.day}天日记`,
      detail: entry.summary,
      text: entry.summary,
    })),
  ]
    .map((record) => ({ ...record, score: scoreText(record.text, terms) + scoreText(record.label, terms) }))
    .filter((record) => record.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map(({ text: _text, ...record }) => record);
}

function scoreNode(node: WorldLineNode, terms: string[]): number {
  if (terms.length === 0) return 0;
  const locatorText = `${node.playerInput} ${node.summary}`;
  const sceneText = `${node.sceneName} ${node.sceneId}`;
  const fullText = node.aiResponse ?? "";
  return scoreText(locatorText, terms) * 3 + scoreText(sceneText, terms) + scoreText(fullText, terms);
}

function scoreText(text: string, terms: string[]): number {
  const normalized = normalizeSearchText(text);
  if (!normalized || terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const index = normalized.indexOf(term);
    if (index < 0) continue;
    score += term.length >= 3 ? 3 : 2;
    if (index === 0) score += 1;
  }
  return score;
}

function extractSearchTerms(text: string): string[] {
  let normalized = normalizeSearchText(text)
    .replace(/第\d+步/g, "")
    .replace(/(?:上下|前后|左右)\d+步?/g, "");
  for (const stop of STOP_TERMS) {
    normalized = normalized.replaceAll(normalizeSearchText(stop), " ");
  }

  const terms = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9_]{2,}/gi)) {
    terms.add(match[0].toLowerCase());
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const chunk = match[0];
    if (chunk.length <= 8) terms.add(chunk);
    for (let size = 2; size <= 3; size++) {
      for (let i = 0; i <= chunk.length - size; i++) {
        terms.add(chunk.slice(i, i + size));
      }
    }
  }

  return [...terms]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !STOP_TERMS.includes(term))
    .slice(0, 20);
}

function formatNodeEntry(node: WorldLineNode, maxCharsPerNode: number): LongMemoryRetrievedEntry {
  return {
    nodeId: node.id,
    stepNumber: node.stepNumber,
    sceneName: node.sceneName,
    gameTime: `第${node.gameTime.day}天 ${String(node.gameTime.hour).padStart(2, "0")}:${String(node.gameTime.minute).padStart(2, "0")}`,
    playerInput: truncateText(node.playerInput, 220),
    summary: truncateText(node.summary, 260),
    excerpt: truncateText(getPlayerVisibleText(node), maxCharsPerNode),
    score: 0,
  };
}

function fitEntriesToBudget(entries: LongMemoryRetrievedEntry[], maxContextChars: number): LongMemoryRetrievedEntry[] {
  const fitted: LongMemoryRetrievedEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = entry.playerInput.length + entry.summary.length + entry.excerpt.length + 80;
    if (fitted.length > 0 && used + cost > maxContextChars) break;
    fitted.push(entry);
    used += cost;
  }
  return fitted;
}

function truncateText(text: string, maxChars: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeSearchText(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampRadius(radius: number): number {
  if (!Number.isFinite(radius)) return DEFAULT_WINDOW_RADIUS;
  return Math.max(0, Math.min(MAX_WINDOW_RADIUS, Math.floor(radius)));
}

function sourceLabel(source: LongMemoryCurrentStateSource): string {
  switch (source) {
    case "inventory":
      return "背包";
    case "clue":
      return "线索";
    case "encyclopedia":
      return "百科";
    case "critical_fact":
      return "关键信息";
    case "diary":
      return "日记";
  }
}
