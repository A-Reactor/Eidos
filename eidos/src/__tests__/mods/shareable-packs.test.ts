// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
import { exportPluginFile, mergePluginLibrary, savePluginLibrary, loadPluginLibrary } from '@/lib/game/plugins/library';
import { buildGameplayStaticPrompt } from '@/lib/game/plugins/runtime';

const ids = ['continuous-novel', 'debate-room', 'cross-examination', 'secrets-trial', 'folded-desk'];
const packs = ids.flatMap(id => parsePluginFile(JSON.parse(readFileSync(resolve('mods/dist', `${id}.eidos-plugin.json`), 'utf8'))));

it('imports all real packed mods into the existing library and shares them without losing operations', () => {
  localStorage.clear();
  const library = mergePluginLibrary([], packs);
  savePluginLibrary(library);
  expect(loadPluginLibrary()).toEqual({ plugins: packs });
  const roundTrip = parsePluginFile(JSON.parse(exportPluginFile(library)));
  expect(roundTrip).toEqual(packs);
  for (const pack of roundTrip) {
    expect(pack.ui?.html).toContain('onContext');
    expect(pack.ui?.html).not.toMatch(/<script\s+src=/);
    expect(pack.ui?.html).not.toContain('eidos-mod-context'); // SDK belongs to the host, not exported author files.
  }
});

it('keeps visual changes out of all model prompt roles for the real packages', () => {
  for (const role of ['creation', 'action', 'review'] as const) {
    const world = { gameplayPlugins: packs };
    const expected = buildGameplayStaticPrompt(world, role);
    const changed = packs.map(pack => ({ ...pack, ui: { ...pack.ui!, html: '<p>changed visual only</p>', initialState: { other: 1 } } }));
    expect(buildGameplayStaticPrompt({ gameplayPlugins: changed }, role)).toBe(expected);
    expect(expected).not.toContain('<!doctype');
  }
});
