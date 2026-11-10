import type { AIGameResponse, TokenUsage } from '@/lib/ai/types';

export function makeResponse(overrides: Partial<AIGameResponse> = {}): AIGameResponse {
  return {
    validity: { isPossible: true, reason: '', fantasyResponse: '' },
    segments: [{ type: 'narration', text: '守卫确认自己没有看见驾驶者。' }],
    timeSpent: { day: 0, hour: 0, minute: 1 },
    availableActions: ['离开询问货车司机'], summary: '确认守卫的知识边界',
    sceneChanges: [], discoveredSecrets: [], npcsReacted: [], itemsGained: [], itemsUsed: [], cluesDiscovered: [],
    criticalFactsDiscovered: [], encyclopediaUpdates: [], worldImpacts: [], ...overrides,
  };
}

export const usage: TokenUsage = { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: 'kei' };
