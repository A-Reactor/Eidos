import { expect, it } from 'vitest';
import { parseGameplayPlugins } from '@/lib/game/plugins/manifest';
import { buildGameplayStaticPrompt } from '@/lib/game/plugins/runtime';
import { exportPluginFile } from '@/lib/game/plugins/library';
import { resourceHudDraft, resourcePluginDraft, resourceWorld } from './gameplay-resource-fixtures';

it('round-trips optional HUD presentation without changing resources or model prompts', () => {
  const world = { gameplayPlugins: parseGameplayPlugins([resourceHudDraft]) };
  const reimported = parseGameplayPlugins([JSON.parse(exportPluginFile(world.gameplayPlugins))]);
  expect(reimported[0].resources?.stamina.hud).toEqual({ style: 'gauge', placement: 'left', tone: 'mint', warningBelow: 2 });
  for (const phase of ['creation', 'action', 'review'] as const) {
    expect(buildGameplayStaticPrompt(world, phase)).toBe(buildGameplayStaticPrompt(resourceWorld(), phase));
  }
  expect(parseGameplayPlugins([resourcePluginDraft])[0].resources?.stamina).not.toHaveProperty('hud');
});
it.each([
  null, 'gauge', { style: 'html' }, { style: ['bar'] }, { style: 'bar', placement: ['left'] }, { style: 'bar', tone: ['cyan'] }, { style: 'bar', placement: 'center' }, { style: 'bar', tone: 'url(js)' },
  { style: 'bar', css: 'position:fixed' }, { style: 'bar', warningBelow: -1 }, { style: 'bar', warningAbove: 6 },
  { style: 'counter', warningBelow: 1.5 }, { style: 'counter', warningBelow: 3, warningAbove: 2 },
])('rejects executable or invalid HUD configuration %j', hud => {
  expect(() => parseGameplayPlugins([{ ...resourceHudDraft, resources: {
    stamina: { ...resourcePluginDraft.resources.stamina, hud },
  }, rules: [] }])).toThrow();
});
