import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compilerOptions, createModules, within } from './modules.mjs';
import { runtimeFiles } from './runtime.mjs';
import { declarationFiles, validateDeclarations } from './declarations.mjs';

const marker = '.eidos-sdk-build.json';
function checkDestination(root, entries, destination) {
  if (within(destination, root) || Object.values(entries).some(file => within(destination, file))) throw new Error('SDK output cannot replace project sources');
  if (!fs.existsSync(destination)) return;
  if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('SDK output cannot be a symbolic link');
  const legacy = destination === path.join(root, 'sdk/dist');
  if (!legacy && fs.readdirSync(destination).length && !fs.existsSync(path.join(destination, marker))) throw new Error('SDK output directory is not owned by this builder');
}

export function buildSdk({ root, entries, outDir }) {
  root = fs.realpathSync(root); outDir = path.resolve(outDir);
  checkDestination(root, entries, outDir);
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  const staged = fs.mkdtempSync(path.join(path.dirname(outDir), '.eidos-sdk-stage-'));
  let backup, removeBackup = false;
  try {
    const options = compilerOptions(root), modules = createModules({ root, entries, options });
    const files = new Map([...runtimeFiles(modules, options), ...declarationFiles(modules, options)]);
    for (const [relative, contents] of files) {
      const file = path.join(staged, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents);
    }
    validateDeclarations(staged, Object.keys(entries));
    fs.writeFileSync(path.join(staged, marker), JSON.stringify({ format: 'eidos-sdk-build', version: 1, entries: Object.keys(entries), files: [...files.keys()].sort() }, null, 2));
    if (fs.existsSync(outDir)) { backup = fs.mkdtempSync(path.join(path.dirname(outDir), '.eidos-sdk-old-')); fs.renameSync(outDir, path.join(backup, 'dist')); }
    try { fs.renameSync(staged, outDir); }
    catch (error) {
      if (backup) {
        try { fs.renameSync(path.join(backup, 'dist'), outDir); removeBackup = true; }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], `${error.message}; previous SDK retained at ${path.join(backup, 'dist')}`); }
      }
      throw error;
    }
    removeBackup = true;
    return { outDir, files: files.size };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    if (backup && removeBackup) fs.rmSync(backup, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../../', import.meta.url)), args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) throw new Error('Usage: node scripts/sdk/build.mjs [--out-dir PATH]');
  const result = buildSdk({ root, entries: { index: path.join(root, 'src/lib/engine/index.ts'), rpg: path.join(root, 'sdk/rpg.ts') }, outDir: args[1] ?? path.join(root, 'sdk/dist') });
  console.log(`Built SDK: ${result.files} files`);
}
