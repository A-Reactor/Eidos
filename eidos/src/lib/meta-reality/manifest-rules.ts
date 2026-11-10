// ============================================================
// Eidos · Meta channel manifest runtime rules
// ============================================================

import { buildBoundaryEvent, redactRealityLabel } from "./artifacts";
import type {
  BoundaryEvent,
  MetaChannelManifest,
  RealityArtifact,
} from "./types";

type MetaChannel = MetaChannelManifest["channels"][number];

export interface EvaluateRealityArtifactAgainstManifestInput {
  artifact: RealityArtifact;
  manifest?: MetaChannelManifest | null;
  /** 当前可能接触材料的角色/系统对象。为空时只按材料类型判定。 */
  requestedConsumers?: string[];
}

export type MetaChannelEvaluation =
  | {
      allowed: true;
      manifestId: string | null;
      channel: MetaChannel | null;
      visibleTo: string[];
      promptRule: string;
      reason: string;
      forbiddenMoves: string[];
    }
  | {
      allowed: false;
      manifestId: string | null;
      channel: MetaChannel | null;
      visibleTo: string[];
      reason: string;
      refusalFallback: string;
      hiddenAudit: string[];
      forbiddenMoves: string[];
    };

export interface BuildMetaChannelDeniedBoundaryEventInput {
  artifact: RealityArtifact;
  evaluation: Extract<MetaChannelEvaluation, { allowed: false }>;
  worldLineNodeId: string;
  createdAt?: number;
}

export function evaluateRealityArtifactAgainstManifest(
  input: EvaluateRealityArtifactAgainstManifestInput,
): MetaChannelEvaluation {
  const artifact = input.artifact;
  const manifest = input.manifest ?? null;
  const artifactVisibleTo = cleanList(artifact.visibleTo);
  const requestedConsumers = cleanList(input.requestedConsumers);

  if (!manifest) {
    return {
      allowed: true,
      manifestId: null,
      channel: null,
      visibleTo: artifactVisibleTo,
      promptRule: "玩家主动拖入的现实边界材料；AI 只能读取安全摘要，不能发明未授权现实能力。",
      reason: "no_manifest_default_allow",
      forbiddenMoves: [],
    };
  }

  const forbiddenMoves = cleanList(manifest.forbiddenMoves);
  const channels = manifest.channels.filter((channel) => channel.kind === artifact.kind);
  if (channels.length === 0) {
    return deny({
      artifact,
      manifest,
      channel: null,
      visibleTo: [],
      reason: `MetaChannelManifest「${manifest.title}」未声明 ${artifact.kind} 通道。`,
      refusalFallback: `当前世界不接受 ${artifact.kind} 类型的现实边界材料。`,
      forbiddenMoves,
    });
  }

  const channel = channels.find((candidate) =>
    canReachRequestedConsumers(candidate, requestedConsumers, artifactVisibleTo),
  );
  if (!channel) {
    return deny({
      artifact,
      manifest,
      channel: channels[0],
      visibleTo: [],
      reason: "当前对象不在通道允许名单。",
      refusalFallback: channels[0]?.refusalFallback || "现实边界材料没有找到可接收对象。",
      forbiddenMoves,
    });
  }

  const visibleTo = resolveVisibleTo(artifactVisibleTo, channel);
  return {
    allowed: true,
    manifestId: manifest.id,
    channel,
    visibleTo,
    promptRule: [
      `通道 ${channel.id} 已授权。`,
      `世界内解释：${channel.worldInterpretation}`,
      channel.consequenceTemplate ? `后果模板：${channel.consequenceTemplate}` : "",
      forbiddenMoves.length > 0 ? `禁止写法：${forbiddenMoves.join("；")}` : "",
    ].filter(Boolean).join(" "),
    reason: "manifest_channel_allowed",
    forbiddenMoves,
  };
}

export function buildMetaChannelDeniedBoundaryEvent(
  input: BuildMetaChannelDeniedBoundaryEventInput,
): BoundaryEvent {
  const artifactLabel = redactRealityLabel(input.artifact.label);
  const evaluation = input.evaluation;
  const reason = evaluation.reason;
  const fallback = evaluation.refusalFallback;
  const manifestId = evaluation.manifestId ?? "none";
  const channelId = evaluation.channel?.id ?? "none";

  return buildBoundaryEvent({
    type: "permission_denied",
    actor: "creator_rule",
    artifactId: input.artifact.id,
    worldLineNodeId: input.worldLineNodeId,
    visibleConsequences: [
      `现实边界材料「${artifactLabel}」被边界通道拒绝：${fallback}`,
    ],
    hiddenAudit: [
      `manifest=${manifestId}; channel=${channelId}; kind=${input.artifact.kind}; reason=${reason}`,
    ],
    createdAt: input.createdAt,
  });
}

function deny(input: {
  artifact: RealityArtifact;
  manifest: MetaChannelManifest;
  channel: MetaChannel | null;
  visibleTo: string[];
  reason: string;
  refusalFallback: string;
  forbiddenMoves: string[];
}): MetaChannelEvaluation {
  return {
    allowed: false,
    manifestId: input.manifest.id,
    channel: input.channel,
    visibleTo: input.visibleTo,
    reason: input.reason,
    refusalFallback: input.refusalFallback,
    forbiddenMoves: input.forbiddenMoves,
    hiddenAudit: [
      `manifest=${input.manifest.id}; kind=${input.artifact.kind}; reason=${input.reason}`,
    ],
  };
}

function canReachRequestedConsumers(
  channel: MetaChannel,
  requestedConsumers: string[],
  artifactVisibleTo: string[],
): boolean {
  const allowedConsumers = cleanList(channel.allowedConsumers);
  if (allowedConsumers.length === 0) return true;
  if (requestedConsumers.length > 0) {
    return requestedConsumers.some((consumer) => allowedConsumers.includes(consumer));
  }
  if (artifactVisibleTo.length > 0) {
    return artifactVisibleTo.some((consumer) => allowedConsumers.includes(consumer));
  }
  return true;
}

function resolveVisibleTo(artifactVisibleTo: string[], channel: MetaChannel): string[] {
  const allowedConsumers = cleanList(channel.allowedConsumers);
  if (allowedConsumers.length === 0) return artifactVisibleTo;
  if (artifactVisibleTo.length === 0) return allowedConsumers;
  return artifactVisibleTo.filter((consumer) => allowedConsumers.includes(consumer));
}

function cleanList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}
