import type { AiStreamActivity } from '@/lib/ai/types';

export type ActionActivityPhase = AiStreamActivity['phase'] | 'files' | 'search' | 'operation';
export const actionActivityText: Record<ActionActivityPhase, string> = {
  waiting: '正在召唤ALICE', thinking: 'ALICE陷入了思考', files: 'ALICE正在赶作业',
  search: 'ALICE正在刷手机', generating: 'ALICE正在讲故事', operation: 'ALICE正在整理世界',
};
