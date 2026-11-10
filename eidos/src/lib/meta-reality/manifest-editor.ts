import { filePath } from '@/lib/game/workspace/paths';
import type { WorkspaceGrant } from './types';
import type {
  MetaChannelManifest,
  RealityArtifactKind,
} from "@/lib/meta-reality/types";

export const META_MANIFEST_TONES = [
  "gentle",
  "mysterious",
  "horror",
  "comedic",
  "tragic",
] as const satisfies readonly MetaChannelManifest["tone"][];

export const META_CHANNEL_KINDS = [
  "text",
  "image",
  "audio",
  "file_name",
  "folder_drop",
  "time",
  "window_event",
  "player_oath",
] as const satisfies readonly RealityArtifactKind[];

type ManifestChannel = MetaChannelManifest["channels"][number];

interface ManifestDefaults {
  worldName?: string | null;
  now?: number;
}

export function createDefaultMetaChannelManifest(
  defaults: ManifestDefaults = {},
): MetaChannelManifest {
  const worldName = normalizeText(defaults.worldName) || "这个世界";
  const now = defaults.now ?? Date.now();
  return {
    id: `manifest_${now}`,
    title: `${worldName}边界通道`,
    tone: "mysterious",
    channels: [createDefaultMetaChannel()],
    forbiddenMoves: [
      "读取玩家未主动提交的本地文件",
      "伪装成系统、安全软件或真实外部服务",
      "要求玩家执行会破坏设备或泄露隐私的操作",
    ],
  };
}

export function createDefaultMetaChannel(index = 1): ManifestChannel {
  const suffix = index <= 1 ? "" : `_${index}`;
  return {
    id: `reality_offering${suffix}`,
    kind: "text",
    promptToPlayer: "将资料存入文档库，在行动输入框选择引用并发送要求。",
    worldInterpretation: "玩家引用的材料由已声明通道解释；只有明确的行动与获准文件效果改变世界。",
    allowedConsumers: ["ALICE", "UZQ"],
    consequenceTemplate: "角色意识到这份材料来自屏幕外，并以世界内可见的方式回应。",
    refusalFallback: "材料没有通过边界通道，角色只能感到一阵含混的干扰。",
  };
}

export function normalizeMetaChannelManifest(
  input: unknown,
  defaults: ManifestDefaults = {},
): MetaChannelManifest {
  const fallback = createDefaultMetaChannelManifest(defaults);
  if (!isRecord(input)) return fallback;

  const title = normalizeText(input.title) || fallback.title;
  const tone = isMetaTone(input.tone) ? input.tone : fallback.tone;
  const channels = Array.isArray(input.channels)
    ? input.channels
      .map((channel, index) => normalizeChannel(channel, index))
      .filter((channel): channel is ManifestChannel => Boolean(channel))
    : fallback.channels;
  const forbiddenMoves = normalizeStringList(input.forbiddenMoves);

  return {
    id: normalizeText(input.id) || fallback.id,
    title,
    tone,
    channels: channels.length > 0 ? channels : fallback.channels,
    forbiddenMoves: forbiddenMoves.length > 0 ? forbiddenMoves : fallback.forbiddenMoves,
  };
}

function normalizeChannel(input: unknown, index: number): ManifestChannel | null {
  if (!isRecord(input)) return null;
  const fallback = createDefaultMetaChannel(index + 1);
  return {
    id: normalizeText(input.id) || `channel_${index + 1}`,
    kind: isMetaChannelKind(input.kind) ? input.kind : fallback.kind,
    promptToPlayer: normalizeText(input.promptToPlayer),
    worldInterpretation: normalizeText(input.worldInterpretation),
    allowedConsumers: normalizeStringList(input.allowedConsumers),
    ...(input.workspaceGrants !== undefined ? { workspaceGrants: parseWorkspaceGrants(input.workspaceGrants, normalizeStringList(input.allowedConsumers)) } : {}),
    consequenceTemplate: normalizeText(input.consequenceTemplate),
    refusalFallback: normalizeText(input.refusalFallback),
  };
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMetaTone(value: unknown): value is MetaChannelManifest["tone"] {
  return typeof value === "string" && META_MANIFEST_TONES.includes(value as any);
}

function isMetaChannelKind(value: unknown): value is RealityArtifactKind {
  return typeof value === "string" && META_CHANNEL_KINDS.includes(value as any);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseWorkspaceGrants(value: unknown, consumers: string[]): WorkspaceGrant[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('文件授权列表无效');
  return value.map(raw => {
    if (!isRecord(raw) || typeof raw.mountId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(raw.mountId) || !Array.isArray(raw.npcIds) || !raw.npcIds.length || raw.npcIds.some(id => typeof id !== 'string' || !consumers.includes(id)) || !Array.isArray(raw.operations) || !raw.operations.length || raw.operations.some(op => !['read', 'write'].includes(op))) throw new Error('文件通道须声明有效的挂载、角色和操作');
    return { mountId: raw.mountId, pathPrefix: filePath(raw.pathPrefix), npcIds: [...new Set(raw.npcIds as string[])], operations: [...new Set(raw.operations as Array<'read' | 'write'>)] };
  });
}
