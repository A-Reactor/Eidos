import { expect, it } from 'vitest';
import { salvagePartialGameResponse } from '@/lib/ai/salvage';
import { addTime, resolveActionTime } from '@/lib/game/time';

it('preserves the end clock when a response is truncated after the narrative and timing fields', () => {
  const response = salvagePartialGameResponse('{"segments":[{"type":"narration","text":"夕阳沉入河岸。"}],"timeAfter":{"day":3,"hour":18,"minute":30},"timeSpent":{"day":0,"hour":4,"minute":0},"itemsGained":[');
  const start = { day: 3, hour: 14, minute: 30 };
  expect(addTime(start, resolveActionTime('歇息到傍晚', response.timeSpent, start, response.timeAfter))).toEqual({ day: 3, hour: 18, minute: 30 });
});
