import { expect, it } from 'vitest';
import { worldCreationPrompt, timelineCreationPrompt } from '@/lib/ai/world-generation-profile';
import { WORLD_CREATION_SYSTEM_PROMPT, TIMELINE_SIMULATION_PROMPT } from '@/lib/ai/prompt-templates';

it('keeps full generation unchanged and removes conflicting full-size quotas in quick mode', () => {
  expect(worldCreationPrompt()).toBe(WORLD_CREATION_SYSTEM_PROMPT);
  expect(timelineCreationPrompt()).toBe(TIMELINE_SIMULATION_PROMPT);
  const quick = worldCreationPrompt('quick');
  expect(quick).toContain('35%');
  expect(quick).toContain('2–3 条线索');
  expect(quick).not.toContain('至少设计 12-18');
  expect(quick).not.toContain('300-500字');
  expect(timelineCreationPrompt('quick')).toContain('6–8 个事件');
  expect(timelineCreationPrompt('quick')).not.toContain('至少 20-30');
});
