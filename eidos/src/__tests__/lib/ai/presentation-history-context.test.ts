import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildWorldContext } from '@/lib/ai/context-builder';
import { buildRiftCityStartState } from '@/lib/test/fixtures';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
const meta=parsePluginFile(JSON.parse(readFileSync('mods/dist/palimpsest-stage.eidos-plugin.json','utf8')))[0];
it('offers historical lookup to a native presentation world even without a worldline summary',()=>{
  const {world,snapshot}=buildRiftCityStartState();
  const prompt=buildWorldContext({world:{...world,gameplayPlugins:[meta]},snapshot});
  expect(prompt).toContain('## 历史原文工具');
  expect(prompt).toContain('view');expect(prompt).toContain('both');
});
