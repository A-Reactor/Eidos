import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { URL as NodeURL } from 'node:url';

export function assembleModPackage(manifest, content = {}, html) {
  const allowed = ['id', 'name', 'description', 'tags', 'data', 'rules', 'prompts', 'ui', 'activation'];
  if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).some(k => !allowed.includes(k))) throw new Error('内容文件包含不支持的字段');
  if (content.ui && Object.keys(content.ui).some(k => k !== 'initialState')) throw new Error('内容文件不能替换界面代码');
  const prompts = Object.fromEntries(['creation', 'action', 'review'].map(phase => [phase, [manifest.prompts?.[phase], content.prompts?.[phase]].filter(Boolean).join('\n')]));
  return { ...manifest, ...content, prompts, rules: [...(manifest.rules ?? []), ...(content.rules ?? [])],
    ...(html !== undefined || manifest.ui || content.ui ? { ui: { reading: 'replace', ...manifest.ui, initialState: { ...manifest.ui?.initialState, ...content.ui?.initialState }, html } } : {}) };
}
async function readInside(root, name) {
  if (typeof name !== 'string' || path.isAbsolute(name)) throw new Error('只支持模组目录内的文件');
  const base = await realpath(root), resolved = path.resolve(base, name);
  if (path.relative(base, resolved).startsWith('..')) throw new Error('文件不能离开模组目录');
  const actual = await realpath(resolved);
  if (path.relative(base, actual).startsWith('..')) throw new Error('文件不能离开模组目录');
  return readFile(actual, 'utf8');
}
export async function loadModPackage(root, options = {}) {
  const manifest = JSON.parse(await readInside(root, 'manifest.json'));
  let config = {};
  try { config = JSON.parse(await readInside(root, 'pack.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const contentPath = options.content ?? config.content;
  const content = contentPath ? JSON.parse(await readInside(root, contentPath)) : {};
  // Pure narrative packages have no presentation artifact to load or inject.
  if (config.guideOnly === true) {
    if (options.presentation || config.presentation || config.native || manifest.ui || content.ui) throw new Error('纯叙事包不能同时声明界面');
    return assembleModPackage(manifest, content);
  }
  let html = await readInside(root, options.presentation ?? config.presentation ?? 'index.html');
  if (config.workbenchTheme === true) {
    const css = await readFile(new NodeURL('../mods/shared/workbench.css', import.meta.url), 'utf8');
    html = html.replace(/<html\b/i, '<html data-eidos-workbench')
      .replace(/<\/head>/i, `<style data-eidos-workbench-theme>${css}</style></head>`);
  }
  for (const match of [...html.matchAll(/<script\s+src=["']([^"']+)["']\s*><\/script>/g)]) {
    const script = await readInside(root, match[1]);
    html = html.replace(match[0], `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  const assembled = assembleModPackage(manifest, content, html);
  // Older author tool copies need no native compiler unless they opt into native packaging.
  return config.native ? (await import('./native-mod-package.mjs')).withNativeGameplay(assembled, config.native) : assembled;
}
