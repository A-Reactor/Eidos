import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

export const posix = value => value.split(path.sep).join('/');
export const within = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

/** Every emitted reference resolves to the same source identity, including both public entries. */
export function createModules({ root, entries, options }) {
  if (!Object.keys(entries).length || Object.keys(entries).some(name => !/^[a-z][a-z0-9-]*$/i.test(name))) throw new Error('Invalid SDK entry name');
  const names = new Map(Object.entries(entries).map(([name, file]) => [fs.realpathSync(file), name]));
  if (names.size !== Object.keys(entries).length) throw new Error('SDK entries must have distinct source files');
  const output = (file, extension = '.js') => {
    const real = fs.realpathSync(file);
    if (!within(root, real)) throw new Error(`Source outside SDK project: ${file}`);
    const name = names.get(real) ?? `internal/${posix(path.relative(root, real)).replace(/\.[cm]?[jt]sx?$/, '')}`;
    return `${name}${extension}`;
  };
  const resolve = (specifier, from) => {
    const result = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
    if (!result || result.isExternalLibraryImport || !within(root, fs.realpathSync(result.resolvedFileName))) throw new Error(`Cannot resolve portable dependency ${specifier} from ${from}`);
    return fs.realpathSync(result.resolvedFileName);
  };
  const reference = (specifier, from) => {
    const target = resolve(specifier, from);
    const relative = posix(path.relative(path.dirname(output(from)), output(target)));
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  return { output, resolve, reference, entries: [...names.keys()] };
}

export function compilerOptions(root) {
  const file = path.join(root, 'tsconfig.json'), input = ts.readConfigFile(file, ts.sys.readFile);
  if (input.error) throw new Error(ts.flattenDiagnosticMessageText(input.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(input.config, ts.sys, root);
  return { ...parsed.options, target: ts.ScriptTarget.ES2022, noEmit: false, noEmitOnError: false, incremental: false,
    declaration: true, emitDeclarationOnly: true, rootDir: root, outDir: path.join(root, '.sdk-declarations'), plugins: [], sourceMap: false, declarationMap: false };
}
