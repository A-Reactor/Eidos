// ============================================================
// Source Archive · 玩家资料建档
// ============================================================
// 这一层只处理可验证的本地结构：原始资料、证据原子、原作事实账本。
// AI 负责提出内容，但进入世界创建前必须经过这里的 schema guard。

export type SourceDocumentKind = "pasted_text" | "player_note" | "imported_text";
export type SourceLanguage = "zh-CN" | "en" | "mixed";

export interface SourceDocument {
  id: string;
  title: string;
  kind: SourceDocumentKind;
  content: string;
  createdAt: number;
}

export interface SourceCorpus {
  id: string;
  documents: SourceDocument[];
  language: SourceLanguage;
  createdAt: number;
}

export interface SourceChunk {
  id: string;
  sourceId: string;
  title: string;
  index: number;
  start: number;
  end: number;
  text: string;
}

export type EvidenceCategory =
  | "character"
  | "place"
  | "organization"
  | "event"
  | "relationship"
  | "world_rule"
  | "object"
  | "theme"
  | "unknown";

export interface EvidenceAtom {
  id: string;
  sourceId: string;
  category: EvidenceCategory;
  claim: string;
  entities: string[];
  confidence: number;
  sourceSpan?: {
    start: number;
    end: number;
    excerpt: string;
  };
}

export type CanonStatus =
  | "source_confirmed"
  | "inferred"
  | "player_note"
  | "generated_bridge"
  | "contradiction";

export type CanonEntityType =
  | "character"
  | "place"
  | "organization"
  | "object"
  | "concept";

export interface CanonEntity {
  id: string;
  name: string;
  type: CanonEntityType;
  description: string;
  status: CanonStatus;
  evidenceRefs: string[];
}

export interface CanonRelationship {
  id: string;
  from: string;
  to: string;
  type: string;
  description: string;
  status: CanonStatus;
  evidenceRefs: string[];
}

export interface CanonEvent {
  id: string;
  title: string;
  description: string;
  order: number;
  status: CanonStatus;
  evidenceRefs: string[];
  involvedEntities: string[];
}

export interface CanonRule {
  id: string;
  title: string;
  description: string;
  status: CanonStatus;
  evidenceRefs: string[];
}

export interface CanonUnknown {
  id: string;
  question: string;
  relatedEntities: string[];
  evidenceRefs: string[];
}

export interface CanonContradiction {
  id: string;
  description: string;
  conflictingEvidenceRefs: string[];
  resolution: "unresolved" | "prefer_high_confidence" | "player_decision_required";
}

export interface CanonLedger {
  id: string;
  title: string;
  summary: string;
  entities: CanonEntity[];
  relationships: CanonRelationship[];
  events: CanonEvent[];
  worldRules: CanonRule[];
  unresolvedQuestions: CanonUnknown[];
  contradictions: CanonContradiction[];
  sourceCoverage: {
    documentCount: number;
    evidenceCount: number;
    highConfidenceCount: number;
  };
}

export interface AdaptationBridgeContent {
  id: string;
  purpose: string;
  content: string;
  risk: "low" | "medium" | "high";
}

export interface AdaptationPlan {
  mode: "faithful" | "adaptive" | "inspired";
  playablePremise: string;
  lockedFacts: string[];
  allowedInventions: string[];
  forbiddenInventions: string[];
  bridgeContent: AdaptationBridgeContent[];
}

export interface UzqCreationSeed {
  npcId: string;
  sourceEntityIds: string[];
  archive: {
    coreDesires: string[];
    fearsAndTaboos: string[];
    valuePriorities: string[];
    cognitiveStyle: string;
    emotionalRegulation: string;
    socialStrategy: string;
    boundarySensitivity: number;
    metacognition: number;
  };
  confidence: number;
  evidenceRefs: string[];
  forbiddenNarrativeMoves: string[];
}

export interface WorldSourceArchive {
  reconstruction?: import('@/lib/game/source-reconstruction/types').SourceReconstructionArchive;
  corpus: SourceCorpus;
  evidence: EvidenceAtom[];
  ledger: CanonLedger;
  adaptationPlan: AdaptationPlan;
  uzqSeeds?: UzqCreationSeed[];
}

export interface SourceArchiveSummary {
  characters: number;
  places: number;
  events: number;
  unknowns: number;
  evidence: number;
}

export interface ChunkSourceDocumentOptions {
  targetSize?: number;
  maxSize?: number;
}

const DEFAULT_CHUNK_TARGET = 2200;
const DEFAULT_CHUNK_MAX = 3000;
const EVIDENCE_CATEGORIES = new Set<EvidenceCategory>([
  "character",
  "place",
  "organization",
  "event",
  "relationship",
  "world_rule",
  "object",
  "theme",
  "unknown",
]);
const CANON_STATUSES = new Set<CanonStatus>([
  "source_confirmed",
  "inferred",
  "player_note",
  "generated_bridge",
  "contradiction",
]);

