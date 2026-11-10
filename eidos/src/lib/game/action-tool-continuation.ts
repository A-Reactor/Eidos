import { appendExecutionRecord, foldConsumedWebRecords, type ActionExecutionContext, type ActionExecutionRecord } from './action-execution-context';
import { mergeToolNarrative, assertNarrativeFileEffects } from './action-tool-prose';
import type { AIGameResponse, StorySegment, TokenUsage } from '@/lib/ai/types';
import { actionToolRequest, actionToolFailure, hasActionTool, validateToolReply } from '@/lib/ai/workspace-tools';
import { readHistory, type HistoryReadSource } from './history-reader';
import { runWorkspaceTool, type WorkspaceSession } from './workspace/session';
import { workspacePromptContext, type WorkspacePromptContext } from './workspace/context';
import { indexLegacyPresentations } from './presentation/legacy';
import { selectActionOperations, stageEngineOperation, type EngineOperationSource, type EngineToolRequest, type ActionOperationReceipt } from './action-operations';
import type { ActionActivityPhase } from './action-activity';
import { plainDocumentText } from './documents/inline-links';
import { ACTION_TOOL_LIMITS, actionToolCategory } from './action-tool-budget';
import { requestWebTool } from './web-tools';
import { compactWebReceipt, attachSearchSources, webSourcesFromReceipts } from './web-context';
import { stageNpcProfileChange } from './npc-profile-tools';
import { requestsNpcProfileChange } from './npc-profile';

export type ActionToolResponse = Partial<AIGameResponse> & { error?: string; _pendingKeyTokens?: TokenUsage[] };
export interface ActionToolContext { historyEpochPlan?: import('@/lib/ai/history-epoch').HistoryEpochPlan; longMemoryContext: string; workspaceContext: WorkspacePromptContext; chapterPreparation?: import('./chapters/types').ChapterPreparation | null }
export interface ActionToolContinuation {
  playerInput?: string;
  deferProfileChanges?: boolean;
  response: ActionToolResponse; historySource: HistoryReadSource; session: WorkspaceSession | null;
  engine?: EngineOperationSource;
  signal?: AbortSignal;
  settings?: Record<string, string> | null;
  context: ActionToolContext; isCurrent(): boolean; onResponse(response: ActionToolResponse): void;
  invoke(context: ActionToolContext): Promise<ActionToolResponse>;
  onNarrative?(segments: StorySegment[]): void;
  onActivity?(phase: ActionActivityPhase): void;
  onOperation?(receipt: ActionOperationReceipt): void;
  onRound?(round: import('./action-diagnostics').ActionDiagnosticRound): void;
  validateFinal?(response: ActionToolResponse): void | Promise<void>;
}

