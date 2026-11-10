import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { buildSdk } from '../../../../scripts/sdk/build.mjs';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'eidos-sdk-build-')); roots.push(root); mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [], paths: { '@/*': ['./src/*'] } } }));
  const files = {
    'base.ts': "export interface Parent { count: number }\nexport interface Child extends Parent { tag: 'child' }",
    'barrel.ts': "export { Child as ChildAlias } from './base';",
    'model.ts': "import type { ChildAlias as Shared } from './barrel';\nimport type { Store } from 'absent-ui';\nexport interface Public { value: Shared; queried: import('./base').Parent }\nexport interface Hidden extends Store {}",
    'index.ts': "import type { Public } from '@/model';\nexport type { Public } from '@/model';\nexport function read(value: Public): number { return value.value.count }",
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'src', name), text);
  return { root, entries: { index: path.join(root, 'src/index.ts') }, outDir: path.join(root, 'dist') };
}

it('retains inherited, aliased, barrel and import-query types without an unused UI dependency', () => {
  const options = fixture(); buildSdk(options);
  writeFileSync(path.join(options.root, 'consumer.ts'), "import {read, type Public} from './dist/index';\nconst value: Public = {value:{count:0,tag:'child'},queried:{count:1}};\nconst n: number = read(value);\n// @ts-expect-error exact literal type survives\nvalue.value.tag = 'wrong';\n// @ts-expect-error inherited property retains its type\nvalue.value.count = 'wrong';\n");
  const compiler = path.resolve('node_modules/typescript/lib/tsc.js');
  writeFileSync(path.join(options.root, 'consumer-tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false, types: [], noEmit: true, target: 'ES2022', module: 'Node16', moduleResolution: 'Node16' }, files: ['consumer.ts'] }));
  execFileSync(process.execPath, [compiler, '-p', 'consumer-tsconfig.json'], { cwd: options.root, stdio: 'pipe' });
  expect(readFileSync(path.join(options.outDir, 'internal/src/model.d.ts'), 'utf8')).not.toContain('absent-ui');
}, 20000);

it('rejects an external runtime dependency while preserving the previous valid output', () => {
  const options = fixture(); buildSdk(options);
  const before = readFileSync(path.join(options.outDir, 'index.js'), 'utf8');
  writeFileSync(options.entries.index, "import fs from 'node:fs'; export const read = fs.readFileSync;");
  expect(() => buildSdk(options)).toThrow(/resolve|dependency|依赖/);
  expect(readFileSync(path.join(options.outDir, 'index.js'), 'utf8')).toBe(before);
}, 20000);

it('rejects an unresolved public type instead of widening the declaration', () => {
  const options = fixture();
  writeFileSync(options.entries.index, "import type {Store} from 'absent-ui'; export interface Public extends Store { id: string }");
  expect(() => buildSdk(options)).toThrow(/resolve|dependency|依赖/);
  expect(existsSync(path.join(options.outDir, 'index.js'))).toBe(false);
}, 20000);

it('checks emitted declarations before replacing a valid build', () => {
  const options = fixture(); buildSdk(options);
  const before = readFileSync(path.join(options.outDir, 'index.d.ts'), 'utf8');
  writeFileSync(options.entries.index, 'export function read(value: MissingPublicType): MissingPublicType { return value; }');
  expect(() => buildSdk(options)).toThrow(/declaration|MissingPublicType/);
  expect(readFileSync(path.join(options.outDir, 'index.d.ts'), 'utf8')).toBe(before);
}, 20000);

it('refuses to replace an unowned source directory', () => {
  const options = fixture();
  expect(() => buildSdk({ ...options, outDir: path.join(options.root, 'src') })).toThrow();
  expect(readFileSync(options.entries.index, 'utf8')).toContain('export function read');
});

it('rejects public entry names that escape the staging directory', () => {
  const options = fixture();
  expect(() => buildSdk({ ...options, entries: { '../escaped': options.entries.index } })).toThrow(/entry|入口/);
  expect(existsSync(path.join(options.root, 'escaped.js'))).toBe(false);
}, 20000);

it('retains the previous build backup when publishing and rollback both fail', () => {
  const options = fixture(); buildSdk(options);
  const before = readFileSync(path.join(options.outDir, 'index.js'), 'utf8'), rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(to) === options.outDir) throw new Error('disk rename unavailable');
    return rename(from, to);
  });
  expect(() => buildSdk(options)).toThrow('disk rename unavailable');
  const backup = readdirSync(options.root).find(name => name.startsWith('.eidos-sdk-old-'));
  expect(backup).toBeDefined();
  expect(readFileSync(path.join(options.root, backup!, 'dist/index.js'), 'utf8')).toBe(before);
}, 20000);
