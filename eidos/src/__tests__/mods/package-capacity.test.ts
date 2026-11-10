import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parsePluginFile } from '@/lib/game/plugins/manifest';
it('packs a portable plugin above the former 200 KB limit using the actual CLI', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eidos-large-plugin-'));
  try {
    mkdirSync(path.join(root, 'scripts')); mkdirSync(path.join(root, 'mods', 'large'), { recursive: true });
    for (const file of ['pack-mods.mjs', 'mod-package.mjs']) copyFileSync(path.join('scripts', file), path.join(root, 'scripts', file));
    const html = '<main>' + '完整舞台'.repeat(70000) + '</main>';
    writeFileSync(path.join(root, 'mods', 'large', 'manifest.json'), JSON.stringify({ format: 'eidos-gameplay-plugin', version: 1, id: 'large', name: '大包', description: '完整包', tags: [], prompts: { creation: '', action: '', review: '' }, rules: [] }));
    writeFileSync(path.join(root, 'mods', 'large', 'index.html'), html);
    mkdirSync(path.join(root, 'mods', 'global'));
    writeFileSync(path.join(root, 'mods', 'global', 'reader.json'), '{}');
    execFileSync(process.execPath, [path.join(root, 'scripts', 'pack-mods.mjs')]);
    const source = readFileSync(path.join(root, 'mods', 'dist', 'large.eidos-plugin.json'), 'utf8');
    expect(Buffer.byteLength(source)).toBeGreaterThan(200000);
    expect(parsePluginFile(JSON.parse(source))[0].ui!.html).toBe(html);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
