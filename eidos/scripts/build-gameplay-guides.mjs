import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('src/lib/game/plugins/catalog.json', base), 'utf8'));
const manifests = catalog.map(plugin => {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) throw new Error('Invalid built-in plugin ID');
  const source = readFileSync(new URL(`src/lib/ai/skills/${plugin.id}.md`, base), 'utf8');
  const part = name => source.match(new RegExp(`## Part ${name}:[\\s\\S]*?(?=## Part [ABC]:|$)`))?.[0].trim() ?? '';
  const prompts = { creation: part('A'), action: part('B'), review: part('C') };
  if (Object.values(prompts).some(text => !text)) throw new Error(`Missing lifecycle guide: ${plugin.id}`);
  return { format: 'eidos-gameplay-plugin', version: 1, ...plugin, prompts, rules: plugin.rules ?? [] };
});
const output = fileURLToPath(new URL('src/lib/game/plugins/builtin-guides.json', base));
const content = JSON.stringify(manifests, null, 2) + '\n';
if (readFileSyncSafe(output) !== content) writeFileSync(output, content);
function readFileSyncSafe(path) { try { return readFileSync(path, 'utf8'); } catch { return ''; } }
