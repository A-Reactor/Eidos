// ============================================================
// Eidos · Meta reality artifact helpers
// ============================================================

import type {
  BoundaryEvent,
  MetaChannelManifest,
  RealityArtifact,
  RealityArtifactKind,
  RealityConsentScope,
} from "./types";

export interface CreateRealityArtifactInput {
  kind: RealityArtifactKind;
  label: string;
  summary: string;
  sourceExcerpt?: string;
  scope?: RealityConsentScope;
  visibleTo?: string[];
  introducedAtWorldLineNodeId: string;
  creatorIntent?: string;
  safetyNotes?: string[];
  createdAt?: number;
}

export interface BuildBoundaryEventInput {
  type: BoundaryEvent["type"];
  actor: BoundaryEvent["actor"];
  artifactId?: string;
  worldLineNodeId: string;
  visibleConsequences?: string[];
  hiddenAudit?: string[];
  createdAt?: number;
}

export interface BuildMetaRealityPromptContextInput {
  artifacts?: RealityArtifact[];
  boundaryEvents?: BoundaryEvent[];
  manifest?: MetaChannelManifest | null;
  maxArtifacts?: number;
  maxEvents?: number;
}

/** Strip local directory segments before a label can enter AI-visible context. */
export function redactRealityLabel(label: string): string {
  const normalized = label.trim().replace(/\\/g, "/");
  if (!normalized) return "现实材料";
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1)?.trim() || "现实材料";
}

export function createRealityArtifact(input: CreateRealityArtifactInput): RealityArtifact {
  const createdAt = input.createdAt ?? Date.now();
  const scope = input.scope ?? "summary_only";
  const sourceExcerpt = scope === "full_text" ? input.sourceExcerpt?.trim() : undefined;

  return {
    id: `ra_${createdAt}_${stableSlug(input.kind)}_${randomSuffix()}`,
    kind: input.kind,
    label: redactRealityLabel(input.label),
    consent: {
      grantedAt: createdAt,
      scope,
      revocable: true,
    },
    summary: input.summary.trim(),
    sourceExcerpt: sourceExcerpt || undefined,
    visibleTo: [...(input.visibleTo ?? [])],
    introducedAtWorldLineNodeId: input.introducedAtWorldLineNodeId,
    creatorIntent: input.creatorIntent?.trim() || undefined,
    safetyNotes: [...(input.safetyNotes ?? [])],
    createdAt,
  };
}

export function buildBoundaryEvent(input: BuildBoundaryEventInput): BoundaryEvent {
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: `be_${createdAt}_${stableSlug(input.type)}_${randomSuffix()}`,
    type: input.type,
    actor: input.actor,
    artifactId: input.artifactId,
    worldLineNodeId: input.worldLineNodeId,
    visibleConsequences: [...(input.visibleConsequences ?? [])],
    hiddenAudit: [...(input.hiddenAudit ?? [])],
    createdAt,
  };
}

export function buildMetaRealityPromptContext(
  input: BuildMetaRealityPromptContextInput,
): string {
  const artifacts = (input.artifacts ?? []).slice(-(input.maxArtifacts ?? 6));
  const events = (input.boundaryEvents ?? []).filter(isNarrativeBoundaryEvent).slice(-(input.maxEvents ?? 6));
  const manifest = input.manifest ?? null;
  if (artifacts.length === 0 && events.length === 0 && !manifest) return "";

  const lines = [
    "## 现实边界材料（玩家主动授权）",
    "这些材料来自玩家明确交给世界的现实边界材料或边界事件。不要声称读取了未列出的文件、路径、桌面、源码或系统信息。",
  ];

  if (artifacts.length > 0) {
    lines.push("", "### RealityArtifact");
    for (const artifact of artifacts) {
      const excerpt =
        artifact.consent.scope === "full_text" && artifact.sourceExcerpt
          ? `；全文摘录：${artifact.sourceExcerpt.slice(0, 800)}`
          : "";
      const visibleTo =
        artifact.visibleTo.length > 0 ? `；可见对象：${artifact.visibleTo.join("、")}` : "";
      lines.push(
        `- ${artifact.label} [${artifact.kind}/${artifact.consent.scope}]：${artifact.summary}${visibleTo}${excerpt}`,
      );
    }
  }

  if (manifest) {
    lines.push("", "### MetaChannelManifest");
    lines.push(`- ${manifest.title} [${manifest.tone}]`);
    if (manifest.channels.length > 0) {
      for (const channel of manifest.channels.slice(0, 6)) {
        lines.push(
          `  - ${channel.id} [${channel.kind}]：${channel.worldInterpretation}；拒绝时：${channel.refusalFallback}`,
        );
      }
    }
    if (manifest.forbiddenMoves.length > 0) {
      lines.push(`- 禁止写法：${manifest.forbiddenMoves.join("；")}`);
    }
  }

  if (events.length > 0) {
    lines.push("", "### BoundaryEvent");
    for (const event of events) {
      const consequence =
        event.visibleConsequences.length > 0
          ? event.visibleConsequences.join("；")
          : "无可见后果";
      lines.push(`- ${event.type} by ${event.actor}：${consequence}`);
    }
  }

  return lines.join("\n");
}

/** Host file/archive operations are technical metadata, never character evidence. */
export function isNarrativeBoundaryEvent(event:BoundaryEvent):boolean {
  return !['snapshot_restored','file_imported','file_exported'].includes(event.type);
}

function stableSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").slice(0, 32) || "item";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
