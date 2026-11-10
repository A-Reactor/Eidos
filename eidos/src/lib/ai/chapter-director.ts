import type { AIGameResponse, TokenUsage } from './types';
import type { WorldDefinition, WorldSnapshot } from '../game/types';
import type { NarrativeRequest } from '../game/narrative';
import type { ChapterPreparation } from '../game/chapters/types';
import { chapterBasis, createChapterState, prepareChapterDraft, validateChapterPreparation } from '../game/chapters/state';
import { chapterMaterial, chapterNarrativeEnabled } from '../game/chapters/context';
import { parseChapterDecision, parseChapterSignal, parseChapterState } from '../game/chapters/validation';
import { CHAPTER_DIRECTOR_PROTOCOL } from '../game/chapters/protocol';
import { buildWorldContextSections } from './context-builder';
import { buildGameplayPromptSections } from '../game/plugins/runtime';
import { callAi, getKeiConfig, parseJSON } from './client';
import { loadSettings } from '../game/settings';

interface PreparationOptions {
  world?: WorldDefinition | null; snapshot: WorldSnapshot; playerInput: string;
  recentHistory?: Array<{ playerInput: string; summary: string; aiResponse?: string }>;
  longMemoryContext?: string; chapterPreparation?: unknown; clientSettings?: Record<string, string> | null;
  signal?: AbortSignal; introspection?: boolean; documentMode?: boolean; narrativeRequest?: NarrativeRequest;
}
export interface ChapterGeneration {
  preparation?: ChapterPreparation; usage?: TokenUsage;
  status?: 'prepared' | 'reused' | 'invalid' | 'unavailable' | 'disabled';
}
/** Even a predicted chapter is just a candidate until its action is accepted. */
export async function prepareChapterGeneration(options: PreparationOptions): Promise<ChapterGeneration> {
  options.signal?.throwIfAborted();
  const { world, snapshot } = options;
  if (!world || !chapterNarrativeEnabled(world, snapshot) || options.introspection || options.documentMode || options.narrativeRequest?.kind === 'result') return {};
  const settings = { ...loadSettings(), ...options.clientSettings };
  if (!settings.enableContentReview) return { status: 'disabled' };
  if (options.chapterPreparation === null) return { status: 'unavailable' };
  const state = snapshot.chapterState?.worldId === world.id ? snapshot.chapterState : createChapterState(world.id);
  if (options.chapterPreparation) {
    try { return { preparation: validateChapterPreparation(state, options.chapterPreparation, world.id), status: 'reused' }; }
    catch { return { status: 'invalid' }; }
  }
  const active = state.chapters.find(c => c.id === state.activeId);
  if (active?.status === 'active' && !state.pending && !state.needsPlanning) return {};
  if (!getKeiConfig(options.clientSettings).apiKey) return { status: 'unavailable' };
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let usage: TokenUsage | undefined;
  try {
    const sections = buildWorldContextSections({ world, snapshot });
    const plugins = buildGameplayPromptSections(world, 'review', { flags: snapshot.worldFlags, sceneId: snapshot.currentSceneId });
    const prompt = CHAPTER_DIRECTOR_PROTOCOL + sections.stablePrefix + plugins.stablePrefix;
    const request = callAi({ role: 'kei', systemPrompt: prompt, userMessage: JSON.stringify({
      recentHistory: options.recentHistory ?? [],
      worldContext: sections.dynamicSuffix + plugins.dynamicSuffix, chapters: chapterMaterial(state, options.playerInput),
      characterIndex: world.npcs, legacyContinuity: snapshot.narrativeProgress,
      requestEvidence: options.longMemoryContext ?? '', playerInput: options.playerInput,
    }), temperature: 0.6, maxTokens: 5000, timeoutMs: 35000, noRetry: true,
      jsonMode: true, reasoningEffort: 'high', callType: 'chapter_planning', settingsOverride: options.clientSettings, signal: controller.signal });
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new DOMException('篇章准备已取消', 'AbortError')), { once: true });
      timer = setTimeout(() => controller.abort(new Error('篇章准备超时')), 35000);
    });
    const result = await Promise.race([request, timeout]);
    usage = result.usage;
    options.signal?.throwIfAborted();
    const decision = parseChapterDecision(parseJSON(result.content));
    if (!decision) return { status: 'invalid', usage };
    const preparation = { basis: chapterBasis(world.id, state), decision };
    validateChapterPreparation(state, preparation, world.id);
    return { preparation, usage, status: 'prepared' };
  } catch {
    options.signal?.throwIfAborted();
    return { status: usage ? 'invalid' : 'unavailable', ...(usage ? { usage } : {}) };
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export function chapterGenerationSnapshot(snapshot: WorldSnapshot, generation: ChapterGeneration): WorldSnapshot {
  if (!generation.preparation) return snapshot;
  const state = snapshot.chapterState ?? createChapterState(generation.preparation.basis.worldId);
  return { ...snapshot, chapterState: prepareChapterDraft(state, generation.preparation.decision) };
}
export function attachChapterGeneration(response: AIGameResponse, generation: ChapterGeneration): AIGameResponse {
  const { chapterPreparation: _forged, _chapterUsage: _forgedUsage, ...normal } = response;
  return { ...normal, chapterSignal: parseChapterSignal(response.chapterSignal),
    ...(generation.preparation ? { chapterPreparation: generation.preparation } : generation.status ? { chapterPreparation: null } : {}),
    ...(generation.usage ? { _chapterUsage: [generation.usage] } : {}),
    ...(generation.status ? { _contextDiagnostics: { ...response._contextDiagnostics, chapters: { status: generation.status } } } : {}) };
}

/** Optional save metadata may be absent or malformed without making normal play unusable. */
export function normalizeChapterSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  if (!snapshot.chapterState) return snapshot;
  const chapterState = parseChapterState(snapshot.chapterState);
  return { ...snapshot, chapterState: chapterState?.worldId === snapshot.worldId ? chapterState : null };
}
