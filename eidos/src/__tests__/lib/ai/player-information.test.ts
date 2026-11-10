import { describe, expect, it } from 'vitest';
import { buildKeiValidationContext } from '@/lib/ai/kei-review';
import { buildWorldContext } from '@/lib/ai/context-builder';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import type { QuestEntry } from '@/lib/game/types';
const quest: QuestEntry = { id: 'old', title: '伪造期限', description: '旧模型任务', status: 'active', relatedNpcs: [], deadline: { day: 2, hour: 8, minute: 0 }, resolvedAt: null, createdAt: { day: 1, hour: 8, minute: 0 } };
describe('retired automatic tasks', () => {
  it('does not let legacy task data constrain narration or validation', () => {
    const { world, snapshot } = buildRiftCityStartState();
    expect(buildKeiValidationContext([], [], [], [], [quest])).not.toContain('伪造期限');
    const context = buildWorldContext({ world, snapshot, questLog: [quest] });
    expect(context).not.toContain('伪造期限');
    expect(context).not.toContain('待办事项');
  });
});
