import { loadSettings } from '@/lib/game/settings';

/** Player preferences are stable narrative instructions, separate from per-turn requests. */
export function aliceUserInstructions(settings?: Record<string, unknown> | null): string {
  const value = settings?.aliceUserPrompt ?? loadSettings().aliceUserPrompt;
  return typeof value === 'string' && value.trim() ? `\n\n## 玩家自定义提示词\n${value.trim()}\n` : '';
}
