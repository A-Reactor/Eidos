import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadModPackage } from '../../../scripts/mod-package.mjs';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { buildGameplayPrompt } from '@/lib/game/plugins/runtime';
import { chapterNarrativeEnabled } from '@/lib/game/chapters/context';
import { buildRiftCityStartState } from '@/lib/test/fixtures';

describe('chapter narrative distributable', () => {
  it('packages a guide with no executable UI, fixed event rules or author tools', async () => {
    const raw = await loadModPackage('mods/chapter-narrative');
    const plugin = parsePluginFile(raw)[0];
    expect(plugin.id).toBe('chapter-narrative');
    expect(plugin.release).toBe('1.0.0');
    expect(plugin.rules).toEqual([]);
    expect(plugin.ui).toBeUndefined();
    expect(parsePluginFile(JSON.parse(readFileSync('mods/dist/chapter-narrative.eidos-plugin.json', 'utf8')))[0]).toEqual(plugin);
    const { world, snapshot } = buildRiftCityStartState();
    expect(chapterNarrativeEnabled({ ...world, gameplayPlugins: [plugin] }, snapshot)).toBe(true);
  });
  it('carries world-specific material through creation and coexists with native continuous reading', async () => {
    const chapter = parsePluginFile(await loadModPackage('mods/chapter-narrative'))[0];
    const continuous = parsePluginFile(JSON.parse(readFileSync('mods/dist/continuous-novel.eidos-plugin.json', 'utf8')))[0];
    const { world } = buildRiftCityStartState();
    const installed = { ...world, gameplayPlugins: [chapter, continuous], gameModeConfig: { 'chapter-narrative': { opening: '原作钟表铺的归还约定', establishedTruths: ['原作中异常齿轮的来源已确定'] } } };
    expect(buildGameplayPrompt(installed, 'creation')).toContain('gameModeConfig');
    expect(buildGameplayPrompt(installed, 'action')).toContain('原作钟表铺的归还约定');
    expect(buildGameplayPrompt(installed, 'review')).toContain('原作中异常齿轮的来源已确定');
    expect(chapter.prompts.creation).toContain('原作');
    expect(continuous.ui?.nativeReading).toBe(true);
  });
});
