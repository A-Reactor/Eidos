import type { AIGameResponse } from '@/lib/ai/types';
import type { GameStore } from '@/store/game-store';
import type { WorkspaceToolRequest } from './workspace/types';
import type { HistoryReadRequest } from './history-reader';
import type { PluginEvent } from './plugins/types';
import { evaluateGameplayEvents } from './plugins/runtime';
import { assertGameRewind, resolveGameRewindTarget } from './rewind';
import { loadBlob } from './cas-storage';
import { WEB_TOOL_PROTOCOL, type WebToolRequest } from './web-tools';
import type { NpcProfileProposal, NpcProfileChange, NpcProfileSource } from './npc-profile';

export type EngineToolRequest =
  | { method: 'gameplay.validate'; params: { events: PluginEvent[] } }
  | { method: 'worldline.backtrack'; params: { target: string; reason: string; events?: PluginEvent[] } };
export type ActionToolRequest = WorkspaceToolRequest | { method: 'history.read'; params: HistoryReadRequest } | EngineToolRequest | WebToolRequest | { method: 'npc.profile.update'; params: NpcProfileProposal };
export interface ActionOperationReceipt {
  method: string; status: 'completed' | 'staged' | 'failed' | 'denied'; operationId?: string;
  error?: string; result?: unknown;
  npcProfile?: NpcProfileChange;
  usage?: import('@/lib/ai/types').TokenUsage;
  backtrack?: { targetId: string; reason: string; events: PluginEvent[] };
}
export type EngineOperationSource = Pick<GameStore, 'currentWorld' | 'worldFlags' | 'gameplayResources' | 'allNodes' | 'currentNode'> & Partial<NpcProfileSource>;

/** Tools may prepare an ability in speculative generation; only an accepted node can launch it. */
export async function stageEngineOperation(request: EngineToolRequest, source?: EngineOperationSource): Promise<ActionOperationReceipt> {
  if (!source?.currentWorld) return { method: request.method, status: 'denied', error: '本次行动未提供游戏操作上下文' };
  try {
    const events = request.params.events ?? [];
    const transition = evaluateGameplayEvents(source.currentWorld, source.worldFlags, source.gameplayResources, events);
    if (request.method === 'gameplay.validate') return { method: request.method, status: 'completed', result: { events, flags: transition.flags, resources: transition.resources, applied: false } };
    const targetId = resolveGameRewindTarget({ world: source.currentWorld, nodes: source.allNodes, currentId: source.currentNode?.id ?? null, reference: request.params.target });
    assertGameRewind({ world: source.currentWorld, nodes: source.allNodes, currentId: source.currentNode?.id ?? null,
      flags: { ...source.worldFlags, ...transition.flags }, targetId, gameRequest: true });
    const hash = source.allNodes[targetId].snapshotHash;
    if (!hash || !await loadBlob(hash)) throw new Error('目标快照不可用，回溯未执行');
    return { method: request.method, status: 'staged', operationId: crypto.randomUUID(),
      result: { targetId, applied: false }, backtrack: { targetId, reason: request.params.reason, events: structuredClone(events) } };
  } catch (error) { return { method: request.method, status: 'failed', error: error instanceof Error ? error.message : '游戏操作校验失败' }; }
}

