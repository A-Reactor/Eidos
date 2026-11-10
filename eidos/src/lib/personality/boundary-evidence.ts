// ============================================================
// Eidos · Meta-reality boundary evidence for personality runtime
// ============================================================

import type { PersonalityObservations } from "@/lib/ai/types";
import type { BoundaryEvent, RealityArtifact } from "@/lib/meta-reality/types";
import type { RealityOfferingRecord } from "@/lib/meta-reality/offering-files";
import { isNarrativeBoundaryEvent } from '@/lib/meta-reality/artifacts';

export interface BoundaryEvidenceInput {
  event: BoundaryEvent;
  artifact?: RealityArtifact;
  npcNames: string[];
}

export interface BoundaryEvidenceInferenceInput {
  playerInput: string;
  playerInputIsMetagaming: true;
  observations: PersonalityObservations;
}

export function buildBoundaryEventPersonalityObservations(
  input: BoundaryEvidenceInput,
): PersonalityObservations {
  if(!isNarrativeBoundaryEvent(input.event)) return {};
  const npcNames = uniqueNames(input.npcNames);
  if (npcNames.length === 0) return {};

  const label = boundaryEvidenceLabel(input.event, input.artifact);
  const eventSummary = buildEventSummary(input.event, input.artifact);

  return {
    npcsInvolved: npcNames.map((npcName) => ({
      npcName,
      reaction: `注意到${label}以非世界内常规路径改变了现场。`,
      emotion: "警觉",
      touchesCoreConcern: true,
    })),
    memoryWorthyEvents: npcNames.map((npcName) => ({
      npcName,
      event: eventSummary,
      importanceHint: "high" as const,
      emotion: "警觉",
    })),
  };
}

export function buildBoundaryEvidenceInference(input: {
  records: RealityOfferingRecord[];
  npcNames: string[];
}): BoundaryEvidenceInferenceInput {
  const records = input.records.filter((record) => record.artifact && record.event && isNarrativeBoundaryEvent(record.event));
  const labels = records.map((record) => record.artifact.label);
  const observations = mergeObservations(
    records.map((record) =>
      buildBoundaryEventPersonalityObservations({
        event: record.event,
        artifact: record.artifact,
        npcNames: input.npcNames,
      }),
    ),
  );

  return {
    playerInput: labels.length > 0
      ? `现实边界材料进入世界：${labels.join("、")}。`
      : "现实边界材料进入世界。",
    playerInputIsMetagaming: true,
    observations,
  };
}

function buildEventSummary(event: BoundaryEvent, artifact?: RealityArtifact): string {
  const label = artifact?.label ?? event.artifactId ?? "未知边界材料";
  const intent = artifact?.creatorIntent ? `玩家意图：${artifact.creatorIntent}。` : "";
  const consequence = event.visibleConsequences[0] ?? `现实边界材料「${label}」进入世界边界。`;
  if (event.type === "permission_denied") {
    return `现实边界通道拒绝了一次越界尝试。${consequence}`;
  }
  if (event.type === "window_closed") {
    return `游戏窗口边界发生异常。${consequence}`;
  }
  return `现实边界材料「${label}」进入世界。${intent}${consequence}`;
}

function boundaryEvidenceLabel(event: BoundaryEvent, artifact?: RealityArtifact): string {
  if (event.type === "permission_denied") return "现实边界拒绝";
  if (event.type === "window_closed") return "游戏窗口边界事件";
  return `现实边界材料「${artifact?.label ?? event.artifactId ?? "未知边界材料"}」`;
}

function mergeObservations(observations: PersonalityObservations[]): PersonalityObservations {
  return {
    npcsInvolved: observations.flatMap((item) => item.npcsInvolved ?? []),
    memoryWorthyEvents: observations.flatMap((item) => item.memoryWorthyEvents ?? []),
    npcInteractions: observations.flatMap((item) => item.npcInteractions ?? []),
  };
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}
