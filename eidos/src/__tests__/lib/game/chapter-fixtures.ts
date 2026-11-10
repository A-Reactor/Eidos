import type { ChapterDecision, ChapterPlan } from '@/lib/game/chapters/types';

export const clockChapter: ChapterPlan = {
  id: 'clock', title: '一只走错的钟', kind: 'local', focus: '怎样回应修理承诺与异常担忧',
  stage: '钟表铺与午后的告别', cast: [{ name: '钟表匠', desire: '履行承诺', tension: '担心异常被带走' }],
  material: ['异常齿轮', '约定归还的挂钟'], possibilities: ['修好交还', '留下样本', '离开'],
  closure: ['钟的去向有了结果，人物实际回应了彼此'], threadIds: ['clock-promise'],
};
export const openChapter = (chapter: ChapterPlan = clockChapter): ChapterDecision => ({
  move: 'transition', reason: '当前世界允许从具体承诺开始', evidence: [], chapter,
  threads: [], promises: [], relationships: [], candidates: [],
});