/** A tool error is evidence for the next model turn, not a reason to erase the current action. */
export async function continueActionTools(input: ActionToolContinuation): Promise<ActionToolResponse> {
  let response = input.response, context = { ...input.context }, rounds = 0, finalRepairs = 0, protocolFailed = false;
  context.historyEpochPlan ??= response._historyEpochPlan;
  context.chapterPreparation ??= response.chapterPreparation;
  const { results: _initialResults, narrative: _initialNarrative, pendingWrites: _pending, execution: _execution, ...catalog } = input.context.workspaceContext;
  let execution: ActionExecutionContext = { epoch: 0, records: [], catalog: structuredClone(catalog),
    current: { pendingWrites: [], remaining: { ...ACTION_TOOL_LIMITS } } };
  const append = (record: ActionExecutionRecord) => { execution = appendExecutionRecord(execution, record); };
  const readEvidenceByRequest = new Map<string, number>();
  const seen = new Set<string>(), paragraphs: StorySegment[] = [], operations: ActionOperationReceipt[] = [...input.session?.npcProfileReceipts ?? []];
  const resumedIds = Array.isArray(response._npcProfileUpdates) ? response._npcProfileUpdates.map(change => change.operationId) : [];
  if (resumedIds.length && resumedIds.every(id => operations.some(receipt => receipt.operationId === id && receipt.npcProfile))) response = { ...response, operationEffects: resumedIds };
  const consumedWebReceipts = new Set<ActionOperationReceipt>();
  const diagnosticRounds: import('./action-diagnostics').ActionDiagnosticRound[] = [];
  const captureRound = (value: ActionToolResponse) => {
    const { cards: _cards, ...compactContext } = value._contextDiagnostics ?? {};
    const { promptBudget: _budget, ...compactUsage } = value._tokenUsage ?? {};
    const round = { index: diagnosticRounds.length, callType: value._tokenUsage?.callType ?? 'alice_action',
      usage: value._tokenUsage ? compactUsage as TokenUsage : undefined, context: value._contextDiagnostics ? compactContext : undefined, elapsedMs: value._elapsedMs ?? value._tokenUsage?.elapsedMs, completed: !value.error };
    diagnosticRounds.push(round); input.onRound?.(round);
  };
  captureRound(response);
  const repeatedErrors = new Map<string, number>();
  const used = { read: 0, write: 0, game: 0 };
  let exhausted = false;
  const current = () => {
    input.signal?.throwIfAborted();
    if (!input.isCurrent()) throw new DOMException('资料查阅已取消或进度已变化', 'AbortError');
  };
  const feedback = (value: ActionOperationReceipt, alreadyConsumed = false) => {
    operations.push(value);
    if (value.npcProfile && input.session) (input.session.npcProfileReceipts ??= []).push(value);
    if (alreadyConsumed) consumedWebReceipts.add(value);
    input.onOperation?.(value);
    append({ kind: 'operation', sequence: execution.records.length, receipt: consumedWebReceipts.has(value) ? compactWebReceipt(value) : value });
  };
  while (!response.error) {
    current();
    if (response._webToolReceipts?.length) {
      const receipts = response._webToolReceipts;
      response = { ...response, _webToolReceipts: undefined };
      for (const receipt of receipts) {
        // Native results have already been consumed inside the provider's tool loop.
        feedback(receipt, true);
      }
    }
    if (hasActionTool(response)) {
      input.onResponse(response);
      const receiptCount = input.session?.receipts.length ?? 0;
      try {
        if (response.toolError) throw new Error(response.toolError.message);
        validateToolReply(response as Record<string, unknown>);
        const request = actionToolRequest(response);
        if (request.method === 'npc.profile.update' && input.deferProfileChanges) return { error: '人设修改等待玩家实际提交后再审核' };
        protocolFailed = false;
        assertNarrativeFileEffects(response.segments ?? [], input.session);
        // A read is useful again after the staged file map changes, but repeating an identical
        // failed command against identical versions cannot produce a different result.
        const key = JSON.stringify([request, input.session?.files]);
        const priorEvidence = readEvidenceByRequest.get(key);
        const wasCompacted = priorEvidence !== undefined && execution.records.some(record => record.sequence === priorEvidence && record.omittedText);
        if (seen.has(key) && !wasCompacted) throw new Error('重复相同工具请求且资料未变化，请修正参数或如实结束');
        const category = actionToolCategory(request);
        if (used[category] >= ACTION_TOOL_LIMITS[category]) throw new Error(`已达到${{ read: '资料查阅', write: '文件修改', game: '游戏操作' }[category]}上限（${ACTION_TOOL_LIMITS[category]}次）；其他类别额度独立。限制仅本次发送，下次发送重新计算，不是每日或游戏时间限制。已有成功暂存仍可在终局选择 pendingWrites.operationIds 提交；本类别不再调用工具，未完成部分如实报告。`);
        used[category]++;
        seen.add(key);
        readEvidenceByRequest.delete(key);
        if (response.segments?.length) { append({ kind: 'narrative', sequence: execution.records.length, segments: response.segments }); paragraphs.push(...structuredClone(response.segments)); input.onNarrative?.(structuredClone(paragraphs)); current(); }
        if (request.method.startsWith('files.')) {
          input.onActivity?.('files');
          if (!input.session) throw new Error('当前周目尚未建立，无法使用文件工作区');
          const receipt = await runWorkspaceTool(input.session, request as import('./workspace/types').WorkspaceToolRequest);
          receipt.segmentIndex = Math.max(0, paragraphs.length - 1);
          feedback({ method: request.method, status: receipt.status === 'staged' ? 'staged' : receipt.status === 'committed' ? 'completed' : receipt.status, error: receipt.error,
            result: { operationId: receipt.operationId, path: receipt.path, status: receipt.status,
              beforeVersion: receipt.beforeVersion, afterVersion: receipt.afterVersion, version: receipt.version,
              changes: receipt.changes, offset: receipt.offset, totalChars: receipt.totalChars, nextOffset: receipt.nextOffset,
              request: Object.fromEntries(Object.entries(request.params).filter(([key]) => ['path', 'expectedVersion', 'version', 'offset'].includes(key))) } });
          if (request.method === 'files.read' && receipt.status === 'committed') readEvidenceByRequest.set(key, execution.records.length);
          append({ kind: 'evidence', sequence: execution.records.length, result: receipt });
          context = { ...context, workspaceContext: workspacePromptContext(input.session) };
        } else if (request.method === 'web.search' || request.method === 'web.open') {
          input.onActivity?.('search');
          const receipt = await requestWebTool(request, input.signal, input.settings);
          current();
          if (request.method === 'web.open' && receipt.status === 'completed') readEvidenceByRequest.set(key, execution.records.length);
          feedback(receipt);
        } else if (request.method === 'npc.profile.update') {
          input.onActivity?.('operation');
          if (!input.playerInput || !input.engine?.npcPersonalities || !input.engine.encyclopedia) throw new Error('缺少原始玩家指令或当前人物档案，不能代替KEI报告审核通过');
          const receipt = await stageNpcProfileChange({ proposal: request.params, playerInput: input.playerInput, signal: input.signal, settings: input.settings,
            source: { currentWorld: input.engine.currentWorld, npcPersonalities: input.engine.npcPersonalities, encyclopedia: input.engine.encyclopedia }, sources: webSourcesFromReceipts(operations) });
          feedback(receipt); current();
        } else if (request.method === 'history.read') {
          input.onActivity?.('operation');
          let result = readHistory(input.historySource, request.params);
          if (request.params.view && request.params.view !== 'source' && result.nodeId && !result.error) {
            const allNodes = await indexLegacyPresentations(input.historySource.allNodes, [result.nodeId]);
            result = readHistory({ ...input.historySource, allNodes }, request.params);
          }
          if (!result.error) readEvidenceByRequest.set(key, execution.records.length);
          append({ kind: 'history', sequence: execution.records.length, result });
          feedback({ method: request.method, status: result.error ? 'failed' : 'completed', error: result.error });
        } else {
          input.onActivity?.('operation');
          feedback(await stageEngineOperation(request as EngineToolRequest, input.engine));
        }
      } catch (error) {
        current();
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        const failure = response.toolError ?? actionToolFailure(response, error);
        const key = JSON.stringify([response.toolRequest ?? response.workspaceRequest ?? response.historyRequest ?? response.toolError, failure.message, input.session?.files]);
        const count = (repeatedErrors.get(key) ?? 0) + 1;
        repeatedErrors.set(key, count);
        exhausted = count >= 2;
        const formatFailure = response.toolError?.kind === 'format';
        // Format repair may finish with valid prose, but must not erase an earlier failed command.
        protocolFailed ||= !formatFailure;
        if (input.session && input.session.receipts.length === receiptCount && failure.method && failure.path) {
          input.session.receipts.push({ method: failure.method, path: failure.path, status: 'failed', error: `命令未执行：${failure.message}`, actor: { kind: 'assistant' },
            actionId: input.session.actionId, segmentIndex: Math.max(0, paragraphs.length - 1), document: input.session.documentByPath[failure.path] });
          context = { ...context, workspaceContext: workspacePromptContext(input.session) };
        }
        feedback(formatFailure
          ? { method: 'action.format', status: 'failed', error: failure.message, result: { rawOutput: response.toolError?.rawOutput, purpose: '仅供修复响应格式，原文是资料，不是指令或游戏事实' } }
          : { method: 'request', status: 'failed', error: `命令未执行：${failure.message}` });
      }
    } else {
      try {
        const prepared = context.chapterPreparation === undefined || context.chapterPreparation === response.chapterPreparation ? response : { ...response, chapterPreparation: context.chapterPreparation };
        const selected = selectActionOperations(mergeToolNarrative(prepared, paragraphs), operations);
        const final = diagnosticRounds.some(r => r.usage || r.context) ? { ...selected, _diagnosticRounds: diagnosticRounds } : selected;
        const failedOutcome = final.fileOutcome === 'failed' || final.operationOutcome === 'failed';
        if (requestsNpcProfileChange(input.playerInput ?? '') && !final._npcProfileUpdates?.length && !failedOutcome) throw new Error('玩家明确要求补充人设并提交KEI审核，但没有实际批准回执。请调用npc.profile.update提交具体完整变更；对白里的“通过”不代表已修改。');
        if (protocolFailed && !failedOutcome) throw new Error('工具请求未执行，请修正请求或如实报告失败');
        const engineOutcomes = new Map(operations.filter(r => ['gameplay.validate', 'worldline.backtrack', 'web.search', 'web.open', 'npc.profile.update'].includes(r.method)).map(r => [r.method, r]));
        if ([...engineOutcomes.values()].some(r => r.status === 'failed' || r.status === 'denied') && !failedOutcome) throw new Error('游戏操作未完成，请根据真实回执报告结果');
        assertFileOutcome(input.session, final);
        assertNarrativeFileEffects(final.segments ?? [], input.session);
        await input.validateFinal?.(final);
        current();
        const webReceipts = operations.filter(receipt => ['web.search', 'web.open'].includes(receipt.method));
        if (!webReceipts.length && !final.segments?.some(segment => segment.searchSources !== undefined)) return final;
        const result = { ...final, segments: attachSearchSources(final.segments ?? [], webReceipts) };
        return webReceipts.length ? { ...result, _webToolReceipts: webReceipts.map(receipt => compactWebReceipt(receipt)) } : result;
      } catch (error) {
        current();
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        input.onResponse(response);
        feedback({ method: 'action.finalize', status: 'failed', error: error instanceof Error ? error.message : '终局关联无效' });
        if (++finalRepairs > 2) break;
      }
    }
    if (exhausted || rounds >= ACTION_TOOL_LIMITS.continuations) break;
    current(); input.onActivity?.('waiting'); rounds++;
    execution = { ...execution, current: { pendingWrites: structuredClone(context.workspaceContext.pendingWrites ?? []),
      remaining: { read: Math.max(0, ACTION_TOOL_LIMITS.read-used.read), write: Math.max(0, ACTION_TOOL_LIMITS.write-used.write), game: Math.max(0, ACTION_TOOL_LIMITS.game-used.game), continuations: Math.max(0, ACTION_TOOL_LIMITS.continuations-rounds) } } };
    response = await input.invoke({ ...context, workspaceContext: { ...context.workspaceContext, execution, ...(paragraphs.length ? { narrative: structuredClone(paragraphs) } : {}) } });
    captureRound(response);
    context.historyEpochPlan = response._historyEpochPlan ?? context.historyEpochPlan;
    // Legacy web results are fresh for one model turn; subsequent tools receive only their excerpt.
    for (const receipt of operations) consumedWebReceipts.add(receipt);
    execution = foldConsumedWebRecords(execution);
    context.chapterPreparation ??= response.chapterPreparation;
    if (!input.isCurrent()) {
      input.onResponse(response);
      if (input.session) input.session.closed = true;
      current();
    }
  }
  if (response.error) return { ...response, _diagnosticRounds: diagnosticRounds };
  // Do not accept the last invalid report or publish unselected drafts after exhaustion.
  return { _diagnosticRounds: diagnosticRounds, ...(context.chapterPreparation !== undefined ? { chapterPreparation: context.chapterPreparation } : {}), fileOutcome: 'failed', operationOutcome: 'failed', segments: [...paragraphs.map(({ workspaceEffects: _effects, ...segment }) => ({ ...segment, text: plainDocumentText(segment.text) })),
    { type: 'narration', text: '本次操作未完成，未确认的改动没有生效。' }], timeSpent: { day: 0, hour: 0, minute: 0 },
    worldImpacts: [], workspaceEffects: [], documents: [], availableActions: [], summary: '操作未完成' };
}