export function createSourceCorpus(
  documents: Array<{
    id?: string;
    title?: string;
    content: string;
    kind?: SourceDocumentKind;
  }>,
  createdAt = Date.now(),
): SourceCorpus {
  const normalized = documents
    .map((doc, index) => ({
      id: doc.id ?? `src_${String(index + 1).padStart(3, "0")}`,
      title: doc.title?.trim() || `资料 ${index + 1}`,
      kind: doc.kind ?? "pasted_text",
      content: doc.content,
      createdAt,
    }))
    .filter((doc) => doc.content.trim().length > 0);

  return {
    id: `corpus_${createdAt}`,
    documents: normalized,
    language: detectCorpusLanguage(normalized.map((doc) => doc.content).join("\n")),
    createdAt,
  };
}

export function chunkSourceDocument(
  document: SourceDocument,
  options: ChunkSourceDocumentOptions = {},
): SourceChunk[] {
  const targetSize = Math.max(100, options.targetSize ?? DEFAULT_CHUNK_TARGET);
  const maxSize = Math.max(targetSize, options.maxSize ?? DEFAULT_CHUNK_MAX);
  const paragraphs = splitParagraphs(document.content);
  const chunks: SourceChunk[] = [];

  let currentStart = -1;
  let currentEnd = -1;
  let currentText = "";

  function pushCurrent() {
    if (currentStart < 0 || currentEnd <= currentStart) return;
    chunks.push({
      id: `${document.id}_chunk_${String(chunks.length + 1).padStart(3, "0")}`,
      sourceId: document.id,
      title: document.title,
      index: chunks.length,
      start: currentStart,
      end: currentEnd,
      text: currentText,
    });
    currentStart = -1;
    currentEnd = -1;
    currentText = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.text.length > maxSize) {
      pushCurrent();
      for (let start = paragraph.start; start < paragraph.end; start += maxSize) {
        const end = Math.min(start + maxSize, paragraph.end);
        chunks.push({
          id: `${document.id}_chunk_${String(chunks.length + 1).padStart(3, "0")}`,
          sourceId: document.id,
          title: document.title,
          index: chunks.length,
          start,
          end,
          text: document.content.slice(start, end),
        });
      }
      continue;
    }

    if (currentStart < 0) {
      currentStart = paragraph.start;
      currentEnd = paragraph.end;
      currentText = paragraph.text;
      continue;
    }

    const joinedLength = paragraph.end - currentStart;
    const shouldSplit =
      joinedLength > maxSize ||
      (currentText.length >= targetSize && paragraph.text.length > 0);

    if (shouldSplit) {
      pushCurrent();
      currentStart = paragraph.start;
      currentEnd = paragraph.end;
      currentText = paragraph.text;
    } else {
      currentEnd = paragraph.end;
      currentText = document.content.slice(currentStart, currentEnd);
    }
  }

  pushCurrent();
  return chunks;
}

export function isEvidenceAtom(value: unknown): value is EvidenceAtom {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.sourceId)) return false;
  if (!isEvidenceCategory(value.category)) return false;
  if (!isNonEmptyString(value.claim)) return false;
  if (!Array.isArray(value.entities) || !value.entities.every((v) => typeof v === "string")) {
    return false;
  }
  if (!isNumberInRange(value.confidence, 0, 100)) return false;
  if (value.sourceSpan !== undefined && !isSourceSpan(value.sourceSpan)) return false;
  return true;
}

export function isSourceCorpus(value: unknown): value is SourceCorpus {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isSourceLanguage(value.language) &&
    isNonNegativeNumber(value.createdAt) &&
    Array.isArray(value.documents) &&
    value.documents.every(isSourceDocument)
  );
}

export function isCanonLedger(value: unknown): value is CanonLedger {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.title)) return false;
  if (typeof value.summary !== "string") return false;
  if (!Array.isArray(value.entities)) return false;
  if (!Array.isArray(value.relationships)) return false;
  if (!Array.isArray(value.events)) return false;
  if (!Array.isArray(value.worldRules)) return false;
  if (!Array.isArray(value.unresolvedQuestions)) return false;
  if (!Array.isArray(value.contradictions)) return false;
  if (!isRecord(value.sourceCoverage)) return false;
  if (!isNonNegativeNumber(value.sourceCoverage.documentCount)) return false;
  if (!isNonNegativeNumber(value.sourceCoverage.evidenceCount)) return false;
  if (!isNonNegativeNumber(value.sourceCoverage.highConfidenceCount)) return false;

  return (
    value.entities.every(isCanonEntityLike) &&
    value.events.every(isCanonEventLike) &&
    value.unresolvedQuestions.every(isCanonUnknownLike)
  );
}

