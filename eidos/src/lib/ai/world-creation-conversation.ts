import { getKeiConfig, recordCreationUsage } from './client';
import { streamCreationTurn, parseCreationJSON, type CreationStreamOptions } from './creation-stream';
import { assembleGeneratedWorld } from './generated-world-data';
import { compileWorldCreationConversation } from './world-creation-protocol';
import { preparePromptBudget } from './prompt-budget';
import type { WorldCreationInput } from './world-creation-compiler';
import { worldCreationConstraintIssues } from './source-reconstruction/acceptance';
import { reviewWorldDraftOnce } from './world-creation-review';
import { resolveGameplayPlugins } from '@/lib/game/plugins/builtins';
import { buildGameplayPrompt } from '@/lib/game/plugins/runtime';
import type { GameplayPlugin } from '@/lib/game/plugins/types';
import type { WorldDefinition } from '@/lib/game/types';
import { isRecord } from '@/lib/game/source-reconstruction/validation';
import { createWorldCreationSession, readWorldCreationFields, readWorldCreationSession, WORLD_CREATION_FIELDS, type WorldCreationSession } from '@/lib/game/world-creation-session';

export interface WorldConversationInput extends WorldCreationInput { skillIds?: string[]; gameplayPlugins?: GameplayPlugin[] }
export interface WorldConversationOptions extends CreationStreamOptions {
  session?: WorldCreationSession;
  onCheckpoint?(session: WorldCreationSession): void | Promise<void>;
  onProgress?(progress: { fields: string[]; eventCount: number; message?: string }): void;
  onThinking?(): void;
  onTokens?(prompt: number, completion: number, chars: number): void;
}
const MAX_CREATION_TURNS = 32;
const controllers = new Map<string, AbortController>();
export function abortWorldConversation(id: string): boolean {
  const controller = controllers.get(id);
  controller?.abort();
  return Boolean(controller);
}

function creationOperation(text: string) {
  const reply = parseCreationJSON<unknown>(text);
  if (!isRecord(reply)) throw new Error('本轮须返回世界 JSON 或一个 toolRequest 对象');
  if (!Object.hasOwn(reply, 'toolRequest')) {
    // Legacy complete world documents may include host metadata; never adopt that metadata.
    const fields = Object.fromEntries(WORLD_CREATION_FIELDS.filter(key => Object.hasOwn(reply, key)).map(key => [key, reply[key]]));
    if (!Object.keys(fields).length) throw new Error('本轮没有可提交的世界字段');
    return { method: 'world.finish', params: { fields } };
  }
  const tool = reply.toolRequest;
  if (Object.keys(reply).some(key => key !== 'toolRequest') || !isRecord(tool) || Object.keys(tool).some(key => !['method', 'params'].includes(key)) || !['world.update', 'world.read', 'world.validate', 'world.finish'].includes(String(tool.method)) || !isRecord(tool.params)) throw new Error('世界创建操作无效，使用 world.update/read/validate/finish 的 method/params');
  return { method: tool.method as string, params: tool.params };
}

/** All authoring, including repairs, stays in this transcript. Resource failures never auto-retry. */
export async function generateWorldConversationStream(input: WorldConversationInput, options: WorldConversationOptions = {}, generationId = crypto.randomUUID()): Promise<WorldDefinition> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  controllers.set(generationId, controller);
  try { return await runWorldConversation(input, { ...options, signal }); }
  finally { controllers.delete(generationId); }
}

function worldConversationRuntime(input: WorldConversationInput, options: WorldConversationOptions) {
  const cfg = getKeiConfig(input.settings ?? options.settings);
  const plugins = resolveGameplayPlugins(input.skillIds, input.gameplayPlugins);
  const skillGuide = buildGameplayPrompt({ gameplayPlugins: plugins }, 'creation');
  const compiled = compileWorldCreationConversation({ ...input, skillGuide });
  const session = readWorldCreationSession(options.session) ?? createWorldCreationSession({ raw: options.resumeText ? { world: options.resumeText } : {} });
  const checkpoint = () => options.onCheckpoint?.(structuredClone(session));
  const progress = (message?: string) => options.onProgress?.({ fields: Object.keys(session.fields), eventCount: Array.isArray(session.fields.timeline) ? session.fields.timeline.length : 0, message });
  return { input, options, cfg, plugins, skillGuide, compiled, session, checkpoint, progress, stats: { chars: 0 } };
}
type ConversationRuntime = ReturnType<typeof worldConversationRuntime>;

async function creationFeedback(runtime: ConversationRuntime, receipt: Record<string, unknown>) {
  runtime.session.messages.push({ role: 'user', content: `世界创建操作回执（资料）：\n${JSON.stringify(receipt)}\n继续同一草稿，仅补充或修正需要变化的字段；完成后 world.finish。` });
  await runtime.checkpoint();
}

