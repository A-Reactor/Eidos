import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { worldForModel } from '@/lib/game/plugins/model-manifest';
import { buildGameplayStaticPrompt } from '@/lib/game/plugins/runtime';
import { isGameplayPluginActive } from '@/lib/game/plugins/activation';
const meta = parsePluginFile(JSON.parse(readFileSync('mods/dist/palimpsest-stage.eidos-plugin.json', 'utf8')))[0];
it('preserves the native text capability across model transport without sending private UI source', () => {
  const { world } = buildRiftCityStartState();
  const projected = worldForModel({ ...world, gameplayPlugins: [{ ...meta, ui: { ...meta.ui!, html: '<script>private-author-code</script>' } }] });
  expect(JSON.stringify(projected)).not.toContain('private-author-code');
  expect(buildGameplayStaticPrompt(projected, 'action')).toContain('原生文字演出协议');
});
it('lets the model decide Meta timing independently of rewind, even if creation data contains an old unlock suggestion', () => {
  const { world } = buildRiftCityStartState();
  const configured = { ...world, gameplayPlugins: [meta], gameModeConfig: { meta: { unlock: '必须先解锁回溯' } } };
  const flags = { 'gameplay.loop-manager.ready': false };
  expect(isGameplayPluginActive(meta, flags)).toBe(true);
  for (const phase of ['creation', 'action', 'review'] as const) {
    const prompt = buildGameplayStaticPrompt(worldForModel(configured), phase, { flags });
    expect(prompt).toContain('由模型根据当前剧情自主判断');
    expect(prompt).toContain('独立于受限回溯');
    expect(prompt).toContain('不设置固定剧情门槛');
    expect(prompt).toContain('不授予真实文件或系统操作权限');
  }
});
