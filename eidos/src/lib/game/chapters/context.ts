import type { WorldDefinition, WorldSnapshot } from '../types';
import type { ChapterState } from './types';
import { isGameplayPluginActive } from '../plugins/activation';

export const CHAPTER_PLUGIN_ID = 'chapter-narrative';
export function chapterNarrativeEnabled(world: Pick<WorldDefinition, 'gameplayPlugins'>, snapshot: Pick<WorldSnapshot, 'worldFlags' | 'currentSceneId'>): boolean {
  return Boolean(world.gameplayPlugins?.some(p => p.id === CHAPTER_PLUGIN_ID && isGameplayPluginActive(p, snapshot.worldFlags, snapshot.currentSceneId)));
}

/** Select prompt material, never delete archived experience to fit a request. */
export function chapterMaterial(state: ChapterState, input = '') {
  const active = state.chapters.find(c => c.id === state.activeId);
  const names = new Set([...(active?.cast.map(c => c.name) ?? []), ...state.relationships.flatMap(r => r.characters.filter(n => input.includes(n)))]);
  const relevant = (characters: string[]) => characters.some(name => names.has(name) || input.includes(name));
  const threads = state.threads.filter(t => active?.threadIds.includes(t.id) || relevant(t.characters) || input.includes(t.title));
  const relationships = state.relationships.filter(r => relevant(r.characters));
  const promises = state.promises.filter(p => p.status === 'open' || p.evidence.some(ref => active?.experienceIds.includes(ref.actionId)));
  const evidenceIds = new Set([...threads, ...relationships, ...promises].flatMap(x => x.evidence.map(r => r.actionId)));
  const recent = state.experiences.slice(-6);
  const related = state.experiences.filter(e => evidenceIds.has(e.actionId) && !recent.some(r => r.actionId === e.actionId));
  return { worldId: state.worldId, revision: state.revision, active,
    archive: state.chapters.filter(c => c.id !== state.activeId).map(c => ({ id: c.id, title: c.title, kind: c.kind, status: c.status, focus: c.focus, summary: c.summary })),
    threads, relationships, promises, candidates: state.candidates, needsPlanning: state.needsPlanning,
    pending: state.pending, experiences: [...related, ...recent],
    // The index lets the narrator request an old node with existing history.read.
    experienceIndex: state.experiences.filter(e => !related.includes(e) && !recent.includes(e)).map(e => ({ actionId: e.actionId, chapterId: e.chapterId, summary: e.summary, perspective: e.perspective })) };
}
export function chapterContextForModel(world: WorldDefinition, snapshot: WorldSnapshot, input = ''): string {
  const state = snapshot.chapterState;
  if (!state || state.worldId !== world.id || !chapterNarrativeEnabled(world, snapshot)) return '';
  return `\n## 已接受的篇章经历与当前写作准备\n${JSON.stringify({ ...chapterMaterial(state, input), pending: undefined })}\nactive 的 focus/material/possibilities/closure 与 candidates 是可修订的写作准备，不是已发生事实；experiences 和带证据的记忆才描述已接受经历。perspective=reader 是读者见过而主角未必知道的内容。自动输入 automatic 不能作为玩家长期偏好的证据。舞台是关注范围，玩家仍可自由离开。旧经历需要逐字核对时使用现有 history.read。`;
}
