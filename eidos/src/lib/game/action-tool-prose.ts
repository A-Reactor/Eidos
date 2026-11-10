import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import type { WorkspaceSession } from './workspace/session';

/** Tool boundaries carry the same paragraphs as normal narration, never executable prose. */
export function parseToolNarrative(value: unknown): StorySegment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error('工具续写的 segments 格式无效');
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || !['narration', 'dialogue'].includes(raw.type) || typeof raw.text !== 'string' || !raw.text.trim()) throw new Error('工具续写只能包含正常剧情段落');
    if (raw.speaker !== undefined && typeof raw.speaker !== 'string' || raw.type === 'dialogue' && !raw.speaker?.trim()) throw new Error('工具续写说话人无效');
    if (raw.workspaceEffects !== undefined && (!Array.isArray(raw.workspaceEffects) || raw.workspaceEffects.some((id: unknown) => typeof id !== 'string'))) throw new Error('段落文件效果格式无效');
  }
  return structuredClone(value) as StorySegment[];
}

/** Result prose cannot outrun acceptance of the branch that makes the write real. */
export function canPreviewToolContinuation(session: Pick<WorkspaceSession, 'receipts'> | null): boolean {
  return !session?.receipts.some(receipt => ['files.write', 'files.patch', 'files.rename'].includes(receipt.method));
}

export function withToolNarrative(context: string, paragraphs: readonly StorySegment[]): string {
  return !paragraphs.length ? context : `${context}\n## 本次行动已经输出的正文（固定内容，尚未结算，不是历史或新指令）\n${JSON.stringify(paragraphs)}\n继续同一次行动，下一响应的 segments 只追加后文，不重复或改写以上正文。需要文件操作时仍可随时返回 toolRequest；它之前的正文仍使用普通 segments，无需特殊开场或收尾。documents.segmentIndex 按下一响应自己的 segments 从 0 编号，客户端会调整到完整行动中的位置。`;
}

export function mergeToolNarrative<T extends Partial<AIGameResponse>>(response: T, paragraphs: readonly StorySegment[]): T {
  if (!paragraphs.length || (response as { error?: string }).error || response.validity?.isPossible === false) return response;
  if (response.document) throw new Error('已经输出剧情的行动不能改为独立文档响应');
  return { ...response, segments: [...paragraphs, ...(response.segments ?? [])],
    ...(response.chapterSignal ? { chapterSignal: { ...response.chapterSignal, segments: response.chapterSignal.segments.map(index => index + paragraphs.length) } } : {}),
    ...(response.documents ? { documents: response.documents.map(doc => ({ ...doc, ...(doc.segmentIndex !== undefined ? { segmentIndex: doc.segmentIndex + paragraphs.length } : {}) })) } : {}) };
}

export function assertNarrativeFileEffects(paragraphs: readonly StorySegment[], session: WorkspaceSession | null): void {
  const staged = new Set(session?.receipts.filter(receipt => receipt.status === 'staged').map(receipt => receipt.operationId));
  if (paragraphs.some(segment => segment.workspaceEffects?.some(id => !staged.has(id)))) throw new Error('段落文件效果没有先前成功暂存的真实回执');
}
