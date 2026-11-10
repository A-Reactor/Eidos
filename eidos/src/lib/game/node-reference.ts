import type { WorldLineNode } from './types';

export const NODE_REFERENCE_GUIDE = '节点序号指界面第 N 步（stepNumber），在当前经历链上定位，不是全树数组第 N 项。支持“第2步”“节点2”“5号节点”；“上一节点／上一个节点／上一步”指本次玩家输入开始时所在节点的父节点，保存本次行动不会改变这个基准。能力条件有依据且目标明确时，可以直接提交 [BACKTRACK:第2步] 或 [BACKTRACK:上一节点]，程序解析真实 ID 后仍检查能力、祖先链和快照，不必让玩家抄写完整编号。需要核对时先只输出 historyRequest: {"target":"第2步"} 或 {"target":"上一节点"}；若有多个候选，用时间、地点、经历内容区分，无法确定时请玩家澄清，不能任选一个。已知真实 ID 时继续使用真实 ID。此定位规则优先于旧指南中一律要求完整 ID 的表述，不授予回溯许可。';

export const nodeReferenceLabel = (node: WorldLineNode): string | undefined => node.label ?? node.summary.match(/\[LABEL:([^\]]{1,160})\]/)?.[1].trim();

/** References select only from the caller's scope; this helper grants no read or rewind permission. */
export function matchNodeReference(input: { nodes: readonly WorldLineNode[]; reference: string; relativeTo: WorldLineNode | null; preferredSceneIds?: ReadonlySet<string> }): WorldLineNode[] {
  const target = input.reference.trim();
  const exact = input.nodes.find(node => node.id === target);
  if (exact) return [exact];
  const normalized = target.normalize('NFKC').replace(/\s+/g, '').replace(/^(?:回溯到|跳转到|回到|返回)/, '');
  if (/^(?:上一(?:个)?节点|前一(?:个)?节点|上一步|前一步)$/.test(normalized)) {
    return input.nodes.filter(node => node.id === input.relativeTo?.parentId);
  }
  const step = normalized.match(/^(?:第)?(\d+)(?:步|号节点|号|个节点|节点)?$|^节点(\d+)(?:号)?$/);
  if (step) {
    const number = Number(step[1] ?? step[2]);
    return Number.isSafeInteger(number) ? input.nodes.filter(node => node.stepNumber === number) : [];
  }
  const labels = input.nodes.filter(node => nodeReferenceLabel(node) === target);
  if (labels.length) return labels;
  const scenes = input.nodes.filter(node => node.sceneName === target);
  const preferred = scenes.filter(node => input.preferredSceneIds?.has(node.id));
  return preferred.length ? preferred : scenes;
}

/** Candidate descriptions exclude generated prose and undiscovered knowledge. */
export function describeHistoryNode(node: WorldLineNode) {
  return { nodeId: node.id, parentId: node.parentId, stepNumber: node.stepNumber, gameTime: node.gameTime,
    sceneName: node.sceneName, playerInput: node.playerInput, hasSnapshot: Boolean(node.snapshotHash) };
}