export function isUzqCreationSeed(value: unknown): value is UzqCreationSeed {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.npcId)) return false;
  if (!Array.isArray(value.sourceEntityIds) || !value.sourceEntityIds.every((v) => typeof v === "string")) {
    return false;
  }
  if (!isRecord(value.archive)) return false;
  if (!Array.isArray(value.archive.coreDesires)) return false;
  if (!Array.isArray(value.archive.fearsAndTaboos)) return false;
  if (!Array.isArray(value.archive.valuePriorities)) return false;
  if (typeof value.archive.cognitiveStyle !== "string") return false;
  if (typeof value.archive.emotionalRegulation !== "string") return false;
  if (typeof value.archive.socialStrategy !== "string") return false;
  if (!isNumberInRange(value.archive.boundarySensitivity, 0, 100)) return false;
  if (!isNumberInRange(value.archive.metacognition, 0, 100)) return false;
  if (!isNumberInRange(value.confidence, 0, 100)) return false;
  if (!Array.isArray(value.evidenceRefs) || !value.evidenceRefs.every((v) => typeof v === "string")) {
    return false;
  }
  if (!Array.isArray(value.forbiddenNarrativeMoves) || !value.forbiddenNarrativeMoves.every((v) => typeof v === "string")) {
    return false;
  }
  return true;
}

export function summarizeCanonLedger(ledger: CanonLedger): SourceArchiveSummary {
  return {
    characters: ledger.entities.filter((entity) => entity.type === "character").length,
    places: ledger.entities.filter((entity) => entity.type === "place").length,
    events: ledger.events.length,
    unknowns: ledger.unresolvedQuestions.length,
    evidence: ledger.sourceCoverage.evidenceCount,
  };
}

export function createDefaultAdaptationPlan(
  ledger: CanonLedger,
  mode: AdaptationPlan["mode"] = "faithful",
): AdaptationPlan {
  const lockedFacts = [
    ...ledger.entities
      .filter((entity) => entity.status === "source_confirmed" || entity.status === "player_note")
      .map((entity) => `${entity.name}: ${entity.description}`),
    ...ledger.events
      .filter((event) => event.status === "source_confirmed" || event.status === "player_note")
      .map((event) => `${event.title}: ${event.description}`),
    ...ledger.worldRules
      .filter((rule) => rule.status === "source_confirmed" || rule.status === "player_note")
      .map((rule) => `${rule.title}: ${rule.description}`),
  ].filter((fact) => fact.trim().length > 0);

  const forbiddenInventions = ledger.unresolvedQuestions.map(
    (unknown) => `不得把未知项写成已确认事实：${unknown.question}`,
  );

  return {
    mode,
    playablePremise: ledger.summary,
    lockedFacts,
    allowedInventions:
      mode === "faithful"
        ? ["只能补充场景过渡、可调查线索的呈现方式、玩家初始入口等低风险桥接内容。"]
        : ["可以补充可玩性所需的场景、线索和人物行动，但必须标记为 generated_bridge。"],
    forbiddenInventions,
    bridgeContent: [],
  };
}

function splitParagraphs(content: string): Array<{ start: number; end: number; text: string }> {
  const parts = content.split(/(\r?\n\s*\r?\n)/);
  const paragraphs: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;

  for (const part of parts) {
    const start = offset;
    const end = offset + part.length;
    offset = end;
    if (!part.trim()) continue;

    const leading = part.length - part.trimStart().length;
    const trailing = part.length - part.trimEnd().length;
    const textStart = start + leading;
    const textEnd = end - trailing;
    paragraphs.push({
      start: textStart,
      end: textEnd,
      text: content.slice(textStart, textEnd),
    });
  }

  if (paragraphs.length === 0 && content.length > 0) {
    return [{ start: 0, end: content.length, text: content }];
  }
  return paragraphs;
}

function detectCorpusLanguage(text: string): SourceLanguage {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (cjk > 0 && latin > Math.max(20, cjk * 0.2)) return "mixed";
  if (cjk >= latin) return "zh-CN";
  return "en";
}

function isCanonEntityLike(value: unknown): value is CanonEntity {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.description === "string" &&
    isCanonStatus(value.status) &&
    Array.isArray(value.evidenceRefs)
  );
}

function isCanonEventLike(value: unknown): value is CanonEvent {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    typeof value.order === "number" &&
    isCanonStatus(value.status) &&
    Array.isArray(value.evidenceRefs) &&
    Array.isArray(value.involvedEntities)
  );
}

function isCanonUnknownLike(value: unknown): value is CanonUnknown {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.question) &&
    Array.isArray(value.relatedEntities) &&
    Array.isArray(value.evidenceRefs)
  );
}

function isSourceSpan(value: unknown): value is EvidenceAtom["sourceSpan"] {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeNumber(value.start) &&
    isNonNegativeNumber(value.end) &&
    value.end >= value.start &&
    typeof value.excerpt === "string"
  );
}

function isEvidenceCategory(value: unknown): value is EvidenceCategory {
  return typeof value === "string" && EVIDENCE_CATEGORIES.has(value as EvidenceCategory);
}

function isCanonStatus(value: unknown): value is CanonStatus {
  return typeof value === "string" && CANON_STATUSES.has(value as CanonStatus);
}

function isSourceDocument(value: unknown): value is SourceDocument {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    isSourceDocumentKind(value.kind) &&
    typeof value.content === "string" &&
    isNonNegativeNumber(value.createdAt)
  );
}

function isSourceDocumentKind(value: unknown): value is SourceDocumentKind {
  return value === "pasted_text" || value === "player_note" || value === "imported_text";
}

function isSourceLanguage(value: unknown): value is SourceLanguage {
  return value === "zh-CN" || value === "en" || value === "mixed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