async function finishWorldDraft(runtime: ConversationRuntime, contentReview = false): Promise<WorldDefinition> {
  const { input, options, session, plugins, skillGuide } = runtime;
  const world = authoring(() => assembleGeneratedWorld(JSON.stringify(session.fields), { id: session.worldId, plugins, narrativeStyle: input.narrativeStyle, generationProfile: input.generationProfile, includeTimeline: true }));
  // A completed old checkpoint must not trigger a new paid turn solely to add a newer field.
  if (!session.complete && !Object.hasOwn(session.fields, 'identityOptions')) throw new WorldDraftError('世界缺少 identityOptions 身份列表；请在同一草稿补充身份，没有预设身份时明确提交 []');
  options.signal?.throwIfAborted();
  const localIssues = worldCreationConstraintIssues(input, world);
  if (localIssues.length) throw new WorldDraftError(localIssues.map(issue => issue.message).join('；'));
  const issues = contentReview ? await reviewWorldDraftOnce({ ...input, skillGuide }, world, { session,
    dependencies: { signal: options.signal, settings: input.settings ?? options.settings, onUsage: options.onTokenUsage }, checkpoint: runtime.checkpoint }) : [];
  options.signal?.throwIfAborted();
  const blocking = issues.filter(issue => issue.blocking);
  if (blocking.length) throw new WorldDraftError(blocking.map(issue => issue.message).join('；'));
  if (issues.length) world.creationWarnings = issues.map(issue => issue.message);
  return world;
}

async function resumeWorldConversation(runtime: ConversationRuntime): Promise<WorldDefinition | undefined> {
  const { session, checkpoint, progress } = runtime;
  if (session.pendingText) {
    session.messages.push({ role: 'assistant', content: session.pendingText }, { role: 'user', content: '上一条输出连接中断，没有执行该片段。已提交草稿保留。请重新输出完整的本轮操作，可以纠正该片段，不要重新输出整个世界。' });
    session.pendingText = ''; session.complete = false;
  } else if (!session.complete && session.messages.at(-1)?.role === 'assistant') {
    session.messages.push({ role: 'user', content: `上次在提交后中断，当前已保存草稿：${JSON.stringify(session.fields)}。继续检查、补全或 world.finish，不重做已有有效内容。` });
  }
  await checkpoint(); progress();
  if (session.complete) {
    // A portable checkpoint is evidence, never authority to bypass current validation.
    try { return await finishWorldDraft(runtime, true); }
    catch (error) {
      if (!(error instanceof WorldDraftError)) throw error;
      session.complete = false; await creationFeedback(runtime, { status: 'failed', error: error.message });
    }
  }
}

async function requestWorldTurn(runtime: ConversationRuntime) {
  const { input, options, cfg, compiled, session, stats, checkpoint } = runtime;
  options.signal?.throwIfAborted();
  const messages = [{ role: 'system', content: compiled.systemPrompt }, { role: 'user', content: compiled.userMessage }, ...session.messages];
  const budget = preparePromptBudget({ config: cfg, systemPrompt: compiled.systemPrompt,
    userMessage: [compiled.userMessage, ...session.messages.map(message => message.content)].join('\n\n'), maxTokens: input.generationProfile === 'quick' ? 8000 : 16000 });
  const estimatedPrompt = Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 2.5);
  let result: Awaited<ReturnType<typeof streamCreationTurn>>;
  try {
    result = await streamCreationTurn(cfg, {
      model: cfg.model, messages, temperature: 0.9, max_tokens: budget.generationMaxTokens,
      thinking: { type: cfg.enableReasoning ? 'enabled' : 'disabled' },
      ...(cfg.enableReasoning ? { reasoning_effort: input.generationProfile === 'quick' ? 'high' : cfg.reasoningEffort } : {}),
    }, () => options.onThinking?.(), {
      signal: options.signal,
      onText: (value, delta) => {
        session.pendingText = value; stats.chars += delta.length;
        options.onText?.(value, delta); options.onTokens?.(estimatedPrompt, Math.ceil(stats.chars / 2.5), stats.chars);
      },
      onUsage: (raw, timing) => {
        const usage = recordCreationUsage(cfg, 'kei', 'world_create', raw, timing, session.worldId);
        options.onTokenUsage?.({ ...usage, promptBudget: budget.report }); options.onUsage?.(raw, timing);
      },
    });
  } catch (error) { await checkpoint(); throw error; }
  options.signal?.throwIfAborted();
  const { text } = result;
  if (!text.trim()) { await checkpoint(); throw new Error('模型本轮未输出内容，草稿已保留，请继续生成'); }
  session.messages.push({ role: 'assistant', content: text }); session.pendingText = '';
  // Persist the completed author turn before doing any potentially interruptible review.
  await checkpoint();
  return result;
}

