import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import type { GameTime } from './types';
import { gameplayNarrationPrompt, protectGameplayNarration } from './plugins/gameplay-narration';
import { parseNarrativeBeat, beatSegments } from './narrative-beat';

/** A camera describes the reader's view, independently of the protagonist's location. */
export interface NarrativeFrame {
  kind: 'protagonist' | 'cutaway';
  actor?: string;
  location?: string;
  timeLabel?: string;
}
export interface NarrativeRequest {
  kind: 'continue' | 'choice' | 'return' | 'result';
  frame?: NarrativeFrame;
  choice?: string;
  choiceId?: string;
  result?: { pluginId: string; id: string };
}
export interface NarrativeChoice { id: string; label: string }
function acceptedChoices(value: unknown): NarrativeChoice[] | undefined {
  if (!Array.isArray(value) || value.length > 32) return undefined;
  const ids = new Set<string>(), choices: NarrativeChoice[] = [];
  for (const item of value) {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 160 || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 160 || ids.has(item.id)) continue;
    ids.add(item.id); choices.push({ id: item.id, label: item.label });
  }
  return choices.length ? choices : undefined;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function label(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('叙事标签须为 1–160 字符');
  return value.trim();
}
export function parseNarrativeFrame(value: unknown): NarrativeFrame | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !['protagonist', 'cutaway'].includes(String(value.kind))) throw new Error('叙事视角无效');
  const actor = label(value.actor), location = label(value.location), timeLabel = label(value.timeLabel);
  return { kind: value.kind as NarrativeFrame['kind'], ...(actor ? { actor } : {}), ...(location ? { location } : {}), ...(timeLabel ? { timeLabel } : {}) };
}
export function parseNarrativeRequest(value: unknown): NarrativeRequest | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !['continue', 'choice', 'return', 'result'].includes(String(value.kind))) throw new Error('叙事请求无效');
  if (value.kind === 'result') {
    if (!object(value.result)) throw new Error('续写需要已确认的玩法结果');
    const pluginId = label(value.result.pluginId), id = label(value.result.id);
    if (!pluginId || !id) throw new Error('玩法结果引用无效');
    return { kind: 'result', result: { pluginId, id } };
  }
  const frame = parseNarrativeFrame(value.frame), choice = label(value.choice), choiceId = label(value.choiceId);
  if (value.kind === 'choice' && (!choice || frame?.kind === 'cutaway' && !frame.actor)) throw new Error('角色抉择需要选项与决策者');
  return { kind: value.kind as NarrativeRequest['kind'], ...(frame ? { frame } : {}), ...(choice ? { choice } : {}), ...(choiceId ? { choiceId } : {}) };
}
export function narrativeInput(request: NarrativeRequest): string {
  if (request.kind === 'result') return `承接已确认的玩法结果：${request.result?.pluginId}/${request.result?.id}，继续描写现场和人物反应。`;
  if (request.kind === 'return') return '继续故事：镜头回到主角，承接当前世界中主角自己的处境。';
  const actor = request.frame?.kind === 'cutaway' ? request.frame.actor ?? '旁观镜头' : '主角';
  const place = [request.frame?.location, request.frame?.timeLabel].filter(Boolean).join(' / ');
  const context = place ? `（${place}）` : '';
  return request.kind === 'choice' ? `剧情选择：${actor}${context}选择“${request.choice}”。` : `继续故事：承接${actor}${context}的当前剧情。`;
}
export const NARRATIVE_KNOWLEDGE_RULE = '\n## 阅读视角与角色知识\n标记为旁观剧情的历史是读者见过的世界事件，主角并未因此知道。角色只能在亲历、获告知或实际取得证据后使用这些信息；第三人称、异地镜头与过去片段不能自行移动主角或新增主角知识。';
export function narrativePrompt(request?: NarrativeRequest, snapshot?: import('./types').WorldSnapshot): string {
  if (!request) return '';
  if (request.kind === 'result') return gameplayNarrationPrompt(snapshot, request);
  return `\n## 本轮叙事请求\n${JSON.stringify(request)}\n这是读者推进故事或为指定角色选择，不是主角说出这句指令。每轮只用一个镜头，先返回 narrativeFrame，再返回 segments。可在 continue 时自然切换到有因果关联的异地/第三人称剧情；旁观镜头使用 kind=cutaway，actor 只在玩家确实能替该角色决策时填写，旁白镜头可省略 actor。choice 必须承接请求里的决策者与地点；return 必须回到主角。旁观剧情保留已经发生的世界后果，但主角的地点、时间、背包、关系、线索、百科、任务、人格观察和沙箱工具保持不变。主角未知的事实不要填入主角更新字段；模组规则事件仍按既有声明处理。镜头 location/timeLabel 是阅读标签。主角镜头用 kind=protagonist。`;
}
export function responseFrame(response: Pick<AIGameResponse, 'narrativeFrame' | 'segments'>, request?: NarrativeRequest): NarrativeFrame | undefined {
  if (request?.kind === 'return') return { kind: 'protagonist' };
  // An actor choice cannot be reassigned to the protagonist by a model response.
  if (request?.frame && request.kind === 'choice') return request.frame;
  try { return parseNarrativeFrame(response.narrativeFrame) ?? parseNarrativeFrame(response.segments?.map(s => s.view).find(Boolean)) ?? request?.frame; }
  catch { return request?.frame; }
}
export function frameSegments(segments: StorySegment[], frame?: NarrativeFrame): StorySegment[] {
  return frame ? segments.map(segment => ({ ...segment, view: frame })) : segments;
}
/** Reader knowledge must not leak into inventory/knowledge through optimistic model fields. */
export function protectNarrativeResponse(response: AIGameResponse, time: GameTime, request?: NarrativeRequest, snapshot?: import('./types').WorldSnapshot): AIGameResponse {
  if (request?.kind === 'result') return protectGameplayNarration(response, snapshot, request);
  if (response.narrativeBeat !== undefined || response.segments.some(s => s.beat !== undefined)) {
    const beat = parseNarrativeBeat(response.narrativeBeat ?? response.segments.at(-1)?.beat);
    const { narrativeBeat: _untrusted, ...prose } = response;
    response = { ...prose, ...(beat ? { narrativeBeat: beat } : {}), segments: beatSegments(response.segments, beat) };
  }
  if (response._gameplayResult) { const { _gameplayResult: _untrusted, ...normal } = response; response = normal; }
  const frame = responseFrame(response, request);
  const choices = acceptedChoices(response.narrativeChoices ?? response.segments.at(-1)?.choices);
  if (choices && (frame?.kind !== 'cutaway' || frame.actor)) response = { ...response, narrativeChoices: choices,
    segments: response.segments.map((segment, index) => index === response.segments.length - 1 ? { ...segment, choices } : segment) };
  if (!frame) return response;
  const result = { ...response, narrativeFrame: frame, segments: frameSegments(response.segments, frame) };
  if (frame.kind !== 'cutaway') return result;
  return { ...result, summary: (response.summary ?? '').startsWith('[旁观剧情，主角未知]') ? response.summary : `[旁观剧情，主角未知] ${response.summary}`,
    timeSpent: { day: 0, hour: 0, minute: 0 }, timeAfter: { ...time }, sceneChanges: [], mapUpdates: undefined,
    discoveredSecrets: [], npcsReacted: [], availableActions: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [],
    criticalFactsDiscovered: [], questsDiscovered: [], encyclopediaUpdates: [], encyclopediaDeletions: [],
    relationshipUpdates: [], itemValueUpdates: [], protagonistStateUpdate: undefined, timelineDeviation: undefined,
    personalityObservations: undefined, npcSpeechProfiles: undefined, sandboxToolRequests: [],
  };
}
