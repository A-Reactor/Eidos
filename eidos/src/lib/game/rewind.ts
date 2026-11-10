import type { WorldDefinition, WorldLineNode } from './types';
import { getReadingPath } from './player-reading';
import { INITIAL_WORLD_OBSERVATION } from './world-entry';
import { describeHistoryNode, matchNodeReference, nodeReferenceLabel } from './node-reference';

export interface RewindMemory {
  version: 1;
  count: number;
  sourceNodeIds: string[];
  digest: string;
  last: { from: string; to: string; reason: string };
}
export interface RewindPolicy {
  enabled: boolean;
  anchorLabels: string[];
  anchorScene?: string;
  requires: Record<string, boolean>;
  maxChars: number;
  recentFullNodes: number;
}
/** 发现标记随世界恢复，亲历记忆的知情范围需要独立说明。 */
export const REWIND_KNOWLEDGE_RULE = '主角可使用明确保留的回溯亲历见闻，包括据此提出推荐行动；当前线索尚未发现或秘密未解锁的标记，不抹去这部分已有记忆。此例外仅限保留摘要或允许读取的亲历原文实际支持的内容；玩家自称记得不构成证据，未感知的秘密含义、未经历旁支和旁观秘密仍受禁止泄露约束。记得某人说过什么不等于该说法客观为真，当时的猜测、谎言与不确定性继续保留。主角记忆不会自动成为 NPC 的知识，也不代表当前世界已经发生同样的事或物品仍在背包中；当前地点、物品、人物与已发生事件以恢复后的状态为准。';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bounded = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;