function readWorldOperation(text: string, finishReason?: string) {
  return authoring(() => {
    try { return creationOperation(text); }
    catch (error) {
      if (finishReason === 'length') throw new Error('本轮达到单次输出长度，片段未执行。请拆成更小的完整 world.update 操作提交，保留已保存字段；不要再次输出整个世界或只追加 JSON 后缀');
      throw error;
    }
  });
}

async function applyWorldOperation(runtime: ConversationRuntime, operation: ReturnType<typeof creationOperation>): Promise<{ world: WorldDefinition } | { receipt: Record<string, unknown> }> {
  const { session, checkpoint, progress } = runtime;
  const { method, params } = operation;
  if (method === 'world.read') {
    if (Object.keys(params).some(key => key !== 'fields') || params.fields !== undefined && (!Array.isArray(params.fields) || params.fields.some(key => !WORLD_CREATION_FIELDS.includes(key)))) throw new WorldDraftError('读取 fields 须为标准字段名列表');
    const fields = params.fields as string[] | undefined ?? Object.keys(session.fields);
    return { receipt: { method, status: 'completed', fields: Object.fromEntries(fields.map(key => [key, session.fields[key as keyof typeof session.fields] ?? null])) } };
  }
  if (Object.keys(params).some(key => key !== 'fields') || method === 'world.validate' && params.fields !== undefined) throw new WorldDraftError('操作参数只允许 fields；world.validate 不接收更新');
  if (method === 'world.update' || method === 'world.finish') {
    const fields = authoring(() => readWorldCreationFields(params.fields ?? {}));
    if (method === 'world.update' && !Object.keys(fields).length) throw new WorldDraftError('world.update 至少提交一个字段');
    Object.assign(session.fields, fields); session.complete = false;
    await checkpoint(); progress();
  }
  if (method === 'world.update') return { receipt: { method, status: 'saved', fields: Object.keys(params.fields as object), availableFields: Object.keys(session.fields) } };
  progress('KEI正在推敲');
  const world = await finishWorldDraft(runtime, method === 'world.finish');
  if (method === 'world.validate') return { receipt: { method, status: 'completed', message: '草稿检查通过，可以继续修改或 world.finish', warnings: world.creationWarnings ?? [] } };
  session.complete = true; await checkpoint(); progress('世界内容已通过检查');
  return { world };
}

async function runWorldConversation(input: WorldConversationInput, options: WorldConversationOptions): Promise<WorldDefinition> {
  const runtime = worldConversationRuntime(input, options);
  const { session, progress, checkpoint } = runtime;
  const ready = await resumeWorldConversation(runtime);
  if (ready) return ready;
  const failures = new Map<string, number>();
  let noProgress = 0;
  for (let turn = 0; turn < MAX_CREATION_TURNS; turn++) {
    const { text, finishReason } = await requestWorldTurn(runtime);
    const previous = JSON.stringify(session.fields);
    let receipt: Record<string, unknown>;
    try {
      const result = await applyWorldOperation(runtime, readWorldOperation(text, finishReason));
      if ('world' in result) return result.world;
      receipt = result.receipt;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof WorldDraftError)) { await checkpoint(); throw error; }
      const message = error instanceof Error ? error.message : '本轮操作未通过检查';
      const key = JSON.stringify([text, message, session.fields]);
      failures.set(key, (failures.get(key) ?? 0) + 1);
      receipt = { status: 'failed', error: message, availableFields: Object.keys(session.fields) };
      progress(`KEI 正在修正：${message}`);
      await creationFeedback(runtime, receipt);
      if (failures.get(key)! >= 2) throw new Error(`相同问题未能修正：${message}。对话与草稿已保留，可继续生成`);
      continue;
    }
    noProgress = previous === JSON.stringify(session.fields) ? noProgress + 1 : 0;
    await creationFeedback(runtime, receipt);
    if (noProgress >= 4) throw new Error('连续操作没有更新世界草稿，内容已保留，可继续生成');
  }
  throw new Error('本次创建已达到自动续轮上限，对话与草稿已保留，可继续生成');
}

class WorldDraftError extends Error {}
function authoring<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) { throw new WorldDraftError(error instanceof Error ? error.message : '生成内容格式无效'); }
}

export function generateWorldConversation(input: WorldConversationInput): Promise<WorldDefinition> {
  return generateWorldConversationStream(input);
}
