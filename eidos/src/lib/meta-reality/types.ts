// ============================================================
// Eidos · Meta reality boundary types
// ============================================================

export type RealityArtifactKind =
  | "text"
  | "image"
  | "audio"
  | "file_name"
  | "folder_drop"
  | "time"
  | "window_event"
  | "player_oath";

export type RealityConsentScope = "summary_only" | "full_text" | "metadata_only";

/** 玩家主动交给世界的现实材料。 */
export interface RealityArtifact {
  id: string;
  kind: RealityArtifactKind;
  /** 展示给 AI/玩家的脱敏标签，不能包含本地路径。 */
  label: string;
  consent: {
    grantedAt: number;
    scope: RealityConsentScope;
    revocable: true;
  };
  /** 安全摘要。默认只允许 AI 读取这一层。 */
  summary: string;
  /** 仅在玩家明确允许 full_text 时保留的短摘录。 */
  sourceExcerpt?: string;
  visibleTo: string[];
  introducedAtWorldLineNodeId: string;
  creatorIntent?: string;
  safetyNotes: string[];
  createdAt: number;
}

export interface WorkspaceGrant { mountId: string; pathPrefix: string; npcIds: string[]; operations: Array<'read' | 'write'> }

/** 创作者声明的现实/游戏边界通道。AI 只能使用 manifest 中已声明的通道。 */
export interface MetaChannelManifest {
  id: string;
  title: string;
  tone: "gentle" | "mysterious" | "horror" | "comedic" | "tragic";
  channels: Array<{
    id: string;
    kind: RealityArtifactKind;
    promptToPlayer: string;
    worldInterpretation: string;
    allowedConsumers: string[];
    workspaceGrants?: WorkspaceGrant[];
    consequenceTemplate: string;
    refusalFallback: string;
  }>;
  forbiddenMoves: string[];
}

/** 现实与游戏边界发生过的可审计事件。 */
export interface BoundaryEvent {
  id: string;
  type:
    | "artifact_introduced"
    | "artifact_revoked"
    | "window_closed"
    | "snapshot_restored"
    | "file_exported"
    | "file_imported"
    | "permission_denied";
  actor: "player" | "system" | "character" | "creator_rule";
  artifactId?: string;
  worldLineNodeId: string;
  visibleConsequences: string[];
  /** 仅导出/审计使用，不进入 ALICE 可见 prompt。 */
  hiddenAudit: string[];
  createdAt: number;
}

export interface MetaRealityState {
  realityArtifacts: RealityArtifact[];
  boundaryEvents: BoundaryEvent[];
  metaChannelManifest: MetaChannelManifest | null;
}
