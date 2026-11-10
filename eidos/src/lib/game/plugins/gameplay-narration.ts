import type { WorldSnapshot } from '../types';
import type { NarrativeRequest } from '../narrative';
import type { AIGameResponse } from '@/lib/ai/types';
import { gameplayContextForModel } from './gameplay-state';
import { stableRecordJSON } from '@/lib/ai/prompt-layout';

export function gameplayResultForRequest(snapshot: WorldSnapshot | undefined, request: NarrativeRequest) {
  const contexts = snapshot?.gameplayModState ? gameplayContextForModel(snapshot.gameplayModState) : snapshot?.gameplayContext ?? [];
  const result = contexts.find(item => item.pluginId === request.result?.pluginId && item.result.id === request.result?.id);
  if (!result) throw new Error('续写引用的玩法结果不属于当前进度');
  return result;
}
export function gameplayNarrationPrompt(snapshot: WorldSnapshot | undefined, request: NarrativeRequest): string {
  const result = gameplayResultForRequest(snapshot, request);
  return `\n## 承接已确认的玩法结果\n${stableRecordJSON(result)}\n以上结果已由玩法运行时接受并记录，不是玩家的猜测或尚未判定的尝试。本次只写现场表现、对话与人物反应，必须承认已确认的事实；角色可以有情绪和立场，但不能撤销该结果。不要重新判定操作成败，不重复消耗资源、触发规则、增加物品或改写世界状态。正文结束可以留下后续行动空间，新的实际后果留给下一次行动。`;
}
/** A prose retry is not another gameplay action, even if a model returns update fields. */
export function protectGameplayNarration(response: AIGameResponse, snapshot: WorldSnapshot | undefined, request: NarrativeRequest): AIGameResponse {
  const result = gameplayResultForRequest(snapshot, request);
  return { ...response, _gameplayResult: { pluginId: result.pluginId, id: result.result.id },
    validity: { isPossible: true, reason: null, fantasyResponse: null }, summary: result.result.summary,
    narrativeFrame: { kind: 'protagonist' }, segments: response.segments.map(segment => ({ ...segment, view: { kind: 'protagonist' } })),
    timeSpent: { day: 0, hour: 0, minute: 0 }, timeAfter: snapshot?.currentGameTime,
    sceneChanges: [], mapUpdates: undefined, discoveredSecrets: [], npcsReacted: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [], worldImpacts: [],
    pluginEvents: [], cardVariableUpdates: [], criticalFactsDiscovered: [], questsDiscovered: [], encyclopediaUpdates: [], encyclopediaDeletions: [],
    relationshipUpdates: [], itemValueUpdates: [], protagonistStateUpdate: undefined, timelineDeviation: undefined, personalityObservations: undefined, npcSpeechProfiles: undefined,
    sandboxToolRequests: [], reviewRequest: undefined };
}
