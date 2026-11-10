import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleModPackage } from '../../../scripts/mod-package.mjs';

/** Read the author's selected JSON content without invoking a model or generating distribution files. */
export function sourceManifest(name: string) {
  const root = resolve('mods', name), manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  const config = existsSync(resolve(root, 'pack.json')) ? JSON.parse(readFileSync(resolve(root, 'pack.json'), 'utf8')) : {};
  const content = config.content ? JSON.parse(readFileSync(resolve(root, config.content), 'utf8')) : {};
  const result = assembleModPackage(manifest, content, readFileSync(resolve(root, config.presentation ?? 'index.html'), 'utf8'));
  delete result.ui.html;
  return result;
}
