import type { AIGameResponse, StorySegment } from '@/lib/ai/types';
import { useGameStore } from '@/store/game-store';
export const reviewedDescription = '一条喜欢软白饭的蓝色鱼，熟人面前会主动多聊几句，饿着时先问饭在哪里；仍保留原来的来历和记忆。';

/** An isolated, deterministic review receipt exercises acceptance and the real NPC screen. */
export function seedNpcProfileReview(): StorySegment[] {
  useGameStore.setState({ npcPersonalities: {} });
  const state = useGameStore.getState();
  state.upsertEncyclopediaEntry({ type: 'npc', name: '蓝色鱼', description: '一条能说话的蓝色鱼。' });
  state.ensurePersonality('蓝色鱼', '一条能说话的蓝色鱼。', false);
  return [{ type: 'dialogue', speaker: '蓝色鱼', text: '先给我白饭。' }];
}
export function npcProfilePreviewResponse(context = ''): Partial<AIGameResponse> {
  const id = /"operationId":"([^"]+)"/.exec(context)?.[1];
  if (id) return { segments: [{ type: 'dialogue', speaker: '蓝色鱼', expressionTags: ['开心'], text: '要软白饭。你要一起吃吗？' }],
    operationEffects: [id], operationOutcome: 'completed', summary: '已按审核结果补充人设' };
  if (context.includes('没有实际批准回执')) return { toolRequest: { method: 'npc.profile.update', params: { npcName: '蓝色鱼',
    description: reviewedDescription, reason: '管理员明确要求补充已有角色的人设，并交给KEI审核。' } }, segments: [] };
  return { segments: [{ type: 'dialogue', speaker: 'KEI', text: '补录通过。' }], summary: '只有口头通过，尚未实际执行' };
}