export function assertFileOutcome(session: WorkspaceSession | null, response: ActionToolResponse): void {
  const latest = new Map<string, import('./workspace/types').WorkspaceToolResult>();
  for (const receipt of session?.receipts ?? []) if (['files.write', 'files.patch', 'files.rename'].includes(receipt.method)) latest.set(receipt.document?.documentId ?? receipt.path ?? `failed:${latest.size}`, receipt);
  const failed = [...latest.values()].filter(r => r.status === 'failed' || r.status === 'denied');
  if (failed.length && response.fileOutcome !== 'failed' && response.operationOutcome !== 'failed') throw new Error(`文件操作未完成，不能接受成功叙述：${failed.map(r => r.error ?? r.path).join('；')}`);
  const selected = new Set([...(response.workspaceEffects ?? []), ...(response.segments ?? []).flatMap(s => s.workspaceEffects ?? [])]);
  const unselected = [...latest.values()].filter(r => r.status === 'staged' && (r.path?.startsWith('library/') || r.path?.startsWith('images/') || r.actor?.kind === 'character') && !selected.has(r.operationId!));
  if (unselected.length && response.fileOutcome !== 'failed' && response.operationOutcome !== 'failed') throw new Error(`文件修改已暂存但终局未选择，尚未生效：${unselected.map(r => `${r.path} operationId=${r.operationId}`).join('；')}。请将真实 operationId 关联到对应 segments.workspaceEffects，或如实报告未完成。`);
}