/** Legacy loop worlds opt in too; a branch-management guide alone grants no ability. */
export function rewindPolicy(world?: Pick<WorldDefinition, 'gameModeConfig' | 'gameplayPlugins'> | null): RewindPolicy | null {
  const config = world?.gameModeConfig ?? {}, raw = config.rewind;
  if (raw === undefined && !config.loopAnchorNodeLabel && !config.loopAnchorScene && !world?.gameplayPlugins?.some(p => p.id === 'loop-manager')) return null;
  const options = object(raw) ? raw : {}, memory = object(options.memory) ? options.memory : {};
  const valid = (raw === undefined || object(raw)) && (options.enabled === undefined || typeof options.enabled === 'boolean') &&
    (options.anchorLabels === undefined || Array.isArray(options.anchorLabels) && options.anchorLabels.every(s => typeof s === 'string' && !!s.trim())) &&
    (options.requires === undefined || object(options.requires) && Object.values(options.requires).every(v => typeof v === 'boolean'));
  const labels = Array.isArray(options.anchorLabels) ? options.anchorLabels.filter((s): s is string => typeof s === 'string' && !!s.trim()) : config.loopAnchorNodeLabel ? [String(config.loopAnchorNodeLabel)] : [];
  const builtinGate = world?.gameplayPlugins?.some(p => p.id === 'loop-manager' && p.rules.some(r => r.id === 'allow-rewind'));
  return { enabled: valid && options.enabled !== false, anchorLabels: labels, anchorScene: typeof config.loopAnchorScene === 'string' ? config.loopAnchorScene : undefined,
    requires: object(options.requires) ? Object.fromEntries(Object.entries(options.requires).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : builtinGate ? { 'gameplay.loop-manager.ready': true } : {},
    maxChars: bounded(memory.maxChars, 12000, 1000, 40000), recentFullNodes: bounded(memory.recentFullNodes, 2, 0, 8) };
}
export function rewindTargets(world: WorldDefinition | null, nodes: Record<string, WorldLineNode>, currentId: string | null): WorldLineNode[] {
  const policy = rewindPolicy(world);
  if (!policy?.enabled) return [];
  return getReadingPath(nodes, currentId).slice(0, -1).filter(n => !!n.snapshotHash);
}
/** Marks help the model locate history; they do not grant or withhold the ability. */
export function rewindAnchors(world: WorldDefinition | null, nodes: Record<string, WorldLineNode>, currentId: string | null): WorldLineNode[] {
  const policy = rewindPolicy(world);
  if (!policy?.enabled) return [];
  const path = getReadingPath(nodes, currentId).slice(0, -1);
  // Existing worlds often declare their opening scene as an anchor but omit LABEL on observation.
  // Bind only the first observation, never every later visit to that place.
  const opening = path.find(n => n.playerInput === INITIAL_WORLD_OBSERVATION);
  return path.filter(n => !!n.snapshotHash &&
    (policy.anchorLabels.includes(rewindNodeLabel(n) ?? '') || n.id === opening?.id && policy.anchorLabels.includes(n.sceneName) ||
      n.parentId === null && !!policy.anchorScene && n.sceneId === policy.anchorScene));
}
export const rewindNodeLabel = nodeReferenceLabel;
/** Resolve references against real history; ability semantics belong to the story. */
export function resolveGameRewindTarget(input: { world: WorldDefinition | null; nodes: Record<string, WorldLineNode>; currentId: string | null; reference: string; relativeToNodeId?: string | null }): string {
  const { world, nodes, currentId, reference, relativeToNodeId = currentId } = input;
  const target = reference.trim();
  if (Object.hasOwn(nodes, target)) return target;
  const allowed = rewindTargets(world, nodes, currentId);
  const relativeTo = nodes[relativeToNodeId ?? ''] ?? null;
  const matches = matchNodeReference({ nodes: allowed, reference: target, relativeTo,
    preferredSceneIds: new Set(rewindAnchors(world, nodes, currentId).map(node => node.id)) });
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) throw new Error(`回溯目标不唯一，请按时间、地点或经历内容区分候选：${JSON.stringify(matches.slice(0, 8).map(describeHistoryNode))}。可用只读历史工具进一步核对，不要任选目标。`);
  throw new Error(`回溯目标不存在或不在已保存的过去经历中：${target.slice(0, 160)}。请检索历史原文核对目标；无需先补登记标签。`);
}
export function assertGameRewind(input: { world: WorldDefinition | null; nodes: Record<string, WorldLineNode>; currentId: string | null; flags: Record<string, boolean>; targetId: string; gameRequest?: boolean }): RewindPolicy {
  const policy = rewindPolicy(input.world);
  if (!policy || !input.gameRequest) throw new Error('回溯能力由游戏判断发动；这里可以回看经历，不会改变当前进度。');
  if (!policy.enabled) throw new Error('回溯能力已关闭或其发动条件配置无效');
  if (Object.entries(policy.requires).some(([key, value]) => Boolean(Object.prototype.hasOwnProperty.call(input.flags, key) && input.flags[key]) !== value)) throw new Error('当前尚未满足回溯能力的发动条件');
  if (!rewindTargets(input.world, input.nodes, input.currentId).some(n => n.id === input.targetId)) throw new Error('目标须是当前经历中有快照的过去节点');
  return policy;
}
export function parseRewindMemory(value: unknown): RewindMemory | null {
  if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.count) || Number(value.count) < 1 ||
    !Array.isArray(value.sourceNodeIds) || value.sourceNodeIds.some(id => typeof id !== 'string') || typeof value.digest !== 'string' || value.digest.length > 40000 ||
    !object(value.last) || ['from', 'to', 'reason'].some(k => typeof (value.last as Record<string, unknown>)[k] !== 'string')) return null;
  return structuredClone(value) as unknown as RewindMemory;
}
/** Shrink across the whole text instead of silently discarding the oldest loop. */
function compact(text: string, budget: number): string {
  const clean = text.replace(/[\t ]+/g, ' ').trim();
  if (clean.length <= budget) return clean;
  const chunks = (clean.match(/[^。！？.!?\n]*[。！？.!?\n]+|[^。！？.!?\n]+$/g) ?? []).filter(s => s.trim());
  if (chunks.length < 2) return clean.slice(0, Math.max(0, budget - 1)) + '…';
  const share = Math.max(1, Math.floor((budget - chunks.length) / chunks.length));
  const result = chunks.map(s => s.length <= share ? s : s.slice(0, share) + '…').join('');
  // Extremely many sentences are sampled over the entire span, including its end.
  if (result.length <= budget) return result;
  const count = Math.max(2, Math.floor(budget / 80)), size = Math.floor(budget / count) - 1;
  return Array.from({ length: count }, (_, i) => chunks[Math.round(i * (chunks.length - 1) / (count - 1))].slice(0, size) + '…').join('');
}
function compactBlock(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const split = text.indexOf('\n');
  if (split < 0) return compact(text, budget);
  const limit = Math.min(budget - 2, Math.max(20, Math.floor(budget / 2)));
  const header = text.slice(0, split), title = header.length > limit ? header.slice(0, Math.max(0, limit - 1)) + '…' : header;
  return title + '\n' + compact(text.slice(split + 1), Math.max(1, budget - title.length - 1));
}
export function buildRewindMemory(input: { previous?: RewindMemory | null; nodes: Record<string, WorldLineNode>; from: string; to: string; reason: string; policy: RewindPolicy }): RewindMemory {
  const path = getReadingPath(input.nodes, input.from), anchor = path.findIndex(n => n.id === input.to);
  const retained = (input.previous?.sourceNodeIds ?? []);
  const sourceNodeIds = [...new Set([...retained, ...path.slice(anchor + 1).filter(n => !n.summary.startsWith('[旁观剧情，主角未知]')).map(n => n.id)])];
  const available = sourceNodeIds.map(id => input.nodes[id]).filter(Boolean);
  const lines = available.map((node, index) => {
    const recent = index >= available.length - input.policy.recentFullNodes;
    // A reader-only cutaway cannot become the protagonist's remembered experience.
    const prose = node.aiResponse;
    return `第${node.stepNumber}步 · ${node.sceneName}｜${node.playerInput}\n${node.summary}\n${recent ? prose : compact(prose, 360)}`;
  });
  const inherited = sourceNodeIds.some(id => !input.nodes[id]) ? input.previous?.digest ?? '' : '';
  const blocks = [...(inherited ? [inherited] : []), ...lines];
  const recent = Math.min(input.policy.recentFullNodes, lines.length);
  const unit = Math.max(8, Math.floor((input.policy.maxChars - blocks.length * 2) / (blocks.length + recent * 2)));
  const packed = blocks.join('\n\n').length <= input.policy.maxChars ? blocks.join('\n\n')
    : blocks.map((text, index) => compactBlock(text, unit * (index >= blocks.length - recent ? 3 : 1))).join('\n\n');
  return { version: 1, count: (input.previous?.count ?? 0) + 1, sourceNodeIds,
    digest: compact(packed, input.policy.maxChars), last: { from: input.from, to: input.to, reason: input.reason.slice(0, 1000) } };
}
export function rewindMemoryPrompt(memory: unknown): string {
  const valid = parseRewindMemory(memory);
  return valid ? `\n## 主角保留的回溯经历（${valid.count}次）\n这是主角经历过的旧未来，已回到过去；其他人物、物品与世界并未随之保留。按世界设定表现明确记忆或模糊印象，不强制既视感。不能把旧未来当成本轮已发生的事实。摘要是有损压缩，过去亲历细节以只读检索的原文为准；当前世界状态以恢复后的快照为准。\n${valid.digest}` : '';
}