/** Convert selected real receipts to the established commit path; generated text grants no authority. */
export function selectActionOperations<T extends Partial<AIGameResponse>>(response: T, receipts: readonly ActionOperationReceipt[]): T & Partial<AIGameResponse> {
  if (response._npcProfileUpdates !== undefined) response = { ...response, _npcProfileUpdates: undefined };
  const ids = response.operationEffects;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 8 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)) throw new Error('游戏操作回执列表无效');
  const latestProfiles = new Map(receipts.filter(receipt => receipt.status === 'staged' && receipt.npcProfile).map(receipt => [receipt.npcProfile!.npcName, receipt]));
  if (response.operationOutcome !== 'failed' && response.fileOutcome !== 'failed' && [...latestProfiles.values()].some(receipt => !ids?.includes(receipt.operationId!))) throw new Error('人设变更已审核暂存，请在operationEffects选择真实operationId后再报告完成');
  if (ids === undefined) return response;
  const selected = ids.map(id => receipts.find(r => r.operationId === id && r.status === 'staged' && (r.backtrack || r.npcProfile)));
  if (selected.some(r => !r)) throw new Error('游戏操作没有本次成功暂存的真实回执');
  const rewinds = selected.filter(receipt => receipt?.backtrack), profiles = selected.flatMap(receipt => receipt?.npcProfile ? [receipt.npcProfile] : []);
  if (rewinds.length > 1) throw new Error('一次行动只能选择一次回溯');
  if (rewinds.length && profiles.length) throw new Error('回溯与人设修改请分开执行，避免修改随回溯丢失');
  if (profiles.length) return { ...response, operationEffects: undefined, _npcProfileUpdates: profiles };
  const backtrack = rewinds[0]?.backtrack;
  if (!backtrack) return { ...response, operationEffects: undefined };
  if (response.worldImpacts?.some(impact => impact.startsWith('[BACKTRACK:'))) throw new Error('回溯已通过操作回执申请，请勿重复提交旧标记');
  return { ...response, operationEffects: undefined,
    pluginEvents: [...response.pluginEvents ?? [], ...backtrack.events],
    worldImpacts: [...response.worldImpacts ?? [], `[BACKTRACK:${backtrack.targetId}] ${backtrack.reason}`] };
}

export const ACTION_TOOL_PROTOCOL = `## 统一行动操作
优先用 {"toolRequest":{"method":"工具名","params":{}}}，可与此前正常 segments 同时返回；文件工具也接受 actor。旧 workspaceRequest、historyRequest 仍兼容，一次只用一个入口。
回执提交位置：files.* 的写入回执放在对应 segments.workspaceEffects；npc.profile.update 与 worldline.backtrack 的回执放在顶层 operationEffects，两种列表不能互换。读取、搜索和预检的成功不是文件写入，也不生成可伪造的写入回执。
可用工具：files.list/search/read/write/patch/rename（参数与文件协议一致）；history.read（query/nodeId/target 三选一，可带 offset/view/presentationOffset）；web.search、web.open（公网只读）；gameplay.validate（events:[{pluginId,ruleId}]，只预检，不扣资源、不写状态）；worldline.backtrack（target、reason、可选 events 许可规则）。未列出的方法不可用，不能执行终端命令。
${WEB_TOOL_PROTOCOL}
人设修改使用真实工具，不演成找一位叫KEI的角色审批：{"toolRequest":{"method":"npc.profile.update","params":{"npcName":"真实已知人物名","description":"补充并合并后要保存的完整人物设定","reason":"本次玩家明确要求及依据"}}}。需要改说话方式时在params另附完整speechProfile。按玩家明确补充或改编要求提交；联网资料先实际搜索，不让角色的台词承认代替设定更新。宿主调用实际KEI审核，通过后返回staged回执；终局在operationEffects选择真实operationId，接受行动后才写入本分支人设和NPC资料。未收到真实批准回执不能声称已审核，失败按具体原因修正，不虚构场区、编号或额外授权条件。改已有言语档案也走此通道，npcSpeechProfiles仍只用于首次建档。
回溯工具先解析真实目标、检查作品能力与前提、验证快照，只返回暂存回执，不改变当前节点。收到 staged 后可在终局 operationEffects:[真实operationId] 选择该申请，宿主接受行动后再次校验并执行；不再同时填写 BACKTRACK 字符标记。没有回执或失败就不能声称已经到达。gameplay.validate 的成功只表示本次预检通过，最终仍用正常 pluginEvents 提议结算。
失败会如实交回本次行动，你可以继续思考、按错误重新读取资料、修正请求或如实结束。终局仍未完成的操作须返回 operationOutcome:"failed"（文件旧协议 fileOutcome:"failed" 也兼容），正文如实说明阻碍，不伪造完成。不重复完全相同的失败请求，不让玩家提供内部 ID，不虚构授权。文档读取、版本、关联或格式错误由你修正；取消、网络与存储故障不自动重试。资料查阅、文件修改和游戏操作的额度独立，所有工具与纠错仍有总续写上限；以回执中的剩余额度为准，接近上限请尽快给出真实结果。工具回合不结算世界状态。`;
