import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { assembleModPackage, loadModPackage } from '../../../scripts/mod-package.mjs';
import { parsePluginFile } from '@/lib/game/plugins/manifest';

it('plays two different authored cases with one examination mechanism and presentation', async () => {
  const first = parsePluginFile(await loadModPackage('mods/cross-examination'))[0];
  const second = parsePluginFile(await loadModPackage('mods/cross-examination', { content: 'cases/station-clock.json' }))[0];
  expect(first.ui?.html).toBe(second.ui?.html);
  expect(first.id).not.toBe(second.id);
  const sandbox: { CrossExamination?: { createState(): object; press(c: unknown, s: object, id: string): { state: object }; present(c: unknown, s: object, id: string, evidence: string): { outcome: string; state: object } } } = {};
  runInNewContext(readFileSync('mods/cross-examination/logic.js', 'utf8'), sandbox);
  for (const plugin of [first, second]) {
    const data = plugin.data!.case as { title: string; testimony: Array<{ id: string; evidenceId: string }>; clues: object[] };
    const context = { plugin, clues: data.clues, world: { sceneName: '调查现场' } };
    let state = sandbox.CrossExamination!.createState(), outcome = '';
    for (const line of data.testimony) {
      state = sandbox.CrossExamination!.press(context, state, line.id).state;
      const result = sandbox.CrossExamination!.present(context, state, line.id, line.evidenceId);
      state = result.state; outcome = result.outcome;
    }
    expect(outcome).toBe('case-complete');
  }
});
it('rejects a content overlay that tries to replace executable UI or runtime format', () => {
  expect(() => assembleModPackage({}, { ui: { html: '<script>execute()</script>' } }, '')).toThrow();
  expect(() => assembleModPackage({}, { format: 'other' }, '')).toThrow();
});
it('rejects content paths outside the selected author package', async () => {
  await expect(loadModPackage('mods/cross-examination', { content: '../secrets-trial/manifest.json' })).rejects.toThrow(/目录/);
});
