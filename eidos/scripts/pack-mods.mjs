import { writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { loadModPackage } from './mod-package.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
const selected = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--content' || args[i] === '--presentation') { const key = args[i].slice(2); if (!args[i + 1]) throw new Error('缺少文件路径'); options[key] = args[++i]; }
  else selected.push(args[i]);
}
if (Object.keys(options).length && selected.length !== 1) throw new Error('选择内容或界面时请指定一个模组目录');
const candidates = (await readdir(path.join(project, 'mods'), { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'dist');
const discovered = await Promise.all(candidates.map(async entry => {
  try { await access(path.join(project, 'mods', entry.name, 'manifest.json')); return entry.name; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}));
const dirs = selected.length ? selected : discovered.filter(Boolean);
const output = path.join(project, 'mods/dist');
await mkdir(output, { recursive: true });
for (const name of dirs) {
  if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('模组目录名须为简单名称');
  const root = path.join(project, 'mods', name);
  const plugin = await loadModPackage(root, options);
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(plugin.id)) throw new Error('分享包 ID 无效');
  const json = JSON.stringify(plugin, null, 2);
  await writeFile(path.join(output, `${plugin.id}.eidos-plugin.json`), json + '\n');
  console.log(`${name}: ${plugin.id}.eidos-plugin.json (${Buffer.byteLength(json)} bytes)`);
}
